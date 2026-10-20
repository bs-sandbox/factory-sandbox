# 0005. Radar overlay: RainViewer past-radar tiles as a Leaflet layer on the location map
Status: Proposed
Date: 2026-10-20

Context:
- LIV-17 (Epic LIV-12, capability 4) adds a "Radar" toggle to the location map of LIV-16.
  The toggle is off by default. When it is on, a radar overlay is drawn, along with the text
  "Radar updated <time>", which takes its time from the data source and not the browser
  clock. The data source's attribution is visible. A failure shows "Radar is unavailable right
  now." and returns the toggle to off. Nothing is persisted, and the controls must fit a
  360 px phone screen.
- Constraints: free and keyless source with attribution, no accounts. The site is static on
  GitHub Pages under `/factory-sandbox/` and has no bundler. ADR 0004 (PR #8) adds a CSP
  meta tag, and each story extends it by exactly the hosts it needs. Location is personal
  data (Tier 3, Security Impact).
- This ADR builds on ADR 0001 (PR #5): Leaflet 1.9.4 with OSM raster tiles in
  `src/js/location-map.js`, which exposes `leafletMap` for LIV-17's layer
  (`contracts/ui/location-map.md` §1). It also builds on ADR 0004 (PR #8): the composition
  root is `src/js/app.js`, there is one stylesheet per feature, the app writes nothing to
  storage or the console, and controllers take an injected `render`.
- Service probe on 2026-10-20 (curl, run by the Architect):
  - `GET https://api.rainviewer.com/public/weather-maps.json` returned 200 with
    `application/json`, `access-control-allow-origin: *` and `cache-control: no-cache`.
    The body was `{"version":"2.0","generated":<unix s>,"host":"https://tilecache.rainviewer.com",
    "radar":{"past":[{"time":<unix s>,"path":"/v2/radar/<hex>"}, ... 13 frames, 10 min apart],
    "nowcast":[]},"satellite":{"infrared":[]}}`.
  - `GET https://tilecache.rainviewer.com/v2/radar/<id>/256/{z}/{x}/{y}/2/1_1.png` returned
    200 `image/png` with `access-control-allow-origin: *` and `max-age=172800` at z6 and z7.
    At z8 and z10 it returned the same 1370-byte image (same SHA-256 for different x/y), so
    the free tier serves a placeholder above z7. An unknown frame path returned 404.
  - The requests sent no Referer and no Origin, and they were served.
- RainViewer API page (https://www.rainviewer.com/api.html, read 2026-10-20) says:
  "free for personal or educational use". Attribution such as "Weather data by RainViewer"
  with a link to rainviewer.com is mandatory. There is no key, no SLA and no posted rate
  limit, and abusive clients may be IP-blocked.

Decision:
1. Radar source: RainViewer's public API. The frame list comes from
   `https://api.rainviewer.com/public/weather-maps.json`, and tiles come from
   `https://tilecache.rainviewer.com`. Only `radar.past` is used. `nowcast` and satellite
   are not used, because forecast radar and other layers are out of scope.
2. Latest frame and timestamp: the entry of `radar.past` with the largest `time` is the
   latest frame. The `time` value (unix seconds, from the source) is the only input to the
   timestamp. The browser clock is never used to make or adjust it. The timestamp is shown
   as `Radar updated <h:mm AM/PM> <zone>`, formatted with
   `Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })`
   in the browser's time zone. Every whitespace character in the result (ICU may emit
   U+202F or U+00A0) is replaced by U+0020. Example: 1792530600 in America/Los_Angeles
   gives `Radar updated 2:10 PM PDT` (LIV-17 S3).
3. Strict response validation. Any failure counts as "radar unavailable":
   - the response is not 2xx, the body is not JSON, or `radar.past` is not a non-empty
     array;
   - the chosen `time` is not a positive safe integer;
   - the chosen `path` does not match `^/v2/radar/[A-Za-z0-9_-]{1,64}$`.

   The response's `host` field is ignored. The tile host is the constant
   `https://tilecache.rainviewer.com`, so a response can't redirect tile loads to another
   host, and the CSP allows only that host.
4. Request handling, following ADR 0002 decision 3 and ADR 0004 decision 2: one `fetch` per
   turn-on, with `credentials: "omit"`, `cache: "no-store"`, `referrerPolicy: "no-referrer"`,
   an `AbortController` and a 10 s timeout. There is no automatic retry, no polling and no
   refresh while the radar is on (animation and refresh are out of scope). Turning the
   toggle off aborts an in-flight request. Each turn-on gets a generation number, and any
   callback from an older generation is ignored.
5. Overlay layer: one Leaflet `tileLayer` added to `locationMap.leafletMap`.
   - Template: `https://tilecache.rainviewer.com{path}/256/{z}/{x}/{y}/2/1_1.png`, which
     uses colour scheme 2 and options `1_1` (smoothed, snow shown).
   - Options: `tileSize: 256`, `opacity: 0.7`, `zIndex: 10`, `maxNativeZoom: 7`,
     `maxZoom: 19`, `referrerPolicy: "no-referrer"`, and the attribution in item 7.
     `crossOrigin` is not set.
   - With `maxNativeZoom: 7`, Leaflet requests z≤7 tiles and scales them up, so the
     placeholder tiles above z7 are never requested.
   - The layer is created on each turn-on and removed on turn-off or failure.
6. Failure detection mirrors the rules for the map in `contracts/ui/location-map.md` §3.
   The radar is unavailable when any of these happens:
   - the frame request fails (item 3 or 4);
   - `locationMap.leafletMap` is null when the radar is turned on;
   - the layer's first `load` event comes with zero `tileload` and at least one `tileerror`;
   - 15 s pass with no `tileload`;
   - set-up throws.

   On failure the layer is removed, the toggle is unchecked, no timestamp is shown, and
   "Radar is unavailable right now." is shown (S6). The radar counts as "on", and the
   timestamp is shown, only after the first `tileload`.
7. Attribution: the layer's `attribution` option is
   `Weather data by <a href="https://www.rainviewer.com/">RainViewer</a>`, a constant
   string. Leaflet shows it in the map's attribution control next to the OSM credit while
   the layer is on, and removes it when the layer is removed (S5). It is always visible,
   with no collapse.
8. UI placement: the toggle, timestamp and message sit in a bar
   (`[data-testid="radar-controls"]`) inside the map section, directly above the map
   canvas. The bar is outside the Leaflet container, so it can never cover the attribution
   control (S8). The toggle is a native checkbox with `role="switch"` and the label "Radar".
9. Modules, following ADR 0004 decision 5:
   - `src/js/radar-model.js` is pure: frame parsing and validation, the tile URL and
     timestamp formatting.
   - `src/js/radar-overlay.js` holds a controller with an injected `render`, `fetch`,
     `leaflet` and timers, plus the DOM binding.
   - `src/css/radar.css` holds the styles.
   - `app.js` creates it with the LIV-16 map controller.
   - No new npm dependency.
10. CSP (ADR 0004 decision 7): add `https://api.rainviewer.com` to `connect-src` and
    `https://tilecache.rainviewer.com` to `img-src`. Nothing else changes.
11. Privacy:
    - The frame request carries no location.
    - Tile requests carry only z/x/y at z≤7, about 313 km per tile at the equator, so
      RainViewer learns at most a coarse region plus the IP address, and only while the
      radar is on.
    - No Referer is sent to RainViewer.
    - The toggle state is held in memory only. Nothing is written to cookies, Web Storage,
      IndexedDB, Cache API or the URL, and nothing is logged (S7).

Alternatives:
- NOAA/NWS or Iowa Environmental Mesonet NEXRAD tiles: rejected. They are keyless but
  cover the US only, while the app is global (LIV-14 city search). IEM is a university
  service with no stated capacity for third-party apps.
- National services such as DWD, Met Office or MET Norway: rejected. They are
  single-country, or need registration or keys for tiles.
- Commercial radar (Tomorrow.io, OpenWeatherMap precipitation layer, MapTiler weather):
  rejected. They need an API key, which the Epic forbids.
- Using the response's `host` field for tiles: rejected. It would let response content
  choose an image host. Item 3 fixes the host instead.
- Requesting native zoom above 7: rejected. The free tier returns a placeholder image
  there, as the probe showed.
- A Leaflet control inside the map for the toggle: rejected. At 360 px it competes with
  the zoom, Recentre and attribution controls for space, which risks S8.
- Animating the past frames: rejected because animation is out of scope.
- Taking the timestamp from the browser clock or `generated`: rejected. The story requires
  the time of the latest frame from the source.

Consequences:
- Easier: the radar is one more raster layer on the existing map, with no new library.
  Changing provider means changing the model's URL constants, the attribution and two CSP
  hosts.
- Harder: we depend on a best-effort free service. Its terms are "personal or educational
  use", which a human owner must confirm fits this product (see the LIV-17 approval
  request). It has no SLA, and the z7 cap and colour schemes could change. S6 covers
  outages. The z7 cap makes the radar look coarse at street zoom (15), and the data allows
  no better.
- The toggle may show "on" while the map later becomes unavailable (LIV-16 S6), because
  the map contract has no state-change event. Turning the radar on while the map is
  unavailable shows the radar-unavailable message. This case is outside the LIV-17 AC; a
  follow-up could add an additive `onStateChange` to the map contract.
- Follow-up: if RainViewer's terms or limits change, the provider decision is revisited
  through a new ADR.

Related: LIV-12 (Epic), LIV-17, LIV-16 / ADR 0001, LIV-13 / ADR 0004, ADR 0002;
contract `contracts/ui/radar-overlay.md`.
