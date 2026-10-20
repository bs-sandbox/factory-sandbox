# 0003. City search uses the keyless Open-Meteo Geocoding API, queried from the browser on submit
Status: Proposed
Date: 2026-10-20

Context:
- LIV-14: when the user denies geolocation, they can search for a city by name and see
  current conditions for a match they pick. Epic LIV-12 sets the constraints: a static site on
  GitHub Pages, no server, no accounts, no API keys, free keyless services with attribution, and
  nothing stored server-side or in the browser.
- The typed text may be sent only to the place-search service (LIV-14 S7). That text is
  user-supplied and may be personal (a home town or an address), so the story is Tier 3.
- ADR 0002 (PR #6, Proposed) already picks Open-Meteo for weather data. ADR 0001 (PR #5,
  Proposed) has location consumers expose `setLocation(lat, lon)`. City search is a second
  location source next to geolocation (LIV-13).
- What I observed of the service on 2026-10-20 (curl from the Architect sandbox):
  - `GET https://geocoding-api.open-meteo.com/v1/search?name=Springfield&count=10&language=en&format=json`
    returns 200 with `results[]`. Each result has `name`, `latitude`, `longitude`, `country`
    and `admin1`, plus fields we ignore.
  - The service returns `access-control-allow-origin: *` and `cache-control: public, max-age=86400`.
  - `name=xqzvwk`, an empty `name` and a 1-character `name` each return 200 with no `results` key.
  - `count=101` returns `{"error":true,"reason":"Parameter count must be between 1 and 100."}`.
  - `name=Singapore` returns results with no `admin1`, so the region is optional.

Decision:
1. Place search calls the Open-Meteo Geocoding API directly from the browser, once per
   submit. It doesn't autocomplete and doesn't retry automatically. Request:
   `GET https://geocoding-api.open-meteo.com/v1/search?name=<trimmed text>&count=10&language=en&format=json`.
   The URL is built with `URLSearchParams`. The fetch options are `credentials: "omit"`,
   `cache: "no-store"`, `referrerPolicy: "no-referrer"`, and an `AbortController` with a 10 s timeout.
2. Limits:
   - The query is trimmed and must be 1–100 characters (`maxlength="100"` on the input,
     re-checked in code). If the trimmed text is empty, no request is made.
   - At most 10 results are requested and at most 10 are shown, in the service's order.
3. Response handling is strict:
   - A non-2xx status, `error: true`, invalid JSON, a timeout or a network error means
     the service is unavailable.
   - A missing or empty `results` means no match.
   - An entry is dropped unless it has a non-empty string `name`, a finite `latitude` in
     [-90, 90] and a finite `longitude` in [-180, 180]. `admin1` and `country` are optional
     strings and are left out of the label when absent.
   - Text fields have C0/C1 and bidi control characters removed, are trimmed, and are capped
     at 200 characters. Coordinates must be real numbers; strings aren't coerced. Each kept
     entry is copied field by field into a new object, so nothing else from the raw entry
     gets through (THREAT-MODEL T2, LIV-14 comment 10101).
   - If `results` is non-empty but every entry is dropped, the service is treated as unavailable.
4. Only the latest search counts. A new submit aborts the request in flight, and a response
   from a superseded request is discarded.
5. Privacy:
   - The form submit is cancelled (`preventDefault`), so the query never reaches the page
     URL or session history.
   - The input has `autocomplete="off"`, so the browser's form history doesn't keep it.
   - The input has no `name` attribute and the section is shown only by script, so a native
     submit can't carry the query. The geocoder origin is a hard-coded `https` constant that
     nothing can override.
   - The LIV-13 CSP (ADR 0004) gets `https://geocoding-api.open-meteo.com` added to `connect-src`.
   - Nothing goes to cookies, Web Storage or IndexedDB, and the query and coordinates are
     never logged (`console` included).
6. All service text and user text is rendered with `textContent` only. No HTML-parsing sink
   (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `DOMParser`,
   `createContextualFragment`) is used in the city-search modules (THREAT-MODEL T1).
7. When the user selects a match, the module calls the injected `onPlaceSelected({ name, region,
   country, latitude, longitude })`. The page shell (LIV-13) passes the latitude and longitude
   on to every location consumer's `setLocation(lat, lon)`, following ADR 0001: current
   conditions, the outlook (LIV-15) and the map (LIV-16). Consumers round coordinates as
   their own ADRs require (ADR 0002: 2 dp).
8. Attribution: "Place search by Open-Meteo.com, data from GeoNames" links to
   https://open-meteo.com/ and https://www.geonames.org/. It is visible whenever the search
   section is visible.
9. No new runtime or dev dependency is added.

Alternatives:
- Nominatim (OpenStreetMap): keyless, but its usage policy asks for an identifying
  User-Agent/Referer (the browser can't set User-Agent, and Decision 1 sends no referrer).
  It allows at most 1 request per second and forbids autocomplete-style use. It is also
  a second vendor next to ADR 0002's Open-Meteo. Rejected.
- Photon (komoot): keyless, but it offers no service-level commitment and adds a second
  vendor. Rejected.
- A bundled static gazetteer: no third-party call for the text, but it adds megabytes to
  the page, goes stale, and needs a build step. Rejected.
- Query-as-you-type: out of scope (LIV-14 description) and sends more of the user's text.
  Rejected.
- Putting the query in the URL (`?q=`) so results can be shared: that writes the search to
  history, which conflicts with "no browser persistence of searches". Rejected.

Consequences:
- Easier:
  - The weather and place lookups use one vendor and one attribution pattern.
  - No key is needed, and CORS is open.
- Harder:
  - We depend on a free, non-commercial, fair-use third-party host, with no fallback.
  - The 1-character queries and "no match" behaviour are the service's.
  - GeoNames data needs CC BY 4.0 attribution.
- Follow-up:
  - LIV-13's design must expose the shell hooks this ADR assumes: a "denied" signal that
    shows the search, and `conditions.setLocation(lat, lon)`.
  - If ADR 0001 or 0002 is revised, re-check Decision 7.

Related: LIV-14, LIV-13, LIV-15, LIV-16, Epic LIV-12; ADR 0001 (PR #5), ADR 0002 (PR #6);
contract `contracts/ui/city-search.md`.
