// Controller/view for city search (LIV-14). See contracts/ui/city-search.md.
// Untrusted text is only ever set through textContent. Nothing is logged or stored.
import { buildSearchUrl, formatPlaceLabel, normalizeQuery, parseSearchResponse } from "./city-search-model.js";

const MSG_EMPTY = "Enter a city name.";
const MSG_SEARCHING = "Searching…";
const MSG_ERROR = "Search is unavailable right now.";

export function createCitySearch({ root, fetchImpl = fetch, timeoutMs = 10000, onPlaceSelected } = {}) {
  const q = (id) => root.querySelector(`[data-testid="${id}"]`);
  const form = q("city-search-form");
  const input = q("city-search-input");
  const status = q("city-search-status");
  const list = q("city-search-results");

  let seq = 0;
  let controller = null;
  let timer = null;

  const endRequest = () => {
    clearTimeout(timer);
    timer = null;
    controller = null;
  };
  const abortCurrent = () => {
    const c = controller;
    endRequest();
    if (c) c.abort();
  };

  const view = (message, places) => {
    status.textContent = message;
    list.textContent = "";
    if (places) {
      for (const place of places) {
        const li = root.ownerDocument.createElement("li");
        li.setAttribute("data-testid", "city-search-result");
        const btn = root.ownerDocument.createElement("button");
        btn.setAttribute("type", "button");
        btn.setAttribute("data-testid", "city-search-result-button");
        btn.textContent = formatPlaceLabel(place);
        btn.addEventListener("click", () => select(place));
        li.appendChild(btn);
        list.appendChild(li);
      }
    }
    list.hidden = !places;
  };

  function select(place) {
    try {
      onPlaceSelected?.(place);
    } catch {
      // A failing consumer must not break the search.
    }
    view("", null);
  }

  async function onSubmit(event) {
    event.preventDefault();
    const query = normalizeQuery(input.value);
    abortCurrent();
    if (query === null) {
      seq += 1;
      view(MSG_EMPTY, null);
      return;
    }
    const id = ++seq;
    const ctrl = new AbortController();
    controller = ctrl;
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
    view(MSG_SEARCHING, null);
    let outcome;
    try {
      const response = await fetchImpl(buildSearchUrl(query), {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: ctrl.signal,
      });
      if (!response.ok) throw new Error("status");
      outcome = parseSearchResponse(await response.json());
    } catch {
      outcome = { kind: "error" };
    }
    if (id !== seq) return; // superseded
    endRequest();
    if (outcome.kind === "results") view("", outcome.places);
    else if (outcome.kind === "none") view(`No places found for "${query}".`, null);
    else view(MSG_ERROR, null);
  }

  form.addEventListener("submit", onSubmit);
  view("", null);

  return {
    show() {
      root.hidden = false;
      view("", null);
      input.focus();
    },
    hide() {
      root.hidden = true;
    },
    destroy() {
      seq += 1;
      abortCurrent();
      form.removeEventListener("submit", onSubmit);
      root.hidden = true;
    },
  };
}
