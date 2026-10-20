# 0002. Daily outlook: Open-Meteo forecast API, browser-side fetch, shared weather-code labels
Status: Proposed
Date: 2026-10-20

Context:
- LIV-15 (Epic LIV-12, capability 2) shows a 10-day daily outlook: weekday and date, high,
  low, conditions text and chance of precipitation, in °C only. It must handle fewer than
  10 days (S5), a service failure with "Try again" (S6), a location change from city search
  (S7), and a 360 px phone viewport (S8).
- Epic constraints: static site on GitHub Pages under `/factory-sandbox/` (relative links
  only), no accounts, no API keys, free keyless services with attribution, nothing stored
  server-side, and the location leaves the browser only as latitude/longitude in requests
  to the weather (and tile) services. Coordinates are personal data, so the story is Tier 3
  with Security Impact.
- The repo has no bundler. `npm run build` copies `src/` to `dist/`. ADR 0001 (LIV-16)
  set the pattern: native ES modules in `src/js/`, one module per page feature behind a
  contract in `contracts/ui/`, fed by `setLocation(lat, lon)` from the location source
  (LIV-13) and city search (LIV-14).
- LIV-13 (current conditions) needs the same weather service and the same condition texts
  ("Partly cloudy" in LIV-13 S2, "Light rain" in LIV-15 S2). No weather-service ADR exists
  yet.

Decision:
1. Weather service: the Open-Meteo Forecast API,
   `GET https://api.open-meteo.com/v1/forecast`. It is free for non-commercial use, needs no
   key or account, sends CORS headers, and supports per-location time zones. Its data is
   CC BY 4.0, so attribution "Weather data by Open-Meteo.com" linked to
   `https://open-meteo.com/` is shown with the outlook. This ADR is also the proposed
   weather-service decision for LIV-13. LIV-13's design should reference it, not choose
   again.
2. Daily request (exact query, nothing else added):
   `latitude=<lat>&longitude=<lon>&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=10`.
   - `lat`/`lon` are rounded to 2 decimal places (about 1 km) before sending. That is well
     within the model grid resolution, so the forecast does not change, and less precise
     personal data leaves the browser.
   - `timezone=auto` makes `daily.time[0]` today's date at the location (S1), whatever
     the device time zone is.
   - Units are the API defaults (°C, %). No unit parameters are sent.
3. Request handling: `fetch` with `credentials: "omit"`, `cache: "no-store"`, the default
   Referer policy (the page URL never holds coordinates, per ADR 0001 decision 5), an
   `AbortController`, and a 10 s timeout. Each `setLocation` aborts any request in flight,
   and a response is applied only if it belongs to the latest request (S7). A non-2xx
   status, a network error, a timeout, a JSON parse error, or a response that fails
   validation (decision 4) all become the single "unavailable" state with "Try again" (S6).
   "Try again" re-sends the same request for the current location. There is no automatic
   retry and no polling.
4. Validation and mapping are done in a pure module (`src/js/daily-outlook-model.js`) with
   no DOM or network access, so it is unit-testable under `node --test`:
   - `daily.time` must be an array of `YYYY-MM-DD` strings. Otherwise the response is
     invalid.
   - Days are read in array order (the API returns them ascending) up to a maximum of 10.
   - The list ends at the first day whose high, low, weather code or precipitation chance
     is null or not a finite number. Earlier days are shown. If day 1 is incomplete, or the
     arrays are empty, the response counts as unavailable. This keeps dates consecutive and
     never renders an empty or partial entry (S5).
   - Temperatures: `Math.round`, negative zero shown as `0`, and an ASCII hyphen-minus for
     negatives, formatted `<n>°C` with no space (S2, S4).
   - Precipitation chance: `Math.round`, clamped to [0, 100], formatted `<n>%` (S3).
   - Date label: `Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })`
     applied to the `YYYY-MM-DD` date as UTC midnight, for example `Tue 20 Oct`. Formatting
     in UTC means the device time zone can never shift the date.
   - Conditions: the WMO weather code is mapped by a shared table in
     `src/js/weather-codes.js` (contract `contracts/ui/daily-outlook.md` section 4). An
     unknown code maps to "Unknown". LIV-13 reuses the same table.
5. Rendering uses `textContent` and `createElement` only, never `innerHTML` with service
   data, so a hostile or corrupted response cannot inject markup. The outlook lives in one
   module, `src/js/daily-outlook.js`, behind `contracts/ui/daily-outlook.md`. It never
   throws into the page, and its failure does not affect other sections.
6. Nothing is persisted. No cookies, Web Storage or IndexedDB are used, and coordinates are
   not logged.
7. No new npm dependency.

Alternatives:
- MET Norway Locationforecast: rejected. It requires an identifying `User-Agent`, which a
  browser `fetch` cannot set (it is a forbidden header), and it returns time series
  without daily high/low aggregates, so the browser would have to build them.
- US NWS api.weather.gov: rejected. It is US-only, and the Epic has no geographic limit.
- Deriving daily values from Open-Meteo hourly data in the browser: rejected. It is larger
  and needs more code, and the API already aggregates in the location's time zone.
- Showing "—" for missing values instead of truncating: rejected. It conflicts with S8
  ("each shows all five items").
- A third-party date or i18n library: rejected because `Intl` is built in.

Consequences:
- Easier: LIV-13 can reuse the provider, the request pattern and `weather-codes.js`. The
  model module is fully testable in Node without a DOM.
- Harder: Open-Meteo's free tier is non-commercial with fair-use rate limits. If the app
  becomes commercial, a different plan or provider needs a new ADR. All weather requests
  depend on one third-party host, with no fallback.
- Follow-up: LIV-13's design should adopt decisions 1, 3 and 4 (shared labels) or
  supersede them explicitly. The threat model from Security may add requirements.

Related: LIV-12, LIV-15, LIV-13, LIV-14, LIV-16, ADR 0001.
