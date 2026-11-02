// Radar overlay controller and view (LIV-17, contracts/ui/radar-overlay.md sections 2-3).
// Fail closed: every entry point catches and ends in "off after failure". Nothing is written
// to console, storage or cookies. The view uses textContent only.
import { tileLayerClass } from "./location-map.js";
import {
  RADAR_API_URL, RADAR_ATTRIBUTION, buildRadarTileUrl, formatRadarTimestamp, parseWeatherMaps,
} from "./radar-model.js";

const VENDOR = "../vendor/leaflet/leaflet-src.esm.js";

export function createRadarController(deps) {
  const {
    locationMap, render, leaflet,
    requestTimeoutMs = 10000, tileTimeoutMs = 15000, timeZone,
  } = deps;
  const doFetch = deps.fetch;
  const setT = deps.setTimeout;
  const clearT = deps.clearTimeout;

  let state = "off";
  let gen = 0;
  let abort = null;
  let layer = null;
  let reqTimer = null;
  let tileTimer = null;
  let time = 0;
  let loaded = 0;
  let errors = 0;

  function cleanup() {
    gen += 1;
    try { clearT(reqTimer); } catch { /* ignore */ }
    try { clearT(tileTimer); } catch { /* ignore */ }
    reqTimer = null;
    tileTimer = null;
    try { abort?.abort(); } catch { /* ignore */ }
    abort = null;
    if (layer) {
      const l = layer;
      layer = null;
      try { l.remove(); } catch { /* ignore */ }
    }
  }

  function fail() {
    try {
      cleanup();
      state = "off";
      render({ checked: false, timestampText: null, unavailable: true });
    } catch {
      state = "off";
    }
  }

  // Wraps a callback tied to generation g: stale calls are ignored, exceptions fail closed.
  const guard = (g, fn) => (...args) => {
    try {
      if (g !== gen) return;
      fn(...args);
    } catch {
      if (g === gen) fail();
    }
  };

  function onFrames(g, json) {
    const frame = parseWeatherMaps(json);
    if (!frame) { fail(); return; }
    clearT(reqTimer);
    reqTimer = null;
    const map = locationMap.leafletMap;
    if (!map) { fail(); return; }
    time = frame.time;
    loaded = 0;
    errors = 0;
    layer = leaflet.tileLayer(buildRadarTileUrl(frame.path), {
      tileSize: 256, opacity: 0.7, zIndex: 10, maxNativeZoom: 7, maxZoom: 19,
      referrerPolicy: "no-referrer", crossOrigin: "anonymous", attribution: RADAR_ATTRIBUTION,
    });
    layer.on("tileload", guard(g, () => {
      loaded += 1;
      if (state === "loading") {
        clearT(tileTimer);
        tileTimer = null;
        const text = formatRadarTimestamp(time, timeZone);
        state = "on";
        render({ checked: true, timestampText: text, unavailable: false });
      }
    }));
    layer.on("tileerror", guard(g, () => { errors += 1; }));
    layer.on("load", guard(g, () => {
      if (state === "loading" && loaded === 0 && errors > 0) fail();
    }));
    tileTimer = setT(guard(g, () => { if (state === "loading") fail(); }), tileTimeoutMs);
    layer.addTo(map);
  }

  function setOn(on) {
    try {
      if (!on) {
        if (state === "off") return;
        cleanup();
        state = "off";
        render({ checked: false, timestampText: null, unavailable: false });
        return;
      }
      if (state !== "off") return;
      cleanup();
      const g = gen;
      state = "loading";
      render({ checked: true, timestampText: null, unavailable: false });
      if (!locationMap.leafletMap) { fail(); return; }
      abort = new AbortController();
      reqTimer = setT(guard(g, () => fail()), requestTimeoutMs);
      doFetch(RADAR_API_URL, {
        credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: abort.signal,
      })
        .then((res) => {
          if (g !== gen) return null;
          if (!res.ok) throw new Error("status");
          return res.json();
        })
        .then(guard(g, (json) => onFrames(g, json)))
        .catch(() => { if (g === gen) fail(); });
    } catch {
      fail();
    }
  }

  try {
    render({ checked: false, timestampText: null, unavailable: false });
  } catch { /* ignore */ }
  return { setOn, get state() { return state; } };
}

// Binds the DOM of section 3. Never throws to its caller.
export function createRadarOverlay(root, locationMap, options = {}) {
  const toggle = root.querySelector('[data-testid="radar-toggle"]');
  const stampEl = root.querySelector('[data-testid="radar-timestamp"]');
  const msgEl = root.querySelector('[data-testid="radar-unavailable"]');

  // Same module URL as location-map.js, so this is the same Leaflet instance.
  let L = null;
  (options.leaflet ? Promise.resolve(options.leaflet) : import(VENDOR))
    .then((mod) => { L = mod.default ?? mod; })
    .catch(() => { L = null; });

  const leaflet = {
    tileLayer(url, opts) {
      if (!L) throw new Error("leaflet unavailable");
      return new (tileLayerClass(L))(url, opts);
    },
  };

  function render(view) {
    toggle.checked = view.checked;
    stampEl.hidden = view.timestampText === null;
    stampEl.textContent = view.timestampText ?? "";
    msgEl.hidden = !view.unavailable;
  }

  const controller = createRadarController({
    locationMap, render, leaflet,
    fetch: (...a) => (options.fetch ?? globalThis.fetch)(...a),
    setTimeout: (...a) => globalThis.setTimeout(...a),
    clearTimeout: (...a) => globalThis.clearTimeout(...a),
    timeZone: options.timeZone,
  });
  toggle.addEventListener("change", () => {
    try { controller.setOn(toggle.checked); } catch { /* controller fails closed */ }
  });
  return controller;
}
