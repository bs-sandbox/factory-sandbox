# UI contract: city search (LIV-14)

Status: Proposed (ADR 0003). The rules here are backward compatible additions. Removing or
renaming a `data-testid`, an accessible name, or a message string is a breaking change.

## 1. Modules

| File | Kind | Exports |
|---|---|---|
| `src/js/city-search-model.js` | pure, no DOM, no network | `MAX_QUERY_LENGTH = 100`, `MAX_RESULTS = 10`, `normalizeQuery(raw)`, `buildSearchUrl(query)`, `parseSearchResponse(json)`, `formatPlaceLabel(place)` |
| `src/js/city-search.js` | controller + view | `createCitySearch({ root, fetchImpl = fetch, timeoutMs = 10000, onPlaceSelected })` returns `{ show(), hide(), destroy() }` |

### 1.1 Model functions

- `normalizeQuery(raw: string): string | null`: trims ASCII and Unicode whitespace
  (`String.prototype.trim`) and returns `null` if the result is empty. If the result is longer
  than 100 UTF-16 code units, it is cut to 100.
- `buildSearchUrl(query: string): string` returns
  `https://geocoding-api.open-meteo.com/v1/search?name=<query>&count=10&language=en&format=json`.
  It is built with `URL`/`URLSearchParams`, which encodes the query. No other parameters are added.
  The origin and path come from a module-level `const` `https` string. Nothing read from the
  page URL, `location`, storage, `fetchImpl` arguments or configuration can change them.
- `parseSearchResponse(json: unknown)` returns `{ kind: "results", places: Place[] }` (1–10 places),
  `{ kind: "none" }`, or `{ kind: "error" }`:
  - It returns `error` when `json` is not a plain object, has `error === true`, or has a
    `results` that is present but not an array.
  - It returns `none` when `results` is missing or is `[]`.
  - Each text field (`name`, `admin1`, `country`) is cleaned before it is checked, in this
    order: (1) if it is not a `string`, it counts as absent; (2) every C0 control
    (U+0000–U+001F), U+007F, C1 control (U+0080–U+009F) and bidi control (U+202A–U+202E,
    U+2066–U+2069) is removed; (3) the result is trimmed with `String.prototype.trim`;
    (4) an empty result counts as absent; (5) a result longer than 200 UTF-16 code units is
    cut to 200.
  - `latitude` and `longitude` must have `typeof === "number"`, be finite, and lie in
    [-90, 90] and [-180, 180] respectively. Numeric strings such as `"48.85"` are invalid;
    there is no coercion.
  - Entries without a cleaned non-empty `name` and valid `latitude` and `longitude` are dropped.
    Entries that are not plain objects are dropped.
  - Each `Place` is a **new** plain object literal built from the five whitelisted fields only.
    The raw entry is never spread, passed to `Object.assign`, or returned, and keys such as
    `__proto__`, `constructor` or `prototype` are never copied.
  - If the original `results` had entries but none survive, it returns `error`.
  - It keeps at most the first 10 valid entries, in service order.
  - `Place = { name: string, region: string | null, country: string | null, latitude: number, longitude: number }`.
    `region` comes from the cleaned `admin1` and `country` from the cleaned `country`. An
    absent field becomes `null`. `latitude` and `longitude` are the validated numbers, unchanged.
- `formatPlaceLabel(place)` joins the non-null parts `name`, `region`, `country` with `", "`.
  Examples: `Springfield, Illinois, United States` and `Singapore, Singapore`. A region equal
  to the name is still shown, so the label stays predictable.

### 1.2 Controller behaviour

| Trigger | Effect |
|---|---|
| `show()` | Section visible, idle state, input focused. Called by the page shell when geolocation permission is **denied** (LIV-13 S3). Not called in any other geolocation state. |
| submit (button click or Enter in the input) | `event.preventDefault()`. Then `normalizeQuery(input.value)`. If the result is `null`, the controller enters the `empty` state and makes **no** fetch. Otherwise it aborts any request in flight, enters `searching`, and fetches `buildSearchUrl(q)`. |
| fetch resolves with 2xx and parseable JSON | `parseSearchResponse`, then the `results`, `none` or `error` state. |
| non-2xx, network error, JSON parse error, or `timeoutMs` elapsed (abort) | `error` state. |
| response for a request that is no longer the latest | discarded with no state change. |
| results entry activated (click, Enter or Space on its button) | Calls `onPlaceSelected(place)` once, then enters the `selected` state. |
| `hide()` / `destroy()` | Section hidden. `destroy` aborts any request in flight and removes listeners. |

`onPlaceSelected` errors are caught and never break the search. Nothing is written to
`console`, cookies, `localStorage`, `sessionStorage`, IndexedDB, `location` or `history`.

## 2. DOM (in `src/index.html`, inside `main`)

```html
<section data-testid="city-search" aria-labelledby="city-search-heading" hidden>
  <h2 id="city-search-heading">Search for a city</h2>
  <form data-testid="city-search-form" role="search" novalidate>
    <label for="city-search-input">City name</label>
    <input id="city-search-input" data-testid="city-search-input" type="search"
           maxlength="100" autocomplete="off" autocapitalize="words" spellcheck="false">
    <button type="submit" data-testid="city-search-submit">Search</button>
  </form>
  <p data-testid="city-search-status" role="status" aria-live="polite"></p>
  <ul data-testid="city-search-results" aria-label="Matching places" hidden></ul>
  <p data-testid="city-search-attribution">Place search by
    <a href="https://open-meteo.com/" rel="noopener noreferrer" target="_blank">Open-Meteo.com</a>,
    data from <a href="https://www.geonames.org/" rel="noopener noreferrer" target="_blank">GeoNames</a></p>
</section>
```

Rules for this markup:

- The input has **no `name` attribute** and the form has no `action` or `method`, so even
  if script fails and a native submit happens, the query isn't put in a URL. The section
  starts `hidden` and only script shows it.
- Every `target="_blank"` link has `rel` containing both `noopener` and `noreferrer`. The
  `href`s are fixed literals.
- `city-search*.js` never uses `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
  `document.write`, `DOMParser`, `createContextualFragment` or HTML template strings.
  Elements are made with `createElement`, and untrusted text (the echoed query and
  service strings) is set only through `textContent`.

Each result is rendered with `textContent` only:

```html
<li data-testid="city-search-result">
  <button type="button" data-testid="city-search-result-button">Springfield, Illinois, United States</button>
</li>
```

Accessible names QA can target: textbox **"City name"**, button **"Search"**, list
**"Matching places"**, and one button per result whose name is the place label.

## 3. States and exact messages (`city-search-status` text)

| State | Status text | Results list | Search button |
|---|---|---|---|
| idle | (empty) | hidden, empty | enabled |
| empty | `Enter a city name.` | hidden, empty | enabled |
| searching | `Searching…` | hidden, empty | enabled (a new submit supersedes) |
| results | (empty) | visible, 1–10 `city-search-result` | enabled |
| none | `No places found for "<q>".` where `<q>` is the trimmed query | hidden, empty | enabled |
| error | `Search is unavailable right now.` | hidden, empty | enabled |
| selected | (empty) | hidden, empty | enabled. The input keeps its text so the user can search again. |

The attribution stays visible in every state while the section is visible.

## 4. Layout (360 px)

- Single column, with no fixed widths.
- The input is `width: 100%` with `box-sizing: border-box`.
- Status text and result buttons use `overflow-wrap: anywhere`, so a 100-character query
  with no spaces can't cause horizontal scroll.
- Result buttons are full width, with a touch target at least 44 px tall.

## 5. External request (consumed, not owned)

- Host: `geocoding-api.open-meteo.com` only. Method `GET`, with no body and no custom
  headers. Fetch options: `credentials: "omit"`, `cache: "no-store"`, `referrerPolicy: "no-referrer"`,
  `signal` (an `AbortController` aborted by a newer submit, by `destroy()`, or after `timeoutMs`).
  Each request has an increasing id, and a response whose id isn't the latest is discarded.
- The URL always comes from `buildSearchUrl` (§1.1). There is no other code path to the network.
- Response fields read: `results[].name`, `results[].latitude`, `results[].longitude`,
  `results[].admin1`, `results[].country`, and top-level `error`. All other fields are ignored.

## 6. Integration points owned by the page shell (LIV-13)

- The shell calls `citySearch.show()` when geolocation permission is denied.
- The shell passes `onPlaceSelected(place)`, which calls `setLocation(place.latitude,
  place.longitude)` on current conditions (LIV-13), the outlook (LIV-15, ADR 0002 contract)
  and the map (LIV-16, ADR 0001 contract), each one wrapped so a failure in one consumer
  doesn't stop the others.
- `conditions.setLocation(lat, lon)` must replace the conditions area's denial message with
  the loading, conditions or failure states in LIV-13's format (LIV-14 S3).
- The LIV-13 shell has a CSP meta tag (ADR 0004, `contracts/ui/current-conditions.md`). LIV-26
  adds `https://geocoding-api.open-meteo.com` to its `connect-src`, and changes nothing else
  in the policy. Without that addition the browser blocks the search request.
