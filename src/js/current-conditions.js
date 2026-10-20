// Conditions controller (pure state machine, injected render) and DOM view.
import { CONDITIONS_ENDPOINT, buildConditionsUrl, parseCurrentConditions } from "./current-conditions-model.js";

function validLocation(lat, lon) {
  return (
    typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lon === "number" && Number.isFinite(lon) && lon >= -180 && lon <= 180
  );
}

export function createConditionsController({
  render,
  fetch = globalThis.fetch,
  endpoint = CONDITIONS_ENDPOINT,
  timeoutMs = 10000,
}) {
  let state = "locating";
  let location = null;
  let current = null; // { controller, timer }
  let seq = 0;

  const draw = (view) => {
    try {
      render(view);
    } catch {
      // never throw to the caller
    }
  };
  const set = (next, view = { state: next }) => {
    state = next;
    draw(view);
  };
  const abort = () => {
    seq += 1;
    if (current) {
      clearTimeout(current.timer);
      try { current.controller.abort(); } catch { /* ignore */ }
      current = null;
    }
  };

  async function load(lat, lon) {
    abort();
    const id = seq;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    current = { controller, timer };
    set("loading");
    let outcome = null;
    try {
      const res = await fetch(buildConditionsUrl(lat, lon, endpoint), {
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (res.ok) outcome = parseCurrentConditions(await res.json());
    } catch {
      outcome = null;
    }
    if (id !== seq) return; // superseded
    clearTimeout(timer);
    current = null;
    if (outcome) set("ready", { state: "ready", temperature: outcome.temperature, conditions: outcome.conditions });
    else set("unavailable");
  }

  draw({ state });

  return {
    get state() { return state; },
    setLocation(lat, lon) {
      if (!validLocation(lat, lon)) return;
      location = { lat, lon };
      load(lat, lon).catch(() => {});
    },
    retry() {
      if (state !== "unavailable" || !location) return;
      load(location.lat, location.lon).catch(() => {});
    },
    showDenied() { abort(); set("denied"); },
    showLocationUnavailable() { abort(); set("no-location"); },
  };
}

const STATUS_TEXT = {
  locating: "Finding your location…",
  loading: "Loading current conditions…",
  denied: "Location access was denied.",
  "no-location": "We couldn't determine your location.",
};

export function createCurrentConditions(root, options = {}) {
  const q = (id) => root.querySelector(`[data-testid="${id}"]`);
  const status = q("conditions-status");
  const currentBox = q("conditions-current");
  const temperature = q("conditions-temperature");
  const text = q("conditions-text");
  const unavailable = q("conditions-unavailable");
  const retryButton = q("conditions-retry");
  const attribution = q("conditions-attribution");

  const render = (view) => {
    const s = view.state;
    const msg = STATUS_TEXT[s] ?? "";
    status.textContent = msg;
    status.hidden = msg === "";
    currentBox.hidden = s !== "ready";
    temperature.textContent = s === "ready" ? view.temperature : "";
    text.textContent = s === "ready" ? view.conditions : "";
    unavailable.hidden = s !== "unavailable";
    attribution.hidden = !(s === "loading" || s === "ready" || s === "unavailable");
  };

  const controller = createConditionsController({ ...options, render });
  retryButton.addEventListener("click", () => controller.retry());
  return controller;
}
