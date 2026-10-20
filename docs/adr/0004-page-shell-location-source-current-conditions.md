# 0004. Page shell, geolocation source and current conditions
Status: Proposed
Date: 2026-10-20

Context:
- LIV-13 (Epic LIV-12, capability 1) shows the current temperature and conditions for the
  browser's geolocated position. It also delivers the page shell that LIV-14 (city search),
  LIV-15 (10-day outlook), LIV-16 (map) and LIV-17 (radar) extend.
- Epic constraints: static site on GitHub Pages under `/factory-sandbox/` (relative links
  only), no accounts, no API keys, free keyless services with attribution, nothing stored
  server-side, and the location leaves the browser only as latitude/longitude sent to the
  weather service (and, later, tile coordinates sent to the tile service). Coordinates are
  personal data, so the story is Tier 3 with Security Impact and Data Impact.
- The repo has no bundler. `npm run build` copies `src/` to `dist/` and `npm test` runs
  `node --test` (`.github/workflows/ci.yml`). There is no DOM library in the repo.
- Proposed ADRs this one must fit:
  - ADR 0001 (PR #5, LIV-16): one native ES module per feature in `src/js/`, each behind a
    contract in `contracts/ui/`, fed by `setLocation(lat, lon)` from the location source.
  - ADR 0002 (PR #6, LIV-15): the Open-Meteo Forecast API as the weather service, the
    request-handling pattern, and the shared WMO code table in `src/js/weather-codes.js`.
  - ADR 0003 (PR #7, LIV-14): the shell calls `citySearch.show()` on permission denial and
    fans out `onPlaceSelected` to every consumer's `setLocation` (contract
    `contracts/ui/city-search.md` §6).
- Service probe on 2026-10-20 (curl): `GET https://api.open-meteo.com/v1/forecast?latitude=47.61&longitude=-122.33&current=temperature_2m,weather_code`
  returned 200 with `current.temperature_2m` (number, °C) and `current.weather_code`
  (integer), and `access-control-allow-origin: *` when an `Origin` header was sent. An
  out-of-range latitude returned 400 with `{"error":true,"reason":...}`.
- Security's LIV-15 threat model (LIV-15 comment 10080) recommended that the page shell add
  a Content-Security-Policy. GitHub Pages cannot set response headers, so a `<meta>` tag is
  the only option.

Decision:
1. Weather service: adopt ADR 0002 decision 1 (Open-Meteo Forecast API, attribution
   "Weather data by Open-Meteo.com" linked to `https://open-meteo.com/`). No new provider.
   Current conditions use one request:
   `GET https://api.open-meteo.com/v1/forecast?latitude=<lat>&longitude=<lon>&current=temperature_2m,weather_code`.
   No other parameters are sent. Units are the API defaults (°C).
2. Request handling: adopt ADR 0002 decision 3 (coordinates rounded to 2 decimal places,
   `credentials: "omit"`, `cache: "no-store"`, `AbortController`, 10 s timeout, a response
   applied only if it belongs to the latest request, no automatic retry, no polling). In
   addition the conditions request sets `referrerPolicy: "no-referrer"` (Security's
   defence-in-depth note in LIV-15 comment 10080). The tile requests of ADR 0001 keep the
   default policy because the OSM tile policy needs a Referer.
3. Shared helpers, created by LIV-13 because it merges first:
   - `src/js/weather-codes.js` exactly as `contracts/ui/daily-outlook.md` §4 specifies.
     LIV-15 reuses it and does not re-create it.
   - `src/js/format.js` with `roundCoordinate` (2 dp) and `formatTemperature`
     (`Math.round`, no negative zero, ASCII hyphen-minus, `<n>°C`). These are the rules of
     ADR 0002 decision 4. LIV-15's `daily-outlook-model.js` may re-export them so its
     contract stays as written.
4. Location source: `src/js/location-source.js` calls
   `navigator.geolocation.getCurrentPosition` once, when the entry module runs (modules run
   after the document is parsed, so the prompt appears as the page finishes loading, S1),
   with `{ enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }`. The Geolocation
   `timeout` does not count time spent waiting for the user to answer the prompt, so S1 is
   unaffected. It resolves (never rejects) to one of `position`, `denied` (error code 1) or
   `unavailable` (code 2, code 3, any other failure, missing Geolocation API, or non-finite
   coordinates). There is no watch and no auto-refresh (out of scope).
5. Current conditions: a pure model `src/js/current-conditions-model.js` (URL building and
   strict response validation, unit-testable in Node) and a controller/view
   `src/js/current-conditions.js`. The controller's state machine takes an injected
   `render(view)` function so it is unit-testable in Node without a DOM library. The view
   uses `createElement`/`textContent` only, never `innerHTML` or similar with any value.
   Conditions text comes only from `weather-codes.js`; no response string is ever shown.
6. Page shell and composition root:
   - `src/index.html` holds one `<section>` per feature in this order: current conditions,
     city search (LIV-14), outlook (LIV-15), map (LIV-16, radar inside it). Each later story
     adds its own section, module and stylesheet `src/css/<feature>.css`.
   - `src/js/app.js` is the only entry module (`<script type="module" src="js/app.js">`).
     It creates the feature controllers and passes them to `startShell` in
     `src/js/page-shell.js`, which routes the location result: `position` calls
     `setLocation(lat, lon)` on every registered consumer; `denied` runs every registered
     denial handler; `unavailable` runs every unavailable handler. Each call is wrapped in
     its own `try/catch`, so one failing feature never stops the others.
   - Later stories register by adding to the `consumers` and `onDenied` lists in `app.js`.
     LIV-14's `onPlaceSelected` calls the same `setLocationAll` function.
   - Shell stylesheet `src/css/app.css`: mobile-first single column, `max-width: 40rem`,
     `box-sizing: border-box` everywhere, no fixed pixel widths, `overflow-wrap: anywhere`
     on text, 44 px minimum touch targets, and `[hidden] { display: none !important; }`.
7. Content-Security-Policy as the first element after `<meta charset>` in `<head>`:
   `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src https://api.open-meteo.com; base-uri 'none'; form-action 'none'; object-src 'none'`.
   - No inline scripts, inline `<style>`, `style="..."` attributes or `on*=` handler
     attributes are allowed in `src/index.html`. A Node test enforces this.
   - Each later story extends the policy by exactly the host it needs: LIV-14 adds
     `https://geocoding-api.open-meteo.com` to `connect-src`; LIV-16 adds
     `https://tile.openstreetmap.org` to `img-src`; LIV-17 adds its radar host. Any change
     to the policy is in Security Review scope.
   - Setting element styles from JavaScript (as Leaflet does) is not blocked by
     `style-src 'self'`; only markup `style` attributes and inline `<style>` are.
8. Privacy: nothing is persisted (no cookies, Web Storage, IndexedDB, Cache API or service
   worker). Coordinates are never written to the page URL or history, never put in the DOM,
   and never logged. The app writes nothing to `console`.
9. No new npm dependency.

Alternatives:
- A different weather provider for current conditions (MET Norway, NWS): rejected for the
  reasons in ADR 0002. One provider keeps one attribution and one `connect-src` entry.
- Deriving current conditions from the hourly forecast: rejected. The `current` block is
  provided by the API and needs no time-zone logic.
- Asking for location only after a user gesture ("Use my location" button): rejected. S1
  requires the prompt when the page finishes loading.
- `watchPosition` or periodic refresh: rejected. Auto-refresh is out of scope and it would
  send the location repeatedly.
- jsdom (or a similar DOM library) for controller tests: rejected for now. It is a new
  dependency. Injecting `render` keeps the logic testable; the DOM is covered by QA's
  browser acceptance tests.
- No CSP: rejected. XSS would then rely only on code discipline (LIV-15 threat model T1).
- A `<meta name="referrer" content="no-referrer">` for the whole page: rejected. It would
  break the OSM tile policy for LIV-16.
- Feature modules wiring each other directly: rejected. One composition root keeps the
  dependency direction one-way (`app.js` → features) and lets each story add one line.

Consequences:
- Easier: LIV-14, LIV-15 and LIV-16 each add a section, a stylesheet, a CSP host and one
  registration line. `weather-codes.js` and `format.js` exist before LIV-15 starts.
- Harder: every new external host needs a CSP change, or the browser blocks it (this is
  intended). A browser that does not answer the prompt (for example a dismissed prompt in
  some browsers) leaves the page in the "Finding your location…" state, because S1 forbids
  showing anything else before the user responds.
- Follow-up: LIV-15's LIV-21 reuses `weather-codes.js` instead of creating it. LIV-14,
  LIV-16 and LIV-17 extend the CSP. Security's threat model for LIV-13 may change the
  policy or add requirements.

Related: LIV-12, LIV-13, LIV-14, LIV-15, LIV-16, LIV-17, ADR 0001, ADR 0002, ADR 0003,
`contracts/ui/current-conditions.md`.
