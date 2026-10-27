import assert from "node:assert/strict";
import { test } from "node:test";

import { createRadarController } from "../src/js/radar-overlay.js";

const body = { radar: { past: [{ time: 1792530600, path: "/v2/radar/bbb222" }] } };
const flush = () => new Promise((r) => setImmediate(r));
const FAIL = { checked: false, timestampText: null, unavailable: true };

function setup({ json = body, status = 200, fetchImpl, mapNull = false, tileLayerThrows = false, tz = "America/Los_Angeles", renderThrowsOn } = {}) {
  const views = [];
  const fetchCalls = [];
  const layers = [];
  const timers = new Map();
  let tid = 0;
  const locationMap = { leafletMap: mapNull ? null : {} };
  const leaflet = {
    tileLayer(url, opts) {
      if (tileLayerThrows) throw new Error("boom");
      const h = {};
      const l = {
        url, opts, added: null, removed: false, h,
        on(n, fn) { h[n] = fn; return l; },
        addTo(m) { l.added = m; return l; },
        remove() { l.removed = true; },
      };
      layers.push(l);
      return l;
    },
  };
  const defaultFetch = (url, init) => {
    fetchCalls.push({ url, init });
    return Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(json) });
  };
  const c = createRadarController({
    locationMap, leaflet, timeZone: tz,
    render: (v) => { if (renderThrowsOn?.(v)) throw new Error("render"); views.push(v); },
    fetch: fetchImpl ?? defaultFetch,
    setTimeout: (fn, ms) => { tid += 1; timers.set(tid, { fn, ms }); return tid; },
    clearTimeout: (id) => { timers.delete(id); },
  });
  const timerByMs = (ms) => [...timers.values()].find((x) => x.ms === ms);
  return { c, views, fetchCalls, layers, timers, timerByMs, last: () => views[views.length - 1] };
}

test("starts off", () => {
  const t = setup();
  assert.equal(t.c.state, "off");
  assert.deepEqual(t.last(), { checked: false, timestampText: null, unavailable: false });
  assert.equal(t.fetchCalls.length, 0);
});

test("on: one request without credentials or referrer; layer options; first tileload shows timestamp", async () => {
  const t = setup();
  t.c.setOn(true);
  assert.equal(t.c.state, "loading");
  assert.deepEqual(t.last(), { checked: true, timestampText: null, unavailable: false });
  await flush();
  assert.equal(t.fetchCalls.length, 1);
  const { url, init } = t.fetchCalls[0];
  assert.equal(url, "https://api.rainviewer.com/public/weather-maps.json");
  assert.equal(init.credentials, "omit");
  assert.equal(init.referrerPolicy, "no-referrer");
  assert.equal(init.cache, "no-store");
  const l = t.layers[0];
  assert.equal(l.opts.referrerPolicy, "no-referrer");
  assert.equal(l.opts.crossOrigin, "anonymous");
  assert.equal(l.opts.maxNativeZoom, 7);
  assert.equal(l.opts.opacity, 0.7);
  assert.equal(l.url, "https://tilecache.rainviewer.com/v2/radar/bbb222/256/{z}/{x}/{y}/2/1_1.png");
  assert.ok(l.added);
  l.h.tileload();
  assert.equal(t.c.state, "on");
  assert.deepEqual(t.last(), { checked: true, timestampText: "Radar updated 2:10 PM PDT", unavailable: false });
});

test("off removes the layer and timestamp, and makes no further request", async () => {
  const t = setup();
  t.c.setOn(true);
  await flush();
  t.layers[0].h.tileload();
  t.c.setOn(false);
  assert.equal(t.c.state, "off");
  assert.equal(t.layers[0].removed, true);
  assert.deepEqual(t.last(), { checked: false, timestampText: null, unavailable: false });
  assert.equal(t.fetchCalls.length, 1);
  assert.equal(t.timers.size, 0);
});

test("off while off and on while on do nothing", async () => {
  const t = setup();
  const n = t.views.length;
  t.c.setOn(false);
  assert.equal(t.views.length, n);
  t.c.setOn(true);
  await flush();
  t.c.setOn(true);
  assert.equal(t.fetchCalls.length, 1);
});

test("later single-tile errors keep the state on", async () => {
  const t = setup();
  t.c.setOn(true);
  await flush();
  t.layers[0].h.tileload();
  t.layers[0].h.tileerror();
  t.layers[0].h.load();
  assert.equal(t.c.state, "on");
});

for (const [name, opts] of [["non-2xx", { status: 500 }], ["empty radar.past", { json: { radar: { past: [] } } }], ["null json", { json: null }]]) {
  test(`fail: ${name}`, async () => {
    const t = setup(opts);
    t.c.setOn(true);
    await flush();
    assert.equal(t.c.state, "off");
    assert.deepEqual(t.last(), FAIL);
    assert.equal(t.layers.length, 0);
  });
}

test("fail: network error", async () => {
  const t = setup({ fetchImpl: () => Promise.reject(new Error("net")) });
  t.c.setOn(true);
  await flush();
  assert.deepEqual(t.last(), FAIL);
});

test("fail: fetch throws synchronously", () => {
  const t = setup({ fetchImpl: () => { throw new Error("x"); } });
  t.c.setOn(true);
  assert.equal(t.c.state, "off");
  assert.deepEqual(t.last(), FAIL);
});

test("fail: map unavailable, no request", () => {
  const t = setup({ mapNull: true });
  t.c.setOn(true);
  assert.deepEqual(t.last(), FAIL);
  assert.equal(t.fetchCalls.length, 0);
});

test("fail: request timeout aborts the fetch", () => {
  let signal;
  const t = setup({ fetchImpl: (u, init) => { signal = init.signal; return new Promise(() => {}); } });
  t.c.setOn(true);
  const timer = t.timerByMs(10000);
  assert.ok(timer);
  timer.fn();
  assert.deepEqual(t.last(), FAIL);
  assert.equal(signal.aborted, true);
});

test("fail: first load with 0 tileload and an error", async () => {
  const t = setup();
  t.c.setOn(true);
  await flush();
  t.layers[0].h.tileerror();
  t.layers[0].h.load();
  assert.deepEqual(t.last(), FAIL);
  assert.equal(t.layers[0].removed, true);
});

test("fail: tile timer fires after 15 s with no tileload", async () => {
  const t = setup();
  t.c.setOn(true);
  await flush();
  t.timerByMs(15000).fn();
  assert.deepEqual(t.last(), FAIL);
  assert.equal(t.layers[0].removed, true);
});

test("generation rule: late tile events after off or a new on are ignored", async () => {
  const t = setup();
  t.c.setOn(true);
  await flush();
  const old = t.layers[0];
  t.c.setOn(false);
  old.h.tileload();
  old.h.tileerror();
  old.h.load();
  assert.equal(t.c.state, "off");
  assert.deepEqual(t.last(), { checked: false, timestampText: null, unavailable: false });
  t.c.setOn(true);
  old.h.tileload();
  assert.equal(t.c.state, "loading");
});

test("generation rule: a late fetch result after off adds no layer", async () => {
  let resolve;
  const t = setup({ fetchImpl: () => new Promise((r) => { resolve = r; }) });
  t.c.setOn(true);
  t.c.setOn(false);
  resolve({ ok: true, json: () => Promise.resolve(body) });
  await flush();
  assert.equal(t.layers.length, 0);
  assert.equal(t.c.state, "off");
});

test("the unavailable message clears on the next setOn(true)", async () => {
  const t = setup({ status: 500 });
  t.c.setOn(true);
  await flush();
  t.c.setOn(true);
  assert.deepEqual(t.views.at(-1), { checked: true, timestampText: null, unavailable: false });
});

test("T2b: a formatter that throws in tileload goes to fail", async () => {
  const t = setup({ tz: "Not/AZone" });
  t.c.setOn(true);
  await flush();
  assert.doesNotThrow(() => t.layers[0].h.tileload());
  assert.equal(t.c.state, "off");
  assert.deepEqual(t.last(), FAIL);
});

test("T2b: render throwing on the timestamp view goes to fail", async () => {
  const t = setup({ renderThrowsOn: (v) => v.timestampText !== null });
  t.c.setOn(true);
  await flush();
  assert.doesNotThrow(() => t.layers[0].h.tileload());
  assert.equal(t.c.state, "off");
  assert.deepEqual(t.last(), FAIL);
});

test("T2b: a throwing timer callback does not escape and ends off", async () => {
  const t = setup({ renderThrowsOn: (v) => v.unavailable });
  t.c.setOn(true);
  await flush();
  assert.doesNotThrow(() => t.timerByMs(15000).fn());
  assert.equal(t.c.state, "off");
});

test("T2b: a throwing tileLayer goes to fail", async () => {
  const t = setup({ tileLayerThrows: true });
  t.c.setOn(true);
  await flush();
  assert.equal(t.c.state, "off");
  assert.deepEqual(t.last(), FAIL);
});
