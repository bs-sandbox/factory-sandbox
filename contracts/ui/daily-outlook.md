# UI, module and service contract: 10-day daily outlook (LIV-15)

Version: 1.0.0. Status: Proposed with ADR 0002.
Changes are backward compatible by default. Renaming or removing anything below is a
breaking change and needs a new version (Tier 3).

## 1. Module interface: `src/js/daily-outlook.js` (native ES module)

```js
// Creates the outlook controller. It renders nothing until the first setLocation call.
// `root` is the element with data-testid="outlook-section" (section 2).
export function createDailyOutlook(root, options?) -> DailyOutlook

// options (all optional; the defaults are the production values):
//   endpoint:   string    default "https://api.open-meteo.com/v1/forecast"
//   timeoutMs:  number    default 10000
//   fetch:      function  default globalThis.fetch (injectable for tests)

interface DailyOutlook {
  // Show the section and load the outlook for (lat, lon). Called by the location source
  // (LIV-13) when a position is known, and by city search (LIV-14) when a place is chosen.
  // A repeat call aborts any request in flight and replaces the list with the new place's
  // outlook (S7). A response for an earlier location is never rendered. Invalid input
  // (non-finite numbers, lat outside [-90, 90], lon outside [-180, 180]) is ignored and the
  // current state is kept.
  setLocation(lat: number, lon: number): void

  // Repeat the request for the current location (the "Try again" button calls this).
  // Does nothing before the first setLocation call.
  retry(): void

  // For tests: "hidden" | "loading" | "ready" | "unavailable".
  readonly state: string
}
```

Rules:
- The module never throws to its caller. Any exception becomes `state = "unavailable"`.
- The only network request it makes is the GET in section 3. It does not read or write
  coordinates in the URL, cookies, `localStorage`, `sessionStorage` or IndexedDB, and does
  not log them.
- Service data is rendered with `textContent` only. No `innerHTML` is used with service data.

## 1a. Pure model: `src/js/daily-outlook-model.js` (no DOM, no network)

```js
export function buildOutlookUrl(endpoint: string, lat: number, lon: number) -> string
//   lat/lon rounded to 2 decimals; query exactly as in section 3.
export function parseDailyOutlook(json: unknown) -> Day[] | null
//   null means "unavailable" (invalid shape, no days, or day 1 incomplete).
export function formatTemperature(celsius: number) -> string   // 18.4 -> "18°C", -0.4 -> "0°C", -2 -> "-2°C"
export function formatPrecipitation(percent: number) -> string // 69.6 -> "70%", clamped to 0..100
export function formatDayLabel(isoDate: string) -> string      // "2026-10-20" -> "Tue 20 Oct"

type Day = { date: "YYYY-MM-DD", label: string, high: string, low: string,
             conditions: string, precipitation: string }
```

## 2. DOM contract (stable selectors QA targets)

| Element | Selector | Accessible name / text |
|---|---|---|
| Outlook section (hidden until the first `setLocation`) | `[data-testid="outlook-section"]` (`<section aria-labelledby>` with an `<h2>`) | region "10-day outlook" |
| Loading indicator | `[data-testid="outlook-loading"]`, `role="status"` | text "Loading outlook…" |
| Day list | `ol[data-testid="outlook-list"]` | list |
| One day (one per returned day, in date order) | `li[data-testid="outlook-day"]` with attribute `data-date="YYYY-MM-DD"` | n/a |
| Weekday and date | `time[data-testid="outlook-date"]`, `datetime="YYYY-MM-DD"` | e.g. "Tue 20 Oct" |
| High | `[data-testid="outlook-high"]` with the visible label "High" before it | exact text e.g. "18°C" |
| Low | `[data-testid="outlook-low"]` with the visible label "Low" before it | exact text e.g. "9°C" |
| Conditions | `[data-testid="outlook-conditions"]` | exact text from section 4, e.g. "Light rain" |
| Chance of precipitation | `[data-testid="outlook-precip"]` with the visible label "Precipitation" before it | exact text e.g. "70%" |
| Failure message | `[data-testid="outlook-unavailable"]`, `role="status"` | exact text "Outlook is unavailable right now." |
| Try again | `button[data-testid="outlook-retry"]` (`type="button"`, inside the failure block) | "Try again" |
| Attribution | `[data-testid="outlook-attribution"]` containing `a[href="https://open-meteo.com/"]` | text "Weather data by Open-Meteo.com" |

States:
- `hidden`: `outlook-section` has the `hidden` attribute.
- `loading`: `outlook-loading` is visible; the list and the failure block are hidden. On a
  location change the previous list is removed when loading starts, so entries for two
  places are never shown together.
- `ready`: `outlook-list` holds exactly N `outlook-day` items (N = number of complete days,
  1 to 10). `outlook-loading` and `outlook-unavailable` are hidden. No empty items exist.
- `unavailable`: `outlook-unavailable` and `outlook-retry` are visible; the list is empty
  and hidden. Activating `outlook-retry` moves to `loading`.
- `outlook-attribution` is visible in the `loading`, `ready` and `unavailable` states.
- Nothing outside `outlook-section` changes when the outlook fails.

Layout (S8):
- `outlook-section` is in normal page flow and is as wide as the content column. There are
  no fixed pixel widths and no horizontal scroll container.
- The list is a single vertical column. Each `outlook-day` is a wrapping layout (flex-wrap
  or grid with `minmax(0, 1fr)`), so at 360 px viewport width all five items are visible
  without clipping. Long condition texts wrap (`overflow-wrap: anywhere`).
- The page (`document.documentElement.scrollWidth`) is not wider than the viewport at
  360 px.

## 3. Service contract: Open-Meteo Forecast API (consumed, not owned)

Request (the only request this feature makes):

```
GET https://api.open-meteo.com/v1/forecast
    ?latitude=<lat rounded to 2 dp>
    &longitude=<lon rounded to 2 dp>
    &daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max
    &timezone=auto
    &forecast_days=10
fetch options: { credentials: "omit", cache: "no-store", signal }
```

Expected 200 response (the fields used; others are ignored):

```json
{
  "daily": {
    "time": ["2026-10-20", "2026-10-21"],
    "weather_code": [61, 2],
    "temperature_2m_max": [18.0, -2.0],
    "temperature_2m_min": [9.0, -11.0],
    "precipitation_probability_max": [70, 0]
  }
}
```

- Index `i` across the arrays is one day. `time[0]` is today at the location.
- Read at most 10 days. The list stops at the first index where any of the four values is
  null, missing, or not a finite number. If index 0 is incomplete, or `time` is empty or
  not an array of `YYYY-MM-DD` strings, the result is "unavailable".
- A non-2xx status, a network error, a 10 s timeout, or invalid JSON means "unavailable".

QA fixture guidance: stub this URL (any query values) with the shape above. Use
`weather_code` 61 for "Light rain" (S2). The arrays' length sets the day count (S1: 10, S5:
6). Return HTTP 500 or abort the request for S6.

## 4. Weather code labels: `src/js/weather-codes.js` (shared with LIV-13)

`export function conditionLabel(code: number) -> string`

| WMO code | Label | WMO code | Label |
|---|---|---|---|
| 0 | Clear sky | 63 | Rain |
| 1 | Mainly clear | 65 | Heavy rain |
| 2 | Partly cloudy | 66 | Light freezing rain |
| 3 | Overcast | 67 | Freezing rain |
| 45 | Fog | 71 | Light snow |
| 48 | Freezing fog | 73 | Snow |
| 51 | Light drizzle | 75 | Heavy snow |
| 53 | Drizzle | 77 | Snow grains |
| 55 | Heavy drizzle | 80 | Light showers |
| 56 | Light freezing drizzle | 81 | Showers |
| 57 | Freezing drizzle | 82 | Heavy showers |
| 61 | Light rain | 85 | Light snow showers |
| 95 | Thunderstorm | 86 | Snow showers |
| 96 | Thunderstorm with hail | 99 | Thunderstorm with heavy hail |

Any other value: "Unknown".
