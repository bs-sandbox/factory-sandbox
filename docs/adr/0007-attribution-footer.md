# 0007. Data-source attribution footer on the main page (static markup)
Status: Proposed
Date: 2026-10-21

Context:
- LIV-41 (rehearsal story, Tier 2, Data Impact false, Security Impact false). The main page
  must show the footer text "Weather data: Open-Meteo · Map: © OpenStreetMap contributors",
  with "Open-Meteo" linked to https://open-meteo.com/ and "OpenStreetMap contributors"
  linked to https://www.openstreetmap.org/ (AC S1–S7).
- Constraints from the story: no new dependency, no new network request to any host the
  page does not already contact (S6), no persisted data, the footer is the last visible
  element below all main content (S4), shown to every visitor (S5), and not editable (S7).
- The repo has no bundler; `src/index.html` is the page. The page-shell contract
  (`contracts/ui/current-conditions.md` §2, ADR 0004) puts feature sections inside `<main>`
  and leaves a comment marker for later stories (LIV-14, LIV-15, LIV-16). Those sections
  will be added before any footer that sits inside `<main>`, so S4 would then fail.
- ADR 0004 item 7 sets the CSP. A plain `<a href>` is a navigation, not a subresource
  fetch. `default-src 'none'` and the other directives do not govern it, so no CSP change
  is needed.

Decision:
1. The footer is static HTML in `src/index.html`, placed after `</main>` and before
   `</body>`, as a `<footer data-testid="attribution-footer">` element. It is not inside
   `<main>`. This keeps it the last element of the page for S4 when later stories add
   sections inside `<main>`.
2. The footer contains one `<p data-testid="attribution-text">`. Its text content is
   exactly `Weather data: Open-Meteo · Map: © OpenStreetMap contributors`, written with
   the entities `&middot;` and `&copy;`. Two plain anchors are inside it:
   `<a data-testid="attribution-open-meteo" href="https://open-meteo.com/">Open-Meteo</a>`
   and `<a data-testid="attribution-osm" href="https://www.openstreetmap.org/">OpenStreetMap contributors</a>`.
3. Links use default same-tab navigation with no `target` attribute, per the product
   assumption recorded on LIV-41 (assumption 3). No `rel` attribute is needed. Reason:
   a same-tab link doesn't open a window that could reach `window.opener`, and the
   browser's default Referer policy (`strict-origin-when-cross-origin`) stays unchanged.
4. No script, no image, no `<link>` (no preconnect, prefetch or preload), no iframe, no
   `style` attribute, no `contenteditable`, and no `on*` attribute. The footer adds zero
   requests, so S6 holds by construction. Nothing is stored (S5/no persisted data).
5. No CSP change, no new npm dependency, no `src/css` change required. The text wraps in
   normal flow with no fixed width, so it works at 360 px wide.
6. Accessibility: the `<footer>` element outside `<main>` has the `contentinfo` landmark
   role. Link text is the visible name.

Alternatives:
- Footer inside `<main>` after the last section: rejected. Later sections would be added
  after it, which breaks S4 (LIV-14–LIV-16 insert before the marker comment).
- `target="_blank"` with `rel="noopener noreferrer"` (the repo's convention for other
  attribution links, `contracts/ui/city-search.md` §5 and `contracts/ui/current-conditions.md`
  §2): rejected for this story. LIV-41 assumption 3 specifies same-tab navigation and the
  AC does not require a new tab. If the Product Owner wants a new tab, the change is two
  attributes on each link and a contract version note.
- Footer built by JavaScript: rejected. It needs a script and adds no value for static text;
  static markup is visible without JS and needs no CSP change.
- Logo images from the target sites: rejected. Each one is a new third-party host, which
  breaks S6, and it is out of scope on LIV-41.

Consequences:
- Easier: the footer needs no runtime code and no CSP change. QA can test it with
  DOM text, `href` and network-log checks.
- Harder: later stories must add sections inside `<main>` before the marker and keep the
  footer after `</main>`. LIV-14–LIV-16 and LIV-13 must not move the footer into `<main>`.
  If a later story changes the footer text, that is a contract change.
- Follow-up: none. Contract: `contracts/ui/attribution-footer.md` (version 1.0.0).

Related: LIV-41 (this decision); ADR 0004 (page shell and CSP); contract
`contracts/ui/attribution-footer.md`; contract `contracts/ui/current-conditions.md` §2 (page markup).
