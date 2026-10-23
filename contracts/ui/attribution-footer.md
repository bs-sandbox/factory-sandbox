# UI contract: data-source attribution footer (LIV-41)

Version: 1.0.0. Status: Proposed with ADR 0007.
Changes are backward compatible by default. Renaming or removing anything below is a
breaking change and needs a new version (Tier 3).

## 1. Markup (in `src/index.html`)

The footer is the last element in `<body>` (after `</main>`), so it is the last visible
element on the page (S4). Later sections are inserted inside `<main>`, never after this
footer.

```html
  </main>
  <footer data-testid="attribution-footer">
    <p data-testid="attribution-text">Weather data: <a data-testid="attribution-open-meteo" href="https://open-meteo.com/">Open-Meteo</a> &middot; Map: &copy; <a data-testid="attribution-osm" href="https://www.openstreetmap.org/">OpenStreetMap contributors</a></p>
  </footer>
</body>
```

## 2. DOM contract (stable selectors QA targets)

| Element | Selector | Accessible name / text |
|---|---|---|
| Footer landmark | `[data-testid="attribution-footer"]` (`<footer>`, `contentinfo` role) | n/a |
| Footer text | `[data-testid="attribution-text"]` | textContent exactly `Weather data: Open-Meteo · Map: © OpenStreetMap contributors` |
| Open-Meteo link | `a[data-testid="attribution-open-meteo"]` | "Open-Meteo"; `href` exactly `https://open-meteo.com/` |
| OSM link | `a[data-testid="attribution-osm"]` | "OpenStreetMap contributors"; `href` exactly `https://www.openstreetmap.org/` |

Rules:
- The footer text is exactly the string in the table (including `·` U+00B7 and `©` U+00A9).
  No other text is added inside `attribution-text`.
- Both links have no `target` attribute and navigate in the same tab (LIV-41 assumption 3).
- The `href` values are fixed literals and are never built from runtime data.
- Inside the footer there are no `<img>`, `<script>`, `<link>`, `<iframe>`, `<object>`,
  `<source>`, `<video>`, `<audio>`, `style` attributes, `contenteditable` attributes, or
  `on*` attributes. The footer adds zero network requests (S6).
- The footer uses no `innerHTML` and no script. Nothing is stored, and nothing is written
  to the URL, cookies, Web Storage or IndexedDB.

## 3. Behaviour

- The footer is shown on every visit, with or without a location and with or without a
  feature failing (S5). No feature script can hide it.
- Visitors cannot edit the footer text: it is not `contenteditable` and sits in no input
  (S7).
- Layout: no fixed pixel widths. The text wraps in normal flow, so it works at 360 px
  wide. Styling is optional and must not use a `style` attribute.

## 4. Test hooks

- DOM check: `textContent` of `[data-testid="attribution-text"]` equals the exact string
  (S1); each link `href` equals the literal (S2, S3); the footer is the last element child of
  `body` other than script elements (S4).
- Network check (S6): capture the network log of the main page load before and after the
  change. The footer must add no request to any host the baseline lacks.
- Edit check (S7): type into the footer text and check that `textContent` is unchanged.
- Navigation check (S2, S3): activate each link and check the resulting URL.
