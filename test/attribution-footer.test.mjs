// LIV-41 / LIV-42: checks the attribution footer in src/index.html against
// contracts/ui/attribution-footer.md section 1 (markup) and section 2 (DOM contract).
// Plain string checks only: no HTML parser dependency (ADR 0007 item 5).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");

const FOOTER_RE = /<footer data-testid="attribution-footer">([\s\S]*?)<\/footer>/g;
const footers = [...html.matchAll(FOOTER_RE)];
const footerInner = footers.length === 1 ? footers[0][1] : null;

// Visible text of an HTML fragment, with the two entities the contract uses decoded.
function textOf(fragment) {
  return fragment
    .replace(/<[^>]*>/g, "")
    .replace(/&middot;/g, "·")
    .replace(/&copy;/g, "©");
}

// The opening tag of the anchor with the given data-testid, e.g. <a data-testid="x" href="...">.
function anchorWithTestId(testId) {
  const re = new RegExp(`<a ([^>]*data-testid="${testId}"[^>]*)>([\\s\\S]*?)</a>`);
  const m = html.match(re);
  return m ? { attrs: m[1], text: m[2] } : null;
}

test("S1: the footer has exactly one attribution footer element", () => {
  assert.equal(footers.length, 1, "expected one <footer data-testid=\"attribution-footer\">");
});

test("S1: the footer text is exactly the required string", () => {
  assert.ok(footerInner !== null, "footer missing");
  const p = footerInner.match(/<p data-testid="attribution-text">([\s\S]*?)<\/p>/);
  assert.ok(p, "<p data-testid=\"attribution-text\"> missing");
  assert.equal(
    textOf(p[1]),
    "Weather data: Open-Meteo · Map: © OpenStreetMap contributors",
  );
});

test("S1: the footer text uses the entities for middle dot and copyright sign", () => {
  assert.ok(footerInner !== null, "footer missing");
  assert.match(footerInner, /&middot;/);
  assert.match(footerInner, /&copy;/);
});

test("S2: the Open-Meteo link goes to https://open-meteo.com/", () => {
  const a = anchorWithTestId("attribution-open-meteo");
  assert.ok(a, "Open-Meteo anchor missing");
  assert.equal(a.text, "Open-Meteo");
  assert.match(a.attrs, /href="https:\/\/open-meteo\.com\/"/);
});

test("S3: the OpenStreetMap link goes to https://www.openstreetmap.org/", () => {
  const a = anchorWithTestId("attribution-osm");
  assert.ok(a, "OpenStreetMap anchor missing");
  assert.equal(a.text, "OpenStreetMap contributors");
  assert.match(a.attrs, /href="https:\/\/www\.openstreetmap\.org\/"/);
});

test("S2/S3: both links navigate in the same tab (no target attribute)", () => {
  for (const id of ["attribution-open-meteo", "attribution-osm"]) {
    const a = anchorWithTestId(id);
    assert.ok(a, `${id} anchor missing`);
    assert.doesNotMatch(a.attrs, /\btarget=/, `${id} must not set target`);
  }
});

test("S4: the footer is after </main> and is the last element in body", () => {
  const footerIndex = html.indexOf("<footer ");
  const mainClose = html.indexOf("</main>");
  assert.ok(mainClose !== -1 && footerIndex > mainClose, "footer must come after </main>");
  const tail = html.slice(html.indexOf("</footer>") + "</footer>".length);
  assert.match(tail, /^\s*<\/body>\s*<\/html>\s*$/, "only </body></html> may follow the footer");
});

test("S5: the footer is static markup with no hidden or script-gated attributes", () => {
  assert.ok(footerInner !== null, "footer missing");
  const openTag = html.match(/<footer [^>]*>/)[0];
  assert.doesNotMatch(openTag, /\bhidden\b/);
  assert.doesNotMatch(openTag, /\bstyle=/);
  assert.doesNotMatch(footerInner, /<script/i);
});

test("S6: the footer has no subresources or other host-loading elements", () => {
  assert.ok(footerInner !== null, "footer missing");
  for (const tag of ["img", "script", "link", "iframe", "object", "source", "video", "audio", "embed"]) {
    assert.doesNotMatch(footerInner, new RegExp(`<${tag}[\\s>/]`, "i"), `footer must not contain <${tag}>`);
  }
});

test("S7: the footer text is not editable", () => {
  assert.ok(footerInner !== null, "footer missing");
  assert.doesNotMatch(footerInner, /contenteditable/i);
  assert.doesNotMatch(footerInner, /<input[\s>]/i);
  assert.doesNotMatch(footerInner, /<textarea[\s>]/i);
});

test("contract 2: no inline style or on* event handler inside the footer", () => {
  assert.ok(footerInner !== null, "footer missing");
  assert.doesNotMatch(footerInner, /\sstyle=/i);
  assert.doesNotMatch(footerInner, /\son[a-z]+=/i);
});
