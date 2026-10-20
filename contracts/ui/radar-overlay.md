# UI and module contract: radar overlay (LIV-17)

Version: 1.0.0. Status: Proposed with ADR 0005. Revised before first merge to include the
LIV-17 [THREAT-MODEL] (comment 10148) controls T1-T5 and test hooks for S9-S13.
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
//   - every entry considered is an object; the chosen `time` is a number (not a string),
//     Number.isInteger(time), and 1 <= time <= RADAR_MAX_TIME_S (unix seconds; 8.64e12 is
//     the ECMAScript Date range in seconds, so time*1000 is always a valid Date). The bound
//     is a constant and never depends on the browser clock (THREAT-MODEL T2a);
//   - the chosen `path` is a string matching /^\/v2\/radar\/[A-Za-z0-9_-]{1,64}$/
//     (this excludes "{", "}", ".", "?", ":", "%" and any extra "/"; THREAT-MODEL T1).
// Selection happens first (largest numeric `time`), then the chosen entry is validated;
// an invalid latest entry makes the whole result null (no fall-back to an older frame).
// It never throws. It ignores `host`, `generated`, `nowcast` and `satellite`; nothing from
// the response other than the validated `time` and `path` leaves this function.
export const RADAR_MAX_TIME_S = 8640000000000;
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
| loading | network error, abort or timeout, non-2xx, bad JSON, `parseWeatherMaps` returns null, first layer `load` with 0 `tileload` and ≥1 `tileerror`, the tile timer fires, or any exception (including one thrown by `formatRadarTimestamp`, `render`, or Leaflet inside a callback) | **fail**: remove the layer if it was added and clear timers; render `{checked:false, timestampText:null, unavailable:true}` | off |
| loading or on | `setOn(false)` | abort the fetch, clear timers, remove the layer; render `{checked:false, timestampText:null, unavailable:false}` | off |
| off | `setOn(false)` | nothing | off |
| loading or on | `setOn(true)` | nothing (it is already on) | unchanged |

Rules:
- An event from an older generation (a late fetch result or tile event after `setOn(false)`
  or a new `setOn(true)`) is ignored.
- Fail closed (THREAT-MODEL T2b, binding): every entry point into the controller (`setOn`,
  the fetch promise chain, every Leaflet event handler for `tileload`, `tileerror` and
  `load`, and every timer callback) wraps its whole body in `try/catch`. A caught
  exception in `loading` or `on` goes to **fail**. If **fail** itself throws, the
  controller still sets its state to `off`. Nothing propagates to the caller, to Leaflet
  or to the global error handler, and nothing is written to `console`. The state never
  remains `loading` without a pending request or tile timer.
- Once the state is `on`, later single-tile errors keep the state `on`.
- The radar-unavailable message stays until the next `setOn(true)` or `setOn(false)`.
- There is no polling, refresh or retry. Each `setOn(true)` makes exactly one frame request.
- The module never reads the coordinates. It does not touch cookies, `localStorage`,
  `sessionStorage`, IndexedDB, Cache API, the URL or history, and it writes nothing to
  `console`.
- The view writes text with `textContent` only. The one HTML string is the constant
  `RADAR_ATTRIBUTION`, a module-level string literal that is never concatenated with any
  other value. No response field reaches `innerHTML`, Leaflet's attribution, a tooltip or
  a popup (THREAT-MODEL T3).
- Referrer (THREAT-MODEL T5): the frame `fetch` uses `referrerPolicy: "no-referrer"` and
  `credentials: "omit"`; the tile layer uses the option `referrerPolicy: "no-referrer"`.
  Leaflet 1.9.4 copies that string onto each tile `<img>` in `createTile`
  (`dist/leaflet-src.js` lines 12178-12179, checked 2026-10-20), so no override is needed.
  `crossOrigin` is not set. The document-wide referrer policy is not changed, because the
  OSM base map (LIV-16) relies on the default policy.

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
  `https://tilecache.rainviewer.com` to `img-src`. Nothing else changes: no wildcards, no
  `http:` scheme, no other hosts, no `'unsafe-*'` keywords, and no other directive is
  touched (THREAT-MODEL T4).
- The CSP Node test asserts the exact, complete value of every directive in the policy
  (parsed into a directive → ordered source list map and compared with `deepStrictEqual`
  against the expected map), not merely that the two hosts are present. A test that
  only checks `includes(...)` does not meet this contract.

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
    It must include every S12 example (each returns null), `time` = 8640000000000
    (accepted) and 8640000000001 (null), `radar.past` empty or missing (S13), and a
    payload whose `host` is "https://attacker.example" (the result has no host, and
    `buildRadarTileUrl` starts with `RADAR_TILE_HOST`; S11).
  - `radar-overlay`: drive `createRadarController` with a fake `fetch`, fake `leaflet`
    (layer emitting `tileload`/`tileerror`/`load`), fake timers and a recording `render`.
    Cover every row of the state machine and the generation rule. Also cover the
    fail-closed rule (T2b): a fake layer whose `tileload` handler path throws (for example
    an injected `render` or formatter that throws), a throwing timer callback, and a
    throwing `leaflet.tileLayer`. Each must end in "off after failure", with nothing
    thrown out of the fake event emitter. Assert the `fetch` init and `tileLayer` options
    include `referrerPolicy: "no-referrer"` and `credentials: "omit"` (S10).
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
  - S9: record every request to `api.rainviewer.com` and `tilecache.rainviewer.com`
    (for example `page.on("request")`). There are none after load with the toggle off.
    After on → off, no new one starts once the toggle shows unchecked.
  - S10: on every recorded RainViewer request, `request.allHeaders()` has no `referer`
    and no `cookie` key.
  - S11 to S13: fulfil the API route with the fixture above, changed per scenario
    (`host` set to "https://attacker.example"; the latest frame's `path` or `time` set to
    each S12 value; `radar.past` empty or removed). For S11, record that every tile
    request URL starts with `https://tilecache.rainviewer.com/` and none goes to
    `attacker.example`. For S12 and S13, the result is "off after failure" with zero tile
    requests.
