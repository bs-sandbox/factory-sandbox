import assert from "node:assert/strict";
import { test } from "node:test";

import { createLocationMap } from "../src/js/location-map.js";

function fakeRoot() {
  const mk = () => ({ hidden: false, querySelector: () => null, setAttribute() {}, getAttribute: () => null });
  const els = { map: mk(), "map-unavailable": mk() };
  const root = mk();
  root.hidden = true;
  root.querySelector = (sel) => els[/"([^"]+)"/.exec(sel)[1]];
  return { root, els };
}

function fakeLeaflet() {
  const calls = { setView: [], tileLayer: null, locate: 0, markers: [] };
  const handlers = {};
  const layer = {
    on(name, fn) { handlers[name] = fn; return layer; },
    addTo() { return layer; },
  };
  let zoom = 15;
  const map = {
    setView(c, z) { calls.setView.push([c, z]); zoom = z; return map; },
    getZoom: () => zoom,
    invalidateSize() {},
    locate() { calls.locate += 1; },
    addControl() {},
  };
  const marker = {
    _map: null, latlng: null,
    addTo(m) { marker._map = m; return marker; },
    setLatLng(ll) { marker.latlng = ll; calls.markers.push(ll); return marker; },
    getLatLng: () => marker.latlng,
    getElement: () => null,
  };
  const Control = { extend: () => function Ctl() { this.addTo = () => this; } };
  const L = {
    map: () => map,
    control: { attribution: () => ({ addTo() {} }) },
    TileLayer: { extend: () => function Layer(url, opts) { calls.tileLayer = { url, opts }; return layer; } },
    GridLayer: { prototype: {} },
    icon: (o) => o,
    marker: () => marker,
    Control,
    DomUtil: { create: () => ({ setAttribute() {} }) },
    DomEvent: { disableClickPropagation() {}, on() {} },
  };
  return { L, calls, handlers, setZoom: (z) => { zoom = z; } };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("a valid location shows the section, sets view at zoom 15 and uses anonymous tiles (S1, S9, S13)", async () => {
  const { root, els } = fakeRoot();
  const f = fakeLeaflet();
  const m = createLocationMap(root, { leaflet: f.L });
  assert.equal(m.state, "hidden");
  m.setLocation(47.6062, -122.3321);
  await tick();
  assert.equal(root.hidden, false);
  assert.equal(els["map-unavailable"].hidden, true);
  assert.deepEqual(f.calls.setView.at(-1), [[47.6062, -122.3321], 15]);
  assert.equal(f.calls.tileLayer.url, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  assert.equal(f.calls.tileLayer.opts.crossOrigin, "anonymous");
  assert.equal(m.state, "loading");
  f.handlers.tileload();
  assert.equal(m.state, "ready");
  assert.ok(m.leafletMap);
});

test("a repeat call re-centres at zoom 15 and recentre keeps the zoom (S3, S4, S10)", async () => {
  const { root } = fakeRoot();
  const f = fakeLeaflet();
  const m = createLocationMap(root, { leaflet: f.L });
  m.setLocation(47.6, -122.3);
  await tick();
  f.setZoom(10);
  m.recentre();
  assert.deepEqual(f.calls.setView.at(-1), [[47.6, -122.3], 10]);
  m.setLocation(45.5, -122.6);
  assert.deepEqual(f.calls.setView.at(-1), [[45.5, -122.6], 15]);
});

test("recentre before the first location does nothing", () => {
  const { root } = fakeRoot();
  const m = createLocationMap(root, { leaflet: fakeLeaflet().L });
  m.recentre();
  assert.equal(m.state, "hidden");
});

test("invalid coordinates are ignored (S14)", async () => {
  const { root } = fakeRoot();
  const f = fakeLeaflet();
  const m = createLocationMap(root, { leaflet: f.L });
  m.setLocation(47.6062, -122.3321);
  await tick();
  f.handlers.tileload();
  const before = f.calls.setView.length;
  for (const [a, b] of [[91, 0], [0, -181], ["47.6", -122.3], [NaN, 0], [Infinity, 0], [0, null], [-91, 0], [0, 181]]) {
    m.setLocation(a, b);
  }
  assert.equal(f.calls.setView.length, before);
  assert.deepEqual(f.calls.markers.at(-1), [47.6062, -122.3321]);
  assert.equal(m.state, "ready");
});

test("invalid first call keeps the section hidden", () => {
  const { root } = fakeRoot();
  const m = createLocationMap(root, { leaflet: fakeLeaflet().L });
  m.setLocation(91, 0);
  assert.equal(m.state, "hidden");
  assert.equal(root.hidden, true);
});

test("first layer load with errors and no tiles is unavailable, a later call retries (S6)", async () => {
  const { root, els } = fakeRoot();
  const f = fakeLeaflet();
  const m = createLocationMap(root, { leaflet: f.L });
  m.setLocation(1, 2);
  await tick();
  f.handlers.tileerror();
  f.handlers.load();
  assert.equal(m.state, "unavailable");
  assert.equal(els.map.hidden, true);
  assert.equal(els["map-unavailable"].hidden, false);
  assert.equal(m.leafletMap, null);
  m.setLocation(3, 4);
  assert.equal(m.state, "loading");
  assert.equal(els.map.hidden, false);
  assert.equal(els["map-unavailable"].hidden, true);
});

test("tile errors after a loaded tile keep the state ready", async () => {
  const { root } = fakeRoot();
  const f = fakeLeaflet();
  const m = createLocationMap(root, { leaflet: f.L });
  m.setLocation(1, 2);
  await tick();
  f.handlers.tileload();
  f.handlers.tileerror();
  f.handlers.load();
  assert.equal(m.state, "ready");
});

test("no tile within the timeout is unavailable (S6)", async () => {
  const { root } = fakeRoot();
  const m = createLocationMap(root, { leaflet: fakeLeaflet().L, failTimeoutMs: 10 });
  m.setLocation(1, 2);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(m.state, "unavailable");
});

test("a set-up exception is unavailable and never thrown (S6)", async () => {
  const { root } = fakeRoot();
  const f = fakeLeaflet();
  f.L.map = () => { throw new Error("boom"); };
  const m = createLocationMap(root, { leaflet: f.L });
  assert.doesNotThrow(() => m.setLocation(1, 2));
  await tick();
  assert.equal(m.state, "unavailable");
});

test("a missing vendor module is unavailable (S6)", async () => {
  const { root } = fakeRoot();
  const m = createLocationMap(root, { leaflet: null, tileUrl: undefined });
  // default import path does not resolve from the test directory
  m.setLocation(1, 2);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(m.state, "unavailable");
});

test("the module never calls locate (T8)", async () => {
  const { root } = fakeRoot();
  const f = fakeLeaflet();
  const m = createLocationMap(root, { leaflet: f.L });
  m.setLocation(1, 2);
  await tick();
  assert.equal(f.calls.locate, 0);
});
