# 0001. Location map: self-hosted Leaflet 1.9.4 with OpenStreetMap raster tiles
Status: Proposed
Date: 2026-10-20

Context:
- LIV-16 (Epic LIV-12, capability 3) needs an interactive map centred on the user's
  location: pan, zoom (controls, drag, pinch), a marker, a "Recentre" control, visible
  attribution, a failure message, and a 360 px phone layout. LIV-17 (radar overlay) will add
  a raster overlay layer to the same map.
- Constraints from the Epic and the story: static site on GitHub Pages under
  `/factory-sandbox/` (relative links only), no accounts and no API keys, free keyless tile
  service with attribution, nothing stored, and the only map-related network requests go to
  the tile service and carry tile coordinates (z/x/y), never the raw latitude/longitude
  (LIV-16 S7).
- The repo has no bundler. `npm run build` copies `src/` to `dist/` (`scripts/build.mjs`),
  and CI runs `npm ci --ignore-scripts`, `npm audit --audit-level=high`, `npm test` and
  `npm run build` (`.github/workflows/ci.yml`).
- Location coordinates are personal data, so the story is Tier 3 with Security Impact.

Decision:
1. Map library: Leaflet 1.9.4 (npm `leaflet`, BSD-2-Clause, current `latest` dist-tag),
   added to `dependencies` with an exact version (`"leaflet": "1.9.4"`) and pinned in
   `package-lock.json`. Use its native ES module build `dist/leaflet-src.esm.js`. Do not
   use the global `L` build.
2. Self-host it. `scripts/build.mjs` copies `node_modules/leaflet/dist/leaflet-src.esm.js`,
   `leaflet.css` and `images/` to `dist/vendor/leaflet/`. No CDN is used: a CDN request would
   be a second map-related host and break S7. Vendored files are not committed to `src/`.
   That way `npm audit` keeps covering them.
3. Tile service: the OpenStreetMap Foundation standard raster tiles,
   `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (single host, no subdomains, max zoom
   19). It is free and keyless. The URL holds only the tile coordinates z/x/y, computed in
   the browser from the location (S7).
4. OSMF Tile Usage Policy compliance:
   - attribution `© OpenStreetMap contributors`, linked to
     `https://www.openstreetmap.org/copyright`, is always visible on the map;
   - no prefetching or bulk downloading: Leaflet loads only the visible tiles, and the
     defaults `keepBuffer: 2` and no `preload`/offline plugins stay as they are;
   - the browser's default Referer policy (`strict-origin-when-cross-origin`) is kept, so
     the tile service receives the page origin only. No page sets `no-referrer`, because the
     policy requires a valid Referer.
   - the OSM tile layer sets `crossOrigin: "anonymous"`. Tiles load in CORS mode with
     credentials omitted, so no `tile.openstreetmap.org` cookie is sent (LIV-16 S13,
     threat model T3). The tile server answers with `Access-Control-Allow-Origin: *`.
     The default Referer policy above is unchanged by this.
5. Coordinates are never written to the page URL (path, query, or hash), cookies, or any
   Web Storage or IndexedDB. Leaflet 1.9.4 uses none of these. Checked by grepping
   `dist/leaflet-src.esm.js` for `localStorage`, `sessionStorage`, `indexedDB`, and
   `document.cookie`: no matches.
6. Defaults: initial and location-change zoom 15 (street names are rendered in the OSM
   standard style at this zoom), min zoom 3, max zoom 19. Scroll-wheel zoom is off so the
   page always scrolls past the map. Zoom works through the +/- controls, pinch, and
   double-click/tap.
7. The map lives in one module, `src/js/location-map.js`, behind the interface in
   `contracts/ui/location-map.md`. The page shell and location source (LIV-13) and city
   search (LIV-14) call it. It never throws into the page: every failure becomes the
   "Map is unavailable right now." state.
8. Composition and CSP (aligned with ADR 0004, merged after this ADR was first proposed):
   - `src/js/app.js` creates the map with `createLocationMap(...)` and appends it to the
     `consumers` list. The shell's `setLocationAll` reaches it for both the geolocation
     result and LIV-14's `onPlaceSelected` (`contracts/ui/current-conditions.md` §1.5).
     The map does not import the location source or city search.
   - The `<section data-testid="map-section">` is the last feature section in
     `src/index.html`. It links `vendor/leaflet/leaflet.css` and `css/location-map.css`
     with relative URLs. It has no `style=` attribute and no inline `<style>`.
   - The CSP from ADR 0004 changes by exactly one source: `https://tile.openstreetmap.org`
     is added to `img-src`. No other directive changes and no wildcard is used. The
     marker images and Leaflet CSS are same-origin (`'self'`). Leaflet sets element
     styles from JavaScript, and `style-src 'self'` does not block that.
   - The CSP Node test asserts the exact, complete value of every directive, the rule
     set by `contracts/ui/radar-overlay.md` §4.
9. Security rules from the LIV-16 threat model:
   - Leaflet HTML sinks (T4): only compile-time constant strings may reach Leaflet options
     or methods that render HTML (attribution, `bindPopup`, `bindTooltip`, `setContent`,
     the layers control). The module uses no popup, tooltip or layers control. The
     `tileUrl` and `attribution` options exist for unit tests only. `src/js/app.js` never
     sets them, and never from runtime data such as a city name or geocoding fields.
   - No second location source (T8): `location-map.js` never calls `map.locate()` or
     `map.stopLocate()` and never uses the `locate` option. LIV-13's location source is
     the only one.
   - Input validation (T7): `setLocation` ignores the call unless both arguments are
     `typeof "number"`, `Number.isFinite`, lat is in [-90, 90] and lon is in [-180, 180].
     An ignored call changes nothing and requests no tile (LIV-16 S14).

Alternatives:
- MapLibre GL JS with vector tiles (for example OpenFreeMap): rejected. It is a much
  larger bundle, and it needs WebGL, which fails on some low-end phones. Raster XYZ tiles
  are also what the likely radar sources for LIV-17 serve, so a raster stack keeps one
  rendering model.
- OpenLayers: rejected. It is larger and more complex than this story needs, with no
  benefit for one marker on raster tiles.
- A hand-written tile map: rejected. Drag, pinch, inertia, and zoom controls would
  re-implement Leaflet with more defects and no review history.
- Loading Leaflet from a CDN (unpkg or jsDelivr): rejected. It adds a third-party host,
  which breaks S7, and a supply-chain path that the lockfile and `npm audit` don't cover.
- Other keyless tile hosts (CARTO basemaps, Stadia, Esri): rejected. CARTO and Stadia
  restrict free or commercial use or need registration for production, and Esri needs an
  API key.
- Leaflet 2.0.0-alpha.1: rejected because it is a pre-release.

Consequences:
- Easier: LIV-17 adds its radar as one more `L.tileLayer` on the same map. No new map
  stack is needed.
- Harder: we depend on a donated, best-effort service with no SLA. OSMF may throttle or
  block heavy or non-compliant use. S6 covers the failure UX. Moving to another raster
  provider changes one URL template and the attribution string.
- The tile service learns the user's approximate location (the tile at z15 is about 1.2 km
  wide at the equator) and their IP address. The Epic accepts this ("latitude and
  longitude in requests to the ... tile services"), and sending only tile coordinates
  reduces it further. Security's threat model on LIV-16 (Jira comment 10224) confirms this
  residual risk and adds the controls in items 4 (`crossOrigin`) and 9.
- The build now needs `node_modules` (after `npm ci`) to produce the vendored files. This
  is already true in CI and Pages.
- Follow-up: upgrading Leaflet is a normal dependency bump plus a re-check of item 5.

Related: LIV-12 (Epic), LIV-16 (this decision), LIV-13 (page shell and location source),
LIV-14 (city search), LIV-17 (radar overlay); contract `contracts/ui/location-map.md`.
