// Acceptance tests for LIV-48 (contract and ADR 0005 match design amendment A1).
// Written from the AC only. Scenario IDs S1-S4 are in the test names.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const CONTRACT = "contracts/ui/radar-overlay.md";
const ADR = "docs/adr/0005-radar-overlay-rainviewer.md";
const STALE = "`crossOrigin` is not set";

function section2(md) {
  const m = md.match(/^##\s+2[.\s][\s\S]*?(?=^##\s+3[.\s]|(?![\s\S]))/m);
  assert.ok(m, "contract has a section 2");
  return m[0];
}
function decisionItem5(md) {
  const m = md.match(/^5\. [\s\S]*?(?=^6\. )/m);
  assert.ok(m, "ADR Decision has item 5");
  return m[0];
}

test("S1 contract version is 1.0.1", () => {
  assert.match(read(CONTRACT), /version[^\n]*\b1\.0\.1\b/i);
});
test("S1 contract section 2 states crossOrigin anonymous, no cookies, tileerror", () => {
  const s2 = section2(read(CONTRACT));
  assert.match(s2, /crossOrigin[`"' :]*"anonymous"/);
  assert.match(s2, /CORS[- ]mode/);
  assert.match(s2, /no cookies/);
  assert.match(s2, /tileerror/);
  assert.match(s2, /existing failure rules/i);
});
test("S1 contract does not contain the stale text", () => {
  assert.ok(!read(CONTRACT).includes(STALE));
});
test("S2 ADR item 5 lists crossOrigin anonymous and no stale text", () => {
  const adr = read(ADR);
  assert.match(decisionItem5(adr), /crossOrigin: "anonymous"/);
  assert.ok(!adr.includes(STALE));
});
test("S2 ADR context records the 2026-10-27 probe", () => {
  const adr = read(ADR);
  assert.match(adr, /2026-10-27/);
  assert.match(adr, /access-control-allow-origin: \*/i);
  assert.match(adr, /Set-Cookie/i);
});
test("S2 ADR status is Accepted", () => {
  assert.match(read(ADR), /^\s*(-\s*)?\**Status:?\**:?\s*Accepted/im);
});
test("S3 ADR item 5 options equal the tileLayer options in src/js/radar-overlay.js", () => {
  assert.ok(existsSync(new URL("../../src/js/radar-overlay.js", import.meta.url)),
    "src/js/radar-overlay.js (PR #25) must be present to check S3");
  const code = read("src/js/radar-overlay.js");
  const call = code.match(/tileLayer\(\s*[^,]+,\s*\{([\s\S]*?)\}\s*\)/);
  assert.ok(call, "tileLayer options object found");
  const pairs = (s) => Object.fromEntries(
    [...s.matchAll(/\b(tileSize|opacity|zIndex|maxNativeZoom|maxZoom|referrerPolicy|crossOrigin|attribution)\s*:\s*("[^"]*"|[\w.]+)/g)]
      .map((m) => [m[1], m[2]]));
  const codeKeys = [...call[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort();
  const item = decisionItem5(read(ADR));
  const optLine = item.match(/Options:([\s\S]*?)(?=\n\s*-\s|\n\n)/)[1];
  const adrOpts = pairs(optLine);
  const codeOpts = pairs(call[1]);
  for (const [k, v] of Object.entries(adrOpts)) {
    if (k === "attribution") continue; // value is a constant, named in item 7
    assert.equal(codeOpts[k], v, `option ${k}`);
  }
  assert.deepEqual(codeKeys, Object.keys({ ...adrOpts, attribution: 1 }).sort(), "no other option, none missing");
});
test("S4 the merged LIV-48 change touches only the contract and ADR 0005", () => {
  const out = execFileSync("git", ["show", "--name-only", "--format=", "9f9e636"], { encoding: "utf8" });
  assert.deepEqual(out.trim().split("\n").sort(), [ADR, CONTRACT].sort());
});
