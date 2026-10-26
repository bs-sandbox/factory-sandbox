// Outlook controller and DOM view (contracts/ui/daily-outlook.md sections 1 and 2).
// Service data is rendered with textContent only. Nothing is logged or stored.
import { OUTLOOK_ENDPOINT, buildOutlookUrl, parseDailyOutlook } from "./daily-outlook-model.js";

function validLocation(lat, lon) {
  return (
    typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lon === "number" && Number.isFinite(lon) && lon >= -180 && lon <= 180
  );
}

export function createDailyOutlook(root, options = {}) {
  const {
    endpoint = OUTLOOK_ENDPOINT,
    timeoutMs = 10000,
    fetch: fetchFn = globalThis.fetch,
  } = options;
  const doc = root.ownerDocument;
  const q = (id) => root.querySelector(`[data-testid="${id}"]`);
  const loading = q("outlook-loading");
  const list = q("outlook-list");
  const unavailable = q("outlook-unavailable");
  const retryButton = q("outlook-retry");

  let state = "hidden";
  let location = null;
  let current = null; // { controller, timer }
  let seq = 0;

  const el = (tag, testid, text) => {
    const node = doc.createElement(tag);
    if (testid) node.setAttribute("data-testid", testid);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const item = (label, testid, value) => {
    const wrap = el("span");
    wrap.append(el("span", null, `${label} `), el("span", testid, value));
    return wrap;
  };

  function renderDays(days) {
    list.replaceChildren();
    for (const day of days) {
      const li = el("li", "outlook-day");
      li.setAttribute("data-date", day.date);
      const time = el("time", "outlook-date", day.label);
      time.setAttribute("datetime", day.date);
      li.append(
        time,
        item("High", "outlook-high", day.high),
        item("Low", "outlook-low", day.low),
        el("span", "outlook-conditions", day.conditions),
        item("Precipitation", "outlook-precip", day.precipitation),
      );
      list.append(li);
    }
  }

  function render(next, days) {
    state = next;
    root.hidden = next === "hidden";
    loading.hidden = next !== "loading";
    list.hidden = next !== "ready";
    unavailable.hidden = next !== "unavailable";
    if (next === "ready") renderDays(days);
    else list.replaceChildren();
  }
  const safeRender = (next, days) => {
    try {
      render(next, days);
    } catch {
      state = "unavailable";
    }
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
    safeRender("loading");
    let days = null;
    try {
      const res = await fetchFn(buildOutlookUrl(endpoint, lat, lon), {
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (res.ok) days = parseDailyOutlook(await res.json());
    } catch {
      days = null;
    }
    if (id !== seq) return; // superseded: discard
    clearTimeout(timer);
    current = null;
    if (days) safeRender("ready", days);
    else safeRender("unavailable");
  }

  const api = {
    get state() { return state; },
    setLocation(lat, lon) {
      if (!validLocation(lat, lon)) return;
      location = { lat, lon };
      load(lat, lon).catch(() => safeRender("unavailable"));
    },
    retry() {
      if (state !== "unavailable" || !location) return;
      load(location.lat, location.lon).catch(() => safeRender("unavailable"));
    },
  };
  retryButton.addEventListener("click", () => api.retry());
  safeRender("hidden");
  return api;
}
