# UI and module contract: radar overlay (LIV-17)

Version: 1.0.0. Status: Proposed with ADR 0005.
Changes are backward compatible by default. Renaming or removing anything below is a
breaking change, which needs a new version and makes the change Tier 3.
Depends on `contracts/ui/location-map.md` v1.0.0 (`LocationMap.leafletMap`, `[data-testid="map-section"]`,
`[data-testid="map-attribution"]`) and on the page shell rules in `contracts/ui/current-conditions.md`.

## 1. Pure model: `src/js/radar-model.js` (no DOM, no network; unit-tested in Node)

```js
export const RADAR_API_URL   = "https://api.rainviewer.com/public/weather-maps.json";
export const RADAR_TILE_HOST = "https://tilecache.rainviewer.com";
export const RADAR_ATTRIBUTION =
  'Weather data by <a href="https://www.rainviewer.com/">RainViewer</a>';

// Returns { time, path } for the radar.past entry with the largest `time`, or null when
// the input is not valid. Valid means:
//   - radar.past is a non-empty array;
//   - the chosen `time` is a positive safe integer (unix seconds);
//   - the chosen `path` matches /^\/v2\/radar\/[A-Za-z0-9_-]{1,64}$/.
// It never throws. It ignores `host`, `generated`, `nowcast` and `satellite`.
export function parseWeatherMaps(json: unknown): { time: number, path: string } | null

// RADAR_TILE_HOST + path + "/256/{z}/{x}/{y}/2/1_1.png". The path must already be validated.
export function buildRadarTileUrl(path: string): string

// "Radar updated " + Intl.DateTimeFormat("en-US",
//   { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone }).format(time*1000),
// with every /\s/ character (including U+202F and U+00A0) replaced by U+0020.
// `timeZone` is undefined in production (the browser's zone); tests pass it explicitly.
// Example: formatRadarTimestamp(1792530600, "America/Los_Angeles") === "Radar updated 2:10 PM PDT"
export function formatRadarTimestamp(time: number, timeZone?: string): string
```

## 2. Controller and view: `src/js/radar-overlay.js`

```js
// Binds the DOM in section 3 and returns the controller. Never throws to its caller.
export function createRadarOverlay(root, locationMap, options?) -> RadarOverlay
// root:        the element with data-testid="radar-controls"
// locationMap: the LocationMap returned by createLocationMap (LIV-16)

// Node-testable core with no DOM. createRadarOverlay builds it with a DOM `render`.
export function createRadarController(deps) -> RadarOverlay
// deps: { locationMap, render(view), fetch, leaflet, setTimeout, clearTimeout,
//         requestTimeoutMs = 10000, tileTimeoutMs = 15000, timeZone = undefined }
// view passed to render: { checked: boolean, timestampText: string | null,
//                          unavailable: boolean }

interface RadarOverlay {
  setOn(on: boolean): void   // the checkbox `change` handler calls this
  readonly state: "off" | "loading" | "on"
}
```

### State machine

| From | Trigger | Effect | To |
|---|---|---|---|
| (start) | create | render `{checked:false, timestampText:null, unavailable:false}` | off |
| off | `setOn(true)` | start a new generation; render `{checked:true, timestampText:null, unavailable:false}`; if `locationMap.leafletMap` is null, go to **fail**; otherwise `fetch(RADAR_API_URL, {credentials:"omit", cache:"no-store", referrerPolicy:"no-referrer", signal})` with a 10 s abort | loading |
| loading | response is 2xx, JSON, and `parseWeatherMaps` is not null | create `leaflet.tileLayer(buildRadarTileUrl(path), {tileSize:256, opacity:0.7, zIndex:10, maxNativeZoom:7, maxZoom:19, referrerPolicy:"no-referrer", attribution:RADAR_ATTRIBUTION})`; count `tileload` and `tileerror`; add it to `leafletMap`; start the 15 s tile timer | loading |
| loading | first `tileload` | clear the tile timer; render `{checked:true, timestampText:formatRadarTimestamp(time), unavailable:false}` | on |
| loading | network error, abort or timeout, non-2xx, bad JSON, `parseWeatherMaps` returns null, first layer `load` with 0 `tileload` and ≥1 `tileerror`, the tile timer fires, or any exception | **fail**: remove the layer if it was added and clear timers; render `{checked:false, timestampText:null, unavailable:true}` | off |
| loading or on | `setOn(false)` | abort the fetch, clear timers, remove the layer; render `{checked:false, timestampText:null, unavailable:false}` | off |
| off | `setOn(false)` | nothing | off |
| loading or on | `setOn(true)` | nothing (it is already on) | unchanged |

Rules:
- An event from an older generation (a late fetch result or tile event after `setOn(false)`
  or a new `setOn(true)`) is ignored.
- Once the state is `on`, later single-tile errors keep the state `on`.
- The radar-unavailable message stays until the next `setOn(true)` or `setOn(false)`.
- There is no polling, refresh or retry. Each `setOn(true)` makes exactly one frame request.
- The module never reads the coordinates. It does not touch cookies, `localStorage`,
  `sessionStorage`, IndexedDB, Cache API, the URL or history, and it writes nothing to
  `console`.
- The view writes text with `textContent` only. The one HTML string is the constant
  `RADAR_ATTRIBUTION`, which Leaflet renders in its attribution control.

## 3. DOM contract (stable selectors QA targets)

This markup goes in `src/index.html` inside `[data-testid="map-section"]`, after the section
heading and before `[data-testid="map"]`. It is static, with no inline styles or handlers:

| Element | Selector | Accessible name / text |
|---|---|---|
| Radar bar | `[data-testid="radar-controls"]` | n/a |
| Toggle | `input[type="checkbox"][role="switch"][data-testid="radar-toggle"]`, wrapped by `<label>` | role `switch`, name "Radar"; checked when `view.checked` is true (`aria-checked` follows `checked` natively) |
| Timestamp | `[data-testid="radar-timestamp"]` | exact text from `formatRadarTimestamp`, e.g. "Radar updated 2:10 PM PDT"; has the `hidden` attribute when `timestampText` is null |
| Unavailable message | `[data-testid="radar-unavailable"]`, `role="status"` | exact text "Radar is unavailable right now."; has the `hidden` attribute unless `view.unavailable` is true |
| Radar attribution (while the layer is on) | inside `[data-testid="map-attribution"]`: `a[href="https://www.rainviewer.com/"]` | text "RainViewer", preceded by "Weather data by " |
| Overlay tiles | `img.leaflet-tile[src^="https://tilecache.rainviewer.com/v2/radar/"]` inside `[data-testid="map"]` | n/a |

States as QA sees them:
- **off**: the toggle is unchecked, the timestamp is hidden, there are no overlay tiles,
  and there is no RainViewer link in the attribution.
- **loading**: the toggle is checked, and the timestamp and message are hidden.
- **on**: the toggle is checked, the timestamp is visible, the overlay tiles are present,
  and the RainViewer link is visible.
- **off after failure**: the toggle is unchecked, the timestamp is hidden, there are no
  overlay tiles, the message is visible, and the base map is unchanged.

Layout (`src/css/radar.css`, mobile-first):
- The bar is in normal flow above the map: `display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem`,
  `width: 100%`, and no fixed pixel widths. Text wraps (`overflow-wrap: anywhere`).
- The label/toggle touch target is at least 44 × 44 px.
- At a 360 px viewport the toggle and timestamp lie fully inside the viewport and
  outside `[data-testid="map"]`, so they cannot overlap `[data-testid="map-attribution"]`
  (S8). The page has no horizontal scrolling.

## 4. Composition and CSP

- `src/js/app.js` calls `createRadarOverlay(document.querySelector('[data-testid="radar-controls"]'), locationMap)`
  right after it creates `locationMap`. The radar is not a location consumer.
- `src/index.html` links `css/radar.css`.
- CSP changes: add `https://api.rainviewer.com` to `connect-src` and
  `https://tilecache.rainviewer.com` to `img-src`. Nothing else changes. The CSP test is
  updated to expect exactly these hosts.

## 5. External interfaces consumed

- `GET https://api.rainviewer.com/public/weather-maps.json`, which returns
  `application/json` with CORS `*`. The fields used are `radar.past[].time` (unix seconds)
  and `radar.past[].path`.
- `GET https://tilecache.rainviewer.com/v2/radar/<id>/256/{z}/{x}/{y}/2/1_1.png`, which
  returns `image/png` (256 × 256, transparent where there is no precipitation), with z 0–7
  native. An unknown frame returns 404.
- Terms: https://www.rainviewer.com/api.html (free for personal or educational use;
  attribution with a link is mandatory; no key; no SLA).

## 6. Test hooks

- Node unit tests:
  - `radar-model`: valid and invalid payloads, latest-frame selection with unsorted
    `past`, the path regex, and `formatRadarTimestamp(1792530600, "America/Los_Angeles")`.
  - `radar-overlay`: drive `createRadarController` with a fake `fetch`, fake `leaflet`
    (layer emitting `tileload`/`tileerror`/`load`), fake timers and a recording `render`.
    Cover every row of the state machine and the generation rule.
- Browser acceptance tests:
  - Run with `timezoneId: "America/Los_Angeles"`. Fulfil
    `https://api.rainviewer.com/public/weather-maps.json` with
    `{"version":"2.0","generated":1792530700,"host":"https://tilecache.rainviewer.com","radar":{"past":[{"time":1792530000,"path":"/v2/radar/aaa111"},{"time":1792530600,"path":"/v2/radar/bbb222"}],"nowcast":[]}}`,
    which gives the S3 text "Radar updated 2:10 PM PDT". Fulfil
    `https://tilecache.rainviewer.com/**` with a transparent PNG.
  - S6: abort the API route, fulfil it with 500, or abort the tile route. Each case must
    end in the "off after failure" state.
  - S7: after a reload, the toggle is unchecked. `document.cookie` is empty, and
    `localStorage`, `sessionStorage` and `indexedDB.databases()` are empty.
  - The base-map fixtures of `contracts/ui/location-map.md` §5 still apply.
