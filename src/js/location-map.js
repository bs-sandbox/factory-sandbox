// Location map (LIV-16, contracts/ui/location-map.md). Wraps self-hosted Leaflet.
// Coordinates are only held in memory: never written to the URL, storage, cookies,
// the DOM text or logs. Only constant strings reach Leaflet HTML sinks.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const VENDOR = "../vendor/leaflet/leaflet-src.esm.js";

const validCoord = (v, max) => typeof v === "number" && Number.isFinite(v) && v >= -max && v <= max;

// Leaflet resets unwanted tiles to a data: GIF, which the CSP (img-src without data:)
// blocks. This subclass drops the src attribute instead, so no data: image is requested.
// It relies on Leaflet 1.9.4 internals (_tiles, _removeTile, _abortLoading); the version is pinned.
export function tileLayerClass(L) {
  return L.TileLayer.extend({
    _removeTile(key) {
      const tile = this._tiles[key];
      if (tile) tile.el.removeAttribute("src");
      return L.GridLayer.prototype._removeTile.call(this, key);
    },
    _abortLoading() {
      for (const key of Object.keys(this._tiles)) {
        const tile = this._tiles[key];
        if (tile.coords.z === this._tileZoom) continue;
        const el = tile.el;
        el.onload = () => false;
        el.onerror = () => false;
        if (!el.complete) {
          el.removeAttribute("src");
          const coords = tile.coords;
          el.remove();
          delete this._tiles[key];
          this.fire("tileabort", { tile: el, coords });
        }
      }
    },
  });
}

export function createLocationMap(root, options = {}) {
  const tileUrl = options.tileUrl ?? TILE_URL;
  const attribution = options.attribution ?? ATTRIBUTION;
  const defaultZoom = options.defaultZoom ?? 15;
  const minZoom = options.minZoom ?? 3;
  const maxZoom = options.maxZoom ?? 19;
  const failTimeoutMs = options.failTimeoutMs ?? 15000;

  const mapEl = root.querySelector('[data-testid="map"]');
  const unavailableEl = root.querySelector('[data-testid="map-unavailable"]');

  let state = "hidden";
  let L = null;
  let map = null;
  let marker = null;
  let loaded = 0;
  let errors = 0;
  let timer = null;
  let pending = null; // latest valid location while the vendor module loads
  let loading = null;

  function show(next) {
    state = next;
    root.hidden = false;
    const bad = next === "unavailable";
    mapEl.hidden = bad;
    unavailableEl.hidden = !bad;
  }

  function fail() {
    clearTimeout(timer);
    timer = null;
    show("unavailable");
  }

  function build() {
    map = L.map(mapEl, {
      center: [0, 0], zoom: defaultZoom, minZoom, maxZoom,
      scrollWheelZoom: false, attributionControl: false, zoomAnimation: false,
    });
    L.control.attribution({ prefix: false }).addTo(map);
    const layer = new (tileLayerClass(L))(tileUrl, { attribution, crossOrigin: "anonymous", minZoom, maxZoom }).addTo(map);
    layer.on("tileload", () => {
      loaded += 1;
      if (state === "loading") {
        clearTimeout(timer);
        timer = null;
        show("ready");
      }
    });
    layer.on("tileerror", () => { errors += 1; });
    layer.on("load", () => {
      if (loaded === 0 && errors > 0) fail();
    });
    const icon = L.icon({
      iconUrl: "vendor/leaflet/images/marker-icon.png",
      iconRetinaUrl: "vendor/leaflet/images/marker-icon-2x.png",
      shadowUrl: "vendor/leaflet/images/marker-shadow.png",
      iconSize: [25, 41], iconAnchor: [12, 41], shadowSize: [41, 41],
    });
    marker = L.marker([0, 0], { icon, alt: "Your location", keyboard: false });
    const Recentre = L.Control.extend({
      options: { position: "topleft" },
      onAdd() {
        const div = L.DomUtil.create("div", "leaflet-bar");
        const btn = L.DomUtil.create("button", "", div);
        btn.type = "button";
        btn.textContent = "Recentre";
        btn.setAttribute("data-testid", "map-recentre");
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.on(btn, "click", () => recentre());
        return div;
      },
    });
    new Recentre().addTo(map);
    const attr = mapEl.querySelector(".leaflet-control-attribution");
    if (attr) attr.setAttribute("data-testid", "map-attribution");
    const zin = mapEl.querySelector(".leaflet-control-zoom-in");
    const zout = mapEl.querySelector(".leaflet-control-zoom-out");
    if (zin) zin.setAttribute("aria-label", "Zoom in");
    if (zout) zout.setAttribute("aria-label", "Zoom out");
  }

  function apply(lat, lon) {
    if (!map) build();
    loaded = 0;
    errors = 0;
    clearTimeout(timer);
    show("loading");
    if (!marker._map) marker.addTo(map);
    marker.setLatLng([lat, lon]);
    const el = marker.getElement?.();
    if (el) el.setAttribute("data-testid", "map-marker");
    timer = setTimeout(() => { if (loaded === 0) fail(); }, failTimeoutMs);
    map.invalidateSize();
    map.setView([lat, lon], defaultZoom);
  }

  function setLocation(lat, lon) {
    try {
      if (!validCoord(lat, 90) || !validCoord(lon, 180)) return;
      if (L) {
        apply(lat, lon);
        return;
      }
      pending = [lat, lon];
      show("loading");
      if (!loading) {
        loading = (options.leaflet ? Promise.resolve(options.leaflet) : import(VENDOR))
          .then((mod) => {
            L = mod.default ?? mod;
            const p = pending;
            pending = null;
            apply(p[0], p[1]);
          })
          .catch(() => { fail(); })
          .finally(() => { loading = null; });
      }
    } catch {
      fail();
    }
  }

  function recentre() {
    try {
      if (!map || !marker) return;
      map.setView(marker.getLatLng(), map.getZoom());
    } catch {
      fail();
    }
  }

  return {
    setLocation,
    recentre,
    get state() { return state; },
    get leafletMap() { return state === "hidden" || state === "unavailable" ? null : map; },
  };
}
