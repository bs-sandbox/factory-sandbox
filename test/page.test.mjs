import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://tile.openstreetmap.org; connect-src https://api.open-meteo.com https://geocoding-api.open-meteo.com; base-uri 'none'; form-action 'none'; object-src 'none'";

test("CSP meta is pinned exactly and is the first element after charset", () => {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  assert.ok(m, "CSP meta present");
  assert.equal(m[1], CSP);
  const charset = html.indexOf('<meta charset="utf-8">');
  const csp = html.indexOf("http-equiv=\"Content-Security-Policy\"");
  assert.ok(charset >= 0 && csp > charset);
  assert.equal(html.slice(charset).match(/<(meta|link|script)\b[^>]*>/gi)[1].includes("Content-Security-Policy"), true);
  const firstLinkOrScript = html.search(/<(link|script)\b/i);
  assert.ok(csp < firstLinkOrScript);
});

test("no inline script, style element, style attribute or on* handler", () => {
  for (const s of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script[^>]*>/gi)) {
    assert.match(s[1], /\bsrc="/);
    assert.equal(s[2].trim(), "");
  }
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});

test("page has the contract's test ids and attribution link", () => {
  for (const id of ["conditions-section", "conditions-status", "conditions-current", "conditions-temperature",
    "conditions-text", "conditions-unavailable", "conditions-retry", "conditions-attribution"]) {
    assert.ok(html.includes(`data-testid="${id}"`), id);
  }
  assert.match(html, /<a href="https:\/\/open-meteo\.com\/" rel="noopener noreferrer" target="_blank">Open-Meteo\.com<\/a>/);
  assert.match(html, /Weather data by/);
  assert.match(html, /<script type="module" src="js\/app\.js"><\/script>/);
  assert.match(html, /href="css\/app\.css"/);
});

test("app source never uses HTML sinks, console, storage or cookies", () => {
  const dir = new URL("../src/js/", import.meta.url);
  const banned = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|console\.|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|watchPosition|history\.|serviceWorker|caches\./;
  for (const f of readdirSync(dir)) {
    assert.doesNotMatch(readFileSync(new URL(f, dir), "utf8"), banned, f);
  }
});

test("css follows the layout contract", () => {
  const css = readFileSync(new URL("../src/css/app.css", import.meta.url), "utf8");
  assert.match(css, /box-sizing: border-box/);
  assert.match(css, /max-width: 40rem/);
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
  assert.match(css, /min-height: 44px/);
});
