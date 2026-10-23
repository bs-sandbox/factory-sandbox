// Acceptance tests for LIV-14 (city search when location is denied).
// Written from the AC (S1-S23) and contracts/ui/city-search.md only.
// Synthetic data only. Each test builds its own page and fake service.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildPage, mkEvent } from "./fake-dom.mjs";

const GEO = "https://geocoding-api.open-meteo.com/";
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const jsonResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const indexHtml = () => readFileSync(new URL("../../src/index.html", import.meta.url), "utf8");
const sectionHtml = () => indexHtml().match(/<section[^>]*data-testid="city-search"[\s\S]*?<\/section>/)?.[0] ?? "";

const SPRINGFIELDS = [
  { name: "Springfield", admin1: "Illinois", country: "United States", latitude: 39.8, longitude: -89.64 },
  { name: "Springfield", admin1: "Missouri", country: "United States", latitude: 37.2, longitude: -93.29 },
  { name: "Springfield", admin1: "Massachusetts", country: "United States", latitude: 42.1, longitude: -72.59 },
];

// Installs trapping globals, loads the module, and returns a harness.
async function setup({ respond = () => jsonResponse({ results: SPRINGFIELDS }), onPlaceSelected } = {}) {
  const page = buildPage();
  const calls = [];
  const consoleMsgs = [];
  const trap = (name) => new Proxy({}, {
    get() { page.env.violations.push(name); throw new Error(name + " is banned"); },
    set() { page.env.violations.push(name); throw new Error(name + " is banned"); },
  });
  const saved = {};
  const set = (k, v) => {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  };
  set("document", page.doc);
  set("localStorage", trap("localStorage"));
  set("sessionStorage", trap("sessionStorage"));
  set("indexedDB", trap("indexedDB"));
  set("history", {
    pushState() { page.env.violations.push("history.pushState"); },
    replaceState() { page.env.violations.push("history.replaceState"); },
  });
  const consoleSaved = {};
  for (const m of ["log", "info", "warn", "error", "debug", "trace"]) {
    consoleSaved[m] = console[m];
    console[m] = (...a) => consoleMsgs.push(a.map(String).join(" "));
  }
  const fetchImpl = (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return respond({ url: String(url), opts }, calls.length - 1);
  };
  const selected = [];
  const { createCitySearch } = await import("../../src/js/city-search.js");
  const search = createCitySearch({
    root: page.root, fetchImpl, timeoutMs: 10000,
    onPlaceSelected: onPlaceSelected ?? ((p) => selected.push(p)),
  });
  return {
    ...page, calls, consoleMsgs, selected, search,
    async submit(text) { page.input.value = text; page.button.click(); await settle(); },
    status: () => page.status.textContent,
    resultButtons: () => page.list.querySelectorAll('[data-testid="city-search-result-button"]'),
    restore() {
      try { search.destroy(); } catch { /* ignore */ }
      for (const [k, d] of Object.entries(saved)) {
        if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k];
      }
      for (const [m, f] of Object.entries(consoleSaved)) console[m] = f;
    },
  };
}
async function withSearch(opts, fn) {
  const h = await setup(opts);
  try { h.search.show(); await fn(h); } finally { h.restore(); }
}
const noViolations = (h) => assert.deepEqual(h.env.violations, []);
const nameParam = (url) => new URL(url).searchParams.get("name");

test("S1 search shown on denial: field and Search button visible after show(); hidden before", async () => {
  const h = await setup();
  try {
    assert.equal(h.root.isVisible, false);
    h.search.show();
    assert.equal(h.input.isVisible, true);
    assert.equal(h.button.isVisible, true);
    assert.equal(h.button.textContent, "Search");
  } finally { h.restore(); }
});

test("S2 multiple matches listed with name, region and country", async () => {
  await withSearch({}, async (h) => {
    await h.submit("Springfield");
    const b = h.resultButtons();
    assert.ok(b.length >= 2);
    assert.equal(h.list.isVisible, true);
    assert.deepEqual(b.map((x) => x.textContent), [
      "Springfield, Illinois, United States",
      "Springfield, Missouri, United States",
      "Springfield, Massachusetts, United States",
    ]);
  });
});

test("S3 selecting the first entry passes that place's coordinates to the shell", async () => {
  await withSearch({}, async (h) => {
    await h.submit("Springfield");
    h.resultButtons()[0].click();
    await settle();
    assert.equal(h.selected.length, 1);
    assert.equal(h.selected[0].latitude, 39.8);
    assert.equal(h.selected[0].longitude, -89.64);
    assert.equal(h.selected[0].name, "Springfield");
  });
});

test("S4 empty input and spaces-only: message shown and no request made", async () => {
  await withSearch({}, async (h) => {
    await h.submit("");
    assert.equal(h.status(), "Enter a city name.");
    await h.submit("   ");
    assert.equal(h.status(), "Enter a city name.");
    assert.equal(h.calls.length, 0);
  });
});

test("S5 no match: message with the typed text", async () => {
  await withSearch({ respond: () => jsonResponse({ generationtime_ms: 0.5 }) }, async (h) => {
    await h.submit("xqzvwk");
    assert.equal(h.status(), 'No places found for "xqzvwk".');
  });
});

for (const [label, mode] of [
  ["network error", () => Promise.reject(new TypeError("network"))],
  ["non-2xx", () => jsonResponse({}, 500)],
  ["error:true", () => jsonResponse({ error: true, reason: "x" })],
]) {
  test(`S6 search failure (${label}): message shown and user can submit again`, async () => {
    let fail = true;
    await withSearch({ respond: () => (fail ? mode() : jsonResponse({ results: SPRINGFIELDS })) }, async (h) => {
      await h.submit("Paris");
      assert.equal(h.status(), "Search is unavailable right now.");
      assert.equal(h.button.disabled, false);
      fail = false;
      await h.submit("Paris");
      assert.equal(h.calls.length, 2);
      assert.equal(h.resultButtons().length, 3);
    });
  });
}

test("S7 privacy: text goes only to the geocoder; no cookies, storage, IndexedDB", async () => {
  await withSearch({}, async (h) => {
    await h.submit("Paris");
    assert.equal(h.calls.length, 1);
    for (const c of h.calls) assert.ok(c.url.startsWith(GEO));
    noViolations(h);
  });
});

test("S8 phone screen: markup precondition only (layout at 360 px needs a real browser, see test plan)", () => {
  assert.match(indexHtml(), /name="viewport"/);
  assert.match(sectionHtml(), /data-testid="city-search-input"/);
  assert.match(sectionHtml(), /data-testid="city-search-results"/);
});

test("S9 text length limit: markup caps at 100 and submit sends the first 100 characters", async () => {
  assert.match(sectionHtml().match(/<input[^>]*city-search-input[^>]*>/s)?.[0] ?? "", /maxlength="100"/);
  await withSearch({}, async (h) => {
    const long = "a".repeat(60) + "b".repeat(60);
    await h.submit(long);
    assert.equal(nameParam(h.calls[0].url), long.slice(0, 100));
  });
});

test("S10 result count limit: at most 10 entries, in service order", async () => {
  const many = Array.from({ length: 13 }, (_, i) => ({ name: "Place" + i, country: "Land", latitude: i, longitude: i }));
  await withSearch({ respond: () => jsonResponse({ results: many }) }, async (h) => {
    await h.submit("Place");
    assert.deepEqual(h.resultButtons().map((b) => b.textContent), many.slice(0, 10).map((p) => p.name + ", Land"));
  });
});

test("S11 trimming: '  Paris  ' searches for 'Paris'", async () => {
  await withSearch({}, async (h) => {
    await h.submit("  Paris  ");
    assert.equal(nameParam(h.calls[0].url), "Paris");
  });
});

test("S12 no-match message uses the trimmed text", async () => {
  await withSearch({ respond: () => jsonResponse({}) }, async (h) => {
    await h.submit("  xqzvwk  ");
    assert.equal(h.status(), 'No places found for "xqzvwk".');
  });
});

test("S13 missing region: 'Singapore, Singapore' with no empty part", async () => {
  const r = [{ name: "Singapore", country: "Singapore", latitude: 1.29, longitude: 103.85 }];
  await withSearch({ respond: () => jsonResponse({ results: r }) }, async (h) => {
    await h.submit("Singapore");
    assert.deepEqual(h.resultButtons().map((b) => b.textContent), ["Singapore, Singapore"]);
  });
});

test("S14 attribution visible without interaction, with both links", () => {
  const attr = sectionHtml().match(/<p[^>]*city-search-attribution[\s\S]*?<\/p>/)?.[0] ?? "";
  const text = attr.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  assert.equal(text, "Place search by Open-Meteo.com, data from GeoNames");
  assert.match(attr, /href="https:\/\/open-meteo\.com\/"/);
  assert.match(attr, /href="https:\/\/www\.geonames\.org\/"/);
  assert.doesNotMatch(attr, /\bhidden\b/);
});

test("S15 after selection: list hidden, input keeps text, Search usable for a new search", async () => {
  await withSearch({}, async (h) => {
    await h.submit("Springfield");
    h.resultButtons()[1].click();
    await settle();
    assert.equal(h.list.isVisible, false);
    assert.equal(h.input.value, "Springfield");
    assert.equal(h.input.isVisible, true);
    assert.equal(h.button.disabled, false);
    await h.submit("Springfield");
    assert.equal(h.calls.length, 2);
    assert.equal(h.resultButtons().length, 3);
  });
});

for (const [label, order] of [["Paris arrives after Lyon", [1, 0]], ["Paris arrives before Lyon", [0, 1]]]) {
  test(`S16 stale results (${label}): only Lyon results are shown`, async () => {
    const pending = [];
    const bodies = [
      { results: [{ name: "Paris", country: "France", latitude: 48.8, longitude: 2.3 }] },
      { results: [{ name: "Lyon", country: "France", latitude: 45.7, longitude: 4.8 }] },
    ];
    await withSearch({ respond: () => new Promise((res) => pending.push(res)) }, async (h) => {
      h.input.value = "Paris"; h.button.click(); await settle();
      h.input.value = "Lyon"; h.button.click(); await settle();
      assert.equal(pending.length, 2);
      for (const i of order) { pending[i](jsonResponse(bodies[i])); await settle(); }
      assert.deepEqual(h.resultButtons().map((b) => b.textContent), ["Lyon, France"]);
    });
  });
}

test("S17 no persistence in URL or history: submit is cancelled, no history writes, no native form target", async () => {
  await withSearch({}, async (h) => {
    h.input.value = "Paris";
    const ev = mkEvent("submit");
    h.form.dispatchEvent(ev);
    await settle();
    assert.equal(ev.defaultPrevented, true);
    assert.equal(h.form.hasAttribute("action"), false);
    assert.equal(h.input.hasAttribute("name"), false);
    noViolations(h);
  });
});

test("S18 markup in typed text is shown literally; no element created from it", async () => {
  const q = "<img src=x onerror=alert(1)>";
  await withSearch({ respond: () => jsonResponse({}) }, async (h) => {
    await h.submit(q);
    assert.equal(h.status(), `No places found for "${q}".`);
    assert.equal(h.root.querySelectorAll("img").length, 0);
    assert.equal(h.env.created.filter((e) => e.tagName === "IMG").length, 0);
    noViolations(h);
  });
});

test("S19 markup in service data is shown literally; no b or img element created", async () => {
  const name = "<b>X</b><img src=x onerror=alert(1)>";
  const r = [{ name, country: "Land", admin1: "<i>R</i>", latitude: 1, longitude: 2 }];
  await withSearch({ respond: () => jsonResponse({ results: r }) }, async (h) => {
    await h.submit("X");
    const b = h.resultButtons();
    assert.equal(b.length, 1);
    assert.equal(b[0].textContent, `${name}, <i>R</i>, Land`);
    for (const t of ["b", "img", "i"]) assert.equal(h.root.querySelectorAll(t).length, 0);
    assert.equal(h.env.created.filter((e) => ["B", "IMG", "I"].includes(e.tagName)).length, 0);
    noViolations(h);
  });
});

test("S20 invalid places are not offered; all invalid gives unavailable message; nothing selected", async () => {
  const bad = [
    { name: "A", latitude: 91, longitude: 0 }, { name: "B", latitude: -91, longitude: 0 },
    { name: "C", latitude: 0, longitude: 181 }, { name: "D", latitude: 0, longitude: -181 },
    { name: "E", latitude: "48.85", longitude: 2 }, { name: "F", latitude: null, longitude: 2 },
    { name: "G", latitude: NaN, longitude: 2 }, { name: "H", longitude: 2 },
  ];
  const good = { name: "Good", country: "Land", latitude: 10, longitude: 20 };
  await withSearch({ respond: () => jsonResponse({ results: [...bad, good] }) }, async (h) => {
    await h.submit("x");
    assert.deepEqual(h.resultButtons().map((b) => b.textContent), ["Good, Land"]);
  });
  await withSearch({ respond: () => jsonResponse({ results: bad }) }, async (h) => {
    await h.submit("x");
    assert.equal(h.status(), "Search is unavailable right now.");
    assert.equal(h.resultButtons().length, 0);
    assert.equal(h.selected.length, 0);
    for (const c of h.calls) assert.ok(c.url.startsWith(GEO));
  });
});

test("S21 search request: credentials omitted, no referrer, GET with no custom headers or body", async () => {
  await withSearch({}, async (h) => {
    await h.submit("Paris");
    const { opts } = h.calls[0];
    assert.equal(opts.credentials, "omit");
    assert.equal(opts.referrerPolicy, "no-referrer");
    assert.ok(opts.method === undefined || opts.method === "GET");
    assert.ok(opts.headers === undefined || Object.keys(opts.headers).length === 0);
    assert.equal(opts.body, undefined);
  });
});

test("S22 typed text is not logged to the console (success, no match, failure)", async () => {
  await withSearch({}, async (h) => {
    await h.submit("Paris");
    assert.equal(h.consoleMsgs.filter((m) => m.includes("Paris")).length, 0);
  });
  await withSearch({ respond: () => Promise.reject(new Error("boom")) }, async (h) => {
    await h.submit("Paris");
    assert.equal(h.consoleMsgs.filter((m) => m.includes("Paris")).length, 0);
  });
});

test("S23 attribution links that open a new tab have rel noopener and noreferrer", () => {
  const links = [...sectionHtml().matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(links.length >= 2);
  for (const a of links) {
    if (/target="_blank"/.test(a)) {
      const rel = (a.match(/rel="([^"]*)"/)?.[1] ?? "").split(/\s+/);
      assert.ok(rel.includes("noopener") && rel.includes("noreferrer"), a);
    }
  }
});
