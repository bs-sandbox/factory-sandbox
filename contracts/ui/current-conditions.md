# UI, module and service contract: page shell and current conditions (LIV-13)

Version: 1.0.0. Status: Proposed with ADR 0004.
Changes are backward compatible by default. Renaming or removing a module export, a
`data-testid`, an accessible name or a message string is a breaking change and needs a new
version (Tier 3).

## 1. Modules

| File | Kind | Exports |
|---|---|---|
| `src/js/format.js` | pure | `roundCoordinate(x)`, `formatTemperature(celsius)` |
| `src/js/weather-codes.js` | pure | `conditionLabel(code)` (table: `contracts/ui/daily-outlook.md` §4) |
| `src/js/current-conditions-model.js` | pure, no DOM, no network | `CONDITIONS_ENDPOINT`, `buildConditionsUrl(lat, lon, endpoint?)`, `parseCurrentConditions(json)` |
| `src/js/location-source.js` | browser API wrapper | `requestLocation(geolocation?, options?)` |
| `src/js/current-conditions.js` | controller + view | `createConditionsController(options)`, `createCurrentConditions(root, options?)` |
| `src/js/page-shell.js` | composition logic | `startShell({ requestLocation, consumers, onDenied, onUnavailable })`, `setLocationAll(consumers, lat, lon)` |
| `src/js/app.js` | entry module, wiring only | none |

### 1.1 `format.js`

- `roundCoordinate(x: number): number` returns `Number(x.toFixed(2))`, with `-0` returned as
  `0`. Examples: `47.6062 → 47.61`, `-122.3321 → -122.33`.
- `formatTemperature(celsius: number): string`: `Math.round`, negative zero shown as `0`,
  ASCII hyphen-minus for negatives, no space. Examples: `14 → "14°C"`, `13.6 → "14°C"`,
  `-0.4 → "0°C"`, `-2 → "-2°C"`.

### 1.2 `current-conditions-model.js`

- `CONDITIONS_ENDPOINT = "https://api.open-meteo.com/v1/forecast"`.
- `buildConditionsUrl(lat, lon, endpoint = CONDITIONS_ENDPOINT): string` returns
  `<endpoint>?latitude=<roundCoordinate(lat)>&longitude=<roundCoordinate(lon)>&current=temperature_2m,weather_code`,
  built with `URL`/`URLSearchParams`. No other parameters are added. (`URLSearchParams`
  encodes the comma as `%2C`; the service accepts both forms.)
- `parseCurrentConditions(json: unknown): { temperature: string, conditions: string } | null`
  - `null` ("unavailable") unless `json` is a plain object whose `current` is a plain object
    with `temperature_2m` of type `number` and finite, and `weather_code` of type `number`
    and an integer. Strings, booleans and `null` are rejected, even if numeric-looking.
  - `json.error === true` → `null`.
  - Otherwise `{ temperature: formatTemperature(current.temperature_2m), conditions: conditionLabel(current.weather_code) }`.
    An unknown code gives `"Unknown"`. All other fields are ignored and never displayed.

### 1.3 `location-source.js`

```js
export function requestLocation(geolocation = globalThis.navigator?.geolocation,
                                { timeoutMs = 10000 } = {}) -> Promise<LocationResult>
type LocationResult =
  | { kind: "position", latitude: number, longitude: number }
  | { kind: "denied" }
  | { kind: "unavailable" }
```

- Calls `geolocation.getCurrentPosition(success, error, { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 0 })` exactly once.
- Never rejects. Mapping:
  - success with finite `coords.latitude` in [-90, 90] and `coords.longitude` in [-180, 180] → `position`;
  - error `code === 1` (PERMISSION_DENIED) → `denied`;
  - error `code` 2 (POSITION_UNAVAILABLE), 3 (TIMEOUT) or any other code → `unavailable`;
  - `geolocation` missing, `getCurrentPosition` throwing, or invalid coordinates → `unavailable`.
- It never logs, stores or exposes the coordinates other than in the resolved value.

### 1.4 `current-conditions.js`

```js
// Pure state machine; render(view) is called after every state change.
export function createConditionsController({
  render,                         // required: (view) => void
  fetch = globalThis.fetch,
  endpoint = CONDITIONS_ENDPOINT,
  timeoutMs = 10000,
}) -> ConditionsController

// DOM binding: wires a controller to the section in §2. Used by app.js.
export function createCurrentConditions(root, options?) -> ConditionsController

interface ConditionsController {
  setLocation(lat: number, lon: number): void // invalid input ignored, state kept
  retry(): void                               // only acts in "unavailable"
  showDenied(): void
  showLocationUnavailable(): void
  readonly state: "locating" | "loading" | "ready" | "unavailable" | "denied" | "no-location"
}

type View =
  | { state: "locating" | "loading" | "denied" | "no-location" | "unavailable" }
  | { state: "ready", temperature: string, conditions: string }
```

| Trigger | Effect |
|---|---|
| created | state `locating`. No request. |
| `setLocation(lat, lon)` with valid input, from any state | aborts any request in flight, state `loading`, sends exactly one GET `buildConditionsUrl(lat, lon, endpoint)` with `{ credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal }`. The location is remembered in memory only, for `retry`. |
| 2xx and `parseCurrentConditions` returns a value | state `ready` with that value. |
| non-2xx, network error, `timeoutMs` elapsed (abort), JSON parse error, or `parseCurrentConditions` returns `null` | state `unavailable`. No automatic retry. |
| response or error for a request that is not the latest | discarded; no state change. |
| `retry()` in `unavailable` | same as `setLocation` with the remembered location: exactly one request. In any other state it does nothing. |
| `showDenied()` | aborts any request in flight, state `denied`. |
| `showLocationUnavailable()` | aborts any request in flight, state `no-location`. |

Rules: the controller never throws to its caller (any exception, including from `render`,
becomes `unavailable` or is swallowed); it writes nothing to `console`, cookies, Web
Storage, IndexedDB, `location` or `history`.

### 1.5 `page-shell.js` and `app.js`

```js
export function setLocationAll(consumers, lat, lon): void
//   calls consumer.setLocation(lat, lon) on each, each in its own try/catch.
export async function startShell({ requestLocation, consumers, onDenied = [], onUnavailable = [] }): Promise<void>
//   awaits requestLocation(), then:
//   position    -> setLocationAll(consumers, latitude, longitude)
//   denied      -> each function in onDenied, each in its own try/catch
//   unavailable -> each function in onUnavailable, each in its own try/catch
//   never rejects.
```

`app.js` (LIV-13 version; later stories append to the lists):

```js
const conditions = createCurrentConditions(document.querySelector('[data-testid="conditions-section"]'));
const consumers = [conditions];                       // LIV-15: outlook, LIV-16: map
const onDenied = [() => conditions.showDenied()];     // LIV-14: () => citySearch.show()
const onUnavailable = [() => conditions.showLocationUnavailable()];
startShell({ requestLocation, consumers, onDenied, onUnavailable });
// LIV-14: onPlaceSelected = (p) => setLocationAll(consumers, p.latitude, p.longitude)
```

This satisfies `contracts/ui/city-search.md` §6: `conditions.setLocation` from `denied`
replaces the denial message with `loading`, then `ready` or `unavailable`.

## 2. DOM contract (in `src/index.html`; stable selectors QA targets)

```html
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src https://api.open-meteo.com; base-uri 'none'; form-action 'none'; object-src 'none'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Weather</title>
  <link rel="stylesheet" href="css/app.css">
  <link rel="stylesheet" href="css/current-conditions.css">
  <script type="module" src="js/app.js"></script>
</head>
<body>
  <main>
    <h1>Weather</h1>
    <section data-testid="conditions-section" aria-labelledby="conditions-heading">
      <h2 id="conditions-heading">Current conditions</h2>
      <p data-testid="conditions-status" role="status" aria-live="polite">Finding your location…</p>
      <div data-testid="conditions-current" hidden>
        <p data-testid="conditions-temperature"></p>
        <p data-testid="conditions-text"></p>
      </div>
      <div data-testid="conditions-unavailable" hidden>
        <p>Weather is unavailable right now.</p>
        <button type="button" data-testid="conditions-retry">Try again</button>
      </div>
      <p data-testid="conditions-attribution" hidden>Weather data by
        <a href="https://open-meteo.com/" rel="noopener noreferrer" target="_blank">Open-Meteo.com</a></p>
    </section>
    <!-- LIV-14 city-search section, LIV-15 outlook-section, LIV-16 map-section follow here -->
  </main>
</body>
```

Links are relative (Pages serves under `/factory-sandbox/`). `index.html` contains no
inline script, no `<style>`, no `style=` attribute and no `on*=` attribute.

### States (exact texts)

| State | `conditions-status` text (visible) | `conditions-current` | `conditions-unavailable` | `conditions-attribution` |
|---|---|---|---|---|
| locating | `Finding your location…` | hidden | hidden | hidden |
| loading | `Loading current conditions…` | hidden | hidden | visible |
| ready | empty and hidden | visible: `conditions-temperature` e.g. `14°C`, `conditions-text` e.g. `Partly cloudy` | hidden | visible |
| unavailable | empty and hidden | hidden | visible: `Weather is unavailable right now.` + button `Try again` | visible |
| denied | `Location access was denied.` | hidden | hidden | hidden |
| no-location | `We couldn't determine your location.` | hidden | hidden | hidden |

- Leaving `ready` empties `conditions-temperature` and `conditions-text`, so no stale
  temperature or conditions text remains in the DOM in any other state.
- Accessible names: region "Current conditions"; button "Try again"; link "Open-Meteo.com".
- Message strings are exactly as in the AC, using the ASCII apostrophe U+0027 as typed
  there: `We couldn't determine your location.`

### Layout (S8, `src/css/app.css` and `src/css/current-conditions.css`)

- `*, *::before, *::after { box-sizing: border-box; }`, `body { margin: 0; }`,
  `main { max-width: 40rem; margin: 0 auto; padding: 1rem; }`.
- No fixed pixel widths; text uses `overflow-wrap: anywhere`; buttons have
  `min-height: 44px`.
- `[hidden] { display: none !important; }`.
- At a 360 px viewport `document.documentElement.scrollWidth <= 360`, and
  `conditions-temperature` and `conditions-text` are fully inside the viewport.

## 3. Service contract: Open-Meteo Forecast API, current block (consumed, not owned)

```
GET https://api.open-meteo.com/v1/forecast
    ?latitude=<lat rounded to 2 dp>&longitude=<lon rounded to 2 dp>
    &current=temperature_2m,weather_code
fetch options: { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal }
```

Fields used from a 200 response (all others ignored):

```json
{ "current": { "temperature_2m": 14.0, "weather_code": 2 } }
```

Error responses observed: HTTP 400 `{"error": true, "reason": "..."}`.

QA fixture guidance: stub `https://api.open-meteo.com/v1/forecast` (any query) with the
shape above; `weather_code` 2 is "Partly cloudy" (S2). Return HTTP 500 or abort for S5,
then fulfil normally for the "Try again" step. Use the browser's geolocation emulation:
grant and set the position for S2, deny for S3, and an emulated `POSITION_UNAVAILABLE`
or `TIMEOUT` error for S4 (or stub `navigator.geolocation.getCurrentPosition` to call its
error callback with code 2 or 3). Unit tests of `requestLocation` pass a fake
`geolocation` object.

## 4. Privacy rules (S7)

- The only request carrying coordinates goes to `https://api.open-meteo.com/v1/forecast`,
  with latitude and longitude at most 2 decimal places.
- No cookies, `localStorage`, `sessionStorage`, IndexedDB, Cache API or service worker.
- Coordinates never appear in the page URL, history, DOM or console.
