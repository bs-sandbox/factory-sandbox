// Controller tests with an injected fetch and a minimal DOM double (LIV-15 S6, S7, S14, S18).
import test from "node:test";
import assert from "node:assert/strict";
import { createDailyOutlook } from "../src/js/daily-outlook.js";

function node(tag) {
  return {
    tag, hidden: false, children: [], listeners: {}, textContent: "", attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...n) { this.children.push(...n); },
    replaceChildren(...n) { this.children = [...n]; },
    addEventListener(t, f) { (this.listeners[t] ??= []).push(f); },
    click() { (this.listeners.click ?? []).forEach((f) => f({})); },
  };
}
function makeRoot() {
  const ids = Object.fromEntries(
    ["outlook-loading", "outlook-list", "outlook-unavailable", "outlook-retry"].map((i) => [i, node("x")]),
  );
  return {
    ids,
    root: {
      hidden: true,
      ownerDocument: { createElement: node },
      querySelector: (s) => ids[/"(.*)"/.exec(s)[1]],
    },
  };
}
const body = (code = 61) => ({
  daily: {
    time: Array.from({ length: 10 }, (_, i) => `2026-10-${String(20 + i).padStart(2, "0")}`),
    weather_code: Array(10).fill(code),
    temperature_2m_max: Array(10).fill(18),
    temperature_2m_min: Array(10).fill(9),
    precipitation_probability_max: Array(10).fill(70),
  },
});
const ok = (b) => ({ ok: true, json: async () => b });
const tick = () => new Promise((r) => setTimeout(r, 0));
const deferred = () => { let res; const p = new Promise((r) => (res = r)); return { p, res }; };

test("S6/S18: failure shows unavailable, no auto retry, one request per Try again", async () => {
  const { root, ids } = makeRoot();
  let calls = 0, fail = true;
  const o = createDailyOutlook(root, { fetch: async () => { calls++; return fail ? { ok: false } : ok(body()); } });
  o.setLocation(51.5, -0.12);
  await tick(); await tick();
  assert.equal(o.state, "unavailable");
  assert.equal(ids["outlook-unavailable"].hidden, false);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, 1);
  ids["outlook-retry"].click();
  await tick(); await tick();
  assert.equal(calls, 2);
  assert.equal(o.state, "unavailable");
  fail = false;
  ids["outlook-retry"].click();
  await tick(); await tick();
  assert.equal(calls, 3);
  assert.equal(o.state, "ready");
  assert.equal(ids["outlook-list"].children.length, 10);
});

test("S7/S14: stale response for place A is discarded", async () => {
  const { root, ids } = makeRoot();
  const a = deferred(), b = deferred();
  const queue = [a, b];
  const o = createDailyOutlook(root, { fetch: () => queue.shift().p });
  o.setLocation(10, 10);
  o.setLocation(20, 20);
  b.res(ok(body(61)));
  await tick(); await tick();
  assert.equal(o.state, "ready");
  const firstConditions = () => ids["outlook-list"].children[0].children.find((c) => c.attrs["data-testid"] === "outlook-conditions").textContent;
  assert.equal(firstConditions(), "Light rain");
  a.res(ok(body(0)));
  await tick(); await tick();
  assert.equal(firstConditions(), "Light rain");
});

test("never throws: invalid coordinates ignored, fetch rejection becomes unavailable", async () => {
  const { root } = makeRoot();
  let calls = 0;
  const o = createDailyOutlook(root, { fetch: async () => { calls++; throw new Error("net"); } });
  o.setLocation(NaN, 0);
  o.setLocation(91, 0);
  assert.equal(calls, 0);
  o.setLocation(1, 1);
  await tick(); await tick();
  assert.equal(o.state, "unavailable");
});
