# UI and module contract: location map (LIV-16)

Version: 1.0.0. Status: Proposed with ADR 0001.
Revision note: §4a was added before first merge to align with ADR 0004 (page shell). It
neither removes nor renames anything, so the version stays at 1.0.0.
Changes are backward compatible by default. Renaming or removing anything below is a
breaking change and needs a new version (Tier 3).

## 1. Module interface: `src/js/location-map.js` (native ES module)

```js
// Creates the map controller. It renders nothing until the first setLocation call.
// `root` is the element with data-testid="map-section" (section 2).
export function createLocationMap(root, options?) -> LocationMap

// options (all optional; the defaults are the production values):
//   tileUrl:        string  default "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
//   attribution:    string  default '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
//   defaultZoom:    number  default 15
//   minZoom:        number  default 3
//   maxZoom:        number  default 19
//   failTimeoutMs:  number  default 15000
//   leaflet:        module  default: the import of "../vendor/leaflet/leaflet-src.esm.js"
//                           (injectable for unit tests)

interface LocationMap {
  // Show the section, centre the map on (lat, lon) at defaultZoom, and put the single
  // marker there. Called by the location source (LIV-13) when a position is known, and by
  // city search (LIV-14) when a place is chosen. A repeat call moves the marker and
  // re-centres at defaultZoom (LIV-16 S4). Invalid input (non-finite numbers, lat outside
  // [-90, 90], lon outside [-180, 180]) is ignored and the current state is kept.
  setLocation(lat: number, lon: number): void

  // Re-centre on the marker and keep the current zoom (LIV-16 S3). Does nothing before
  // the first setLocation call.
  recentre(): void

  // Current state, for tests and for LIV-17: "hidden" | "loading" | "ready" | "unavailable".
  readonly state: string

  // The underlying Leaflet map, or null while hidden or unavailable. LIV-17 adds its
  // overlay layer here. Other callers must not use it.
  readonly leafletMap: object | null
}
```

Rules:
- The module never throws to its caller. Any exception in Leaflet set-up, a missing vendor
  module, or a tile failure (section 3) sets `state = "unavailable"`.
- The module receives coordinates only as arguments. It does not read them from, or write
  them to, the URL, cookies, `localStorage`, `sessionStorage`, or IndexedDB. It does not
  log them.
- The only network requests the module causes are GETs of `tileUrl` with z/x/y filled
  in, plus same-origin loads of `vendor/leaflet/*` (script, CSS, marker images).

## 2. DOM contract (stable selectors QA targets)

| Element | Selector | Accessible name / text |
|---|---|---|
| Map section (hidden until the first `setLocation`) | `[data-testid="map-section"]` (`<section aria-labelledby>` with heading "Map") | region "Map" |
| Map canvas (Leaflet container) | `[data-testid="map"]` | n/a |
| Location marker | `[data-testid="map-marker"]` (on the marker icon `<img>`) | alt "Your location" |
| Zoom in | Leaflet control, `role=button` | "Zoom in" |
| Zoom out | Leaflet control, `role=button` | "Zoom out" |
| Recentre control | `button[data-testid="map-recentre"]` (a real `<button type="button">` in a Leaflet top-left control) | "Recentre" |
| Attribution | `[data-testid="map-attribution"]` (the Leaflet attribution control container); contains link `a[href="https://www.openstreetmap.org/copyright"]` | text includes "© OpenStreetMap contributors" |
| Failure message | `[data-testid="map-unavailable"]`, `role="status"` | exact text "Map is unavailable right now." |

States:
- `hidden`: `map-section` has the `hidden` attribute.
- `loading` / `ready`: `map-section` is visible, `map` is visible, `map-unavailable` is
  hidden.
- `unavailable`: `map-section` is visible, `map` is hidden (`hidden` attribute) or removed,
  `map-unavailable` is visible. Nothing outside `map-section` changes (current conditions
  and outlook stay displayed, S6).
- The Leaflet attribution prefix is `false`, so only the OSM attribution is shown.

Layout (S8):
- `map-section` is in normal page flow and is as wide as the content column
  (`width: 100%`, no fixed pixel widths).
- `[data-testid="map"]` height is `300px` below 600 px viewport width and `400px` at or
  above 600 px. It is never `100vh`, so page content above and below stays reachable by
  scrolling outside the map.
- `scrollWheelZoom: false`, so the wheel scrolls the page.

## 3. Tile failure detection (S6)

The state becomes `unavailable` when any of these happens:
1. On the tile layer's first `load` event after a `setLocation`, zero `tileload` events
   and one or more `tileerror` events were counted since that `setLocation`.
2. `failTimeoutMs` (15 s) passes after a `setLocation` with zero `tileload` events.
3. Set-up throws (for example the vendor module fails to import).

Once at least one tile has loaded, later single-tile errors leave the state `ready`, and
Leaflet shows the tile blank. A later `setLocation` from `unavailable` tries again:
counters reset, the state goes to `loading`, and the map is shown again.

## 4. External interface consumed: OSM standard tile server

- `GET https://tile.openstreetmap.org/{z}/{x}/{y}.png`, image/png, 256×256, z 0–19.
- Requests are `<img>` loads with no `crossOrigin` and no credentials set by the app, and
  the browser's default Referer policy.
- Terms: https://operations.osmfoundation.org/policies/tiles/ (attribution, no bulk or
  prefetch, valid Referer).

## 4a. Composition and CSP (ADR 0001 item 8, ADR 0004)

- `src/js/app.js`:
  `const locationMap = createLocationMap(document.querySelector('[data-testid="map-section"]'));`
  then `locationMap` is appended to `consumers`. The map is not added to `onDenied` or
  `onUnavailable`: it stays `hidden` until a position or a chosen place arrives.
- `src/index.html` links `vendor/leaflet/leaflet.css` and `css/location-map.css`
  (relative URLs). The map section has no `style=` attribute.
- The CSP `img-src` becomes `'self' https://tile.openstreetmap.org`. Every other directive
  stays as ADR 0004 sets it (plus the hosts other stories add). The CSP Node test compares
  every directive's exact value.

## 5. Test hooks

- Unit tests (`node --test`) inject a fake `leaflet` through `options.leaflet` and drive
  `tileload`, `tileerror`, and `load` events to check section 3, plus `setLocation` input
  validation.
- Browser acceptance tests intercept `https://tile.openstreetmap.org/**`: fulfil with a
  PNG for S1–S5, S7, and S8, abort for S6. For S7, check every request URL against
  `^https://tile\.openstreetmap\.org/\d+/\d+/\d+\.png$`, or same-origin, or the weather
  service owned by LIV-13.
