import assert from "node:assert/strict";
import { test } from "node:test";

import { roundCoordinate, formatTemperature } from "../src/js/format.js";
import { conditionLabel } from "../src/js/weather-codes.js";
import { buildConditionsUrl, parseCurrentConditions } from "../src/js/current-conditions-model.js";
import { requestLocation } from "../src/js/location-source.js";
import { startShell, setLocationAll } from "../src/js/page-shell.js";
import { createConditionsController } from "../src/js/current-conditions.js";

// S13
test("roundCoordinate rounds to 2 dp and never returns -0", () => {
  assert.equal(roundCoordinate(47.6062), 47.61);
  assert.equal(roundCoordinate(-122.3321), -122.33);
  assert.ok(!Object.is(roundCoordinate(-0.001), -0));
});

// S10
test("formatTemperature rounds and avoids negative zero", () => {
  assert.equal(formatTemperature(14), "14°C");
  assert.equal(formatTemperature(13.6), "14°C");
  assert.equal(formatTemperature(-0.4), "0°C");
  assert.equal(formatTemperature(-2), "-2°C");
});

// S2, S11
test("conditionLabel maps known codes and returns Unknown otherwise", () => {
  assert.equal(conditionLabel(2), "Partly cloudy");
  assert.equal(conditionLabel(99), "Thunderstorm with heavy hail");
  assert.equal(conditionLabel(1234), "Unknown");
  assert.equal(conditionLabel("2"), "Unknown");
  assert.equal(conditionLabel("constructor"), "Unknown");
});

// S13
test("buildConditionsUrl sends 2 dp coordinates and only the current fields", () => {
  const u = new URL(buildConditionsUrl(47.6062, -122.3321));
  assert.equal(u.origin + u.pathname, "https://api.open-meteo.com/v1/forecast");
  assert.equal(u.searchParams.get("latitude"), "47.61");
  assert.equal(u.searchParams.get("longitude"), "-122.33");
  assert.equal(u.searchParams.get("current"), "temperature_2m,weather_code");
  assert.deepEqual([...u.searchParams.keys()].sort(), ["current", "latitude", "longitude"]);
});

// S2, S15, S16, S17
test("parseCurrentConditions validates strictly", () => {
  assert.deepEqual(parseCurrentConditions({ current: { temperature_2m: 14, weather_code: 2 } }),
    { temperature: "14°C", conditions: "Partly cloudy" });
  assert.equal(parseCurrentConditions({ current: { temperature_2m: "<img src=x onerror=alert(1)>", weather_code: 2 } }), null);
  assert.equal(parseCurrentConditions({ current: { temperature_2m: "14", weather_code: "2" } }), null);
  assert.equal(parseCurrentConditions({ error: true, reason: "Visit evil.example" }), null);
  assert.equal(parseCurrentConditions({ current: { temperature_2m: 14, weather_code: 2.5 } }), null);
  assert.equal(parseCurrentConditions({ current: { temperature_2m: NaN, weather_code: 2 } }), null);
  assert.equal(parseCurrentConditions({ current: { temperature_2m: 500, weather_code: 2 } }), null);
  assert.equal(parseCurrentConditions(null), null);
  assert.equal(parseCurrentConditions([]), null);
  assert.equal(parseCurrentConditions({ current: null }), null);
});

// S11
test("unknown code gives Unknown and no response text", () => {
  const r = parseCurrentConditions({ current: { temperature_2m: 1, weather_code: 7777, note: "evil" } });
  assert.deepEqual(r, { temperature: "1°C", conditions: "Unknown" });
});

// S3, S4, S12
test("requestLocation maps outcomes", async () => {
  const geo = (fn) => ({ getCurrentPosition: fn });
  assert.deepEqual(
    await requestLocation(geo((ok) => ok({ coords: { latitude: 47.6062, longitude: -122.3321 } }))),
    { kind: "position", latitude: 47.6062, longitude: -122.3321 });
  assert.deepEqual(await requestLocation(geo((_, err) => err({ code: 1 }))), { kind: "denied" });
  assert.deepEqual(await requestLocation(geo((_, err) => err({ code: 2 }))), { kind: "unavailable" });
  assert.deepEqual(await requestLocation(geo((_, err) => err({ code: 3 }))), { kind: "unavailable" });
  assert.deepEqual(await requestLocation(geo((ok) => ok({ coords: { latitude: NaN, longitude: 0 } }))), { kind: "unavailable" });
  assert.deepEqual(await requestLocation(geo((ok) => ok({ coords: { latitude: 91, longitude: 0 } }))), { kind: "unavailable" });
  assert.deepEqual(await requestLocation(geo(() => { throw new Error("x"); })), { kind: "unavailable" });
  assert.deepEqual(await requestLocation(undefined), { kind: "unavailable" });
});

test("requestLocation calls getCurrentPosition once with the contract options", async () => {
  let calls = 0; let opts;
  await requestLocation({ getCurrentPosition: (ok, _e, o) => { calls += 1; opts = o; ok({ coords: { latitude: 1, longitude: 1 } }); } });
  assert.equal(calls, 1);
  assert.deepEqual(opts, { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 });
});

test("startShell routes results and isolates failures", async () => {
  const seen = [];
  const consumers = [{ setLocation() { throw new Error("boom"); } }, { setLocation: (a, b) => seen.push([a, b]) }];
  await startShell({ requestLocation: async () => ({ kind: "position", latitude: 1, longitude: 2 }), consumers });
  assert.deepEqual(seen, [[1, 2]]);
  const calls = [];
  await startShell({ requestLocation: async () => ({ kind: "denied" }), consumers,
    onDenied: [() => { throw new Error("x"); }, () => calls.push("d")], onUnavailable: [() => calls.push("u")] });
  await startShell({ requestLocation: async () => ({ kind: "unavailable" }), consumers,
    onDenied: [() => calls.push("d2")], onUnavailable: [() => calls.push("u")] });
  assert.deepEqual(calls, ["d", "u"]);
  await assert.doesNotReject(startShell({ requestLocation: async () => { throw new Error("x"); }, consumers }));
  setLocationAll(consumers, 3, 4);
  assert.deepEqual(seen.at(-1), [3, 4]);
});

function makeController(fetchImpl, extra = {}) {
  const views = [];
  const c = createConditionsController({ render: (v) => views.push(v), fetch: fetchImpl, ...extra });
  return { c, views };
}
const ok = (body) => async () => ({ ok: true, json: async () => body });
const tick = () => new Promise((r) => setTimeout(r, 0));

// S1
test("controller starts in locating with no request", () => {
  let n = 0;
  const { c, views } = makeController(async () => { n += 1; });
  assert.equal(c.state, "locating");
  assert.deepEqual(views, [{ state: "locating" }]);
  assert.equal(n, 0);
});

// S2, S19
test("controller loads conditions with safe fetch options", async () => {
  let args;
  const { c, views } = makeController(async (url, o) => { args = [url, o]; return { ok: true, json: async () => ({ current: { temperature_2m: 14, weather_code: 2 } }) }; });
  c.setLocation(47.6062, -122.3321);
  assert.equal(c.state, "loading");
  await tick();
  assert.deepEqual(views.at(-1), { state: "ready", temperature: "14°C", conditions: "Partly cloudy" });
  assert.equal(args[1].credentials, "omit");
  assert.equal(args[1].cache, "no-store");
  assert.equal(args[1].referrerPolicy, "no-referrer");
  assert.ok(args[0].includes("latitude=47.61"));
});

// S5, S14
test("failure goes to unavailable, no auto retry, retry sends one request", async () => {
  let n = 0; let fail = true;
  const { c } = makeController(async () => {
    n += 1;
    if (fail) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ current: { temperature_2m: 5, weather_code: 0 } }) };
  });
  c.setLocation(1, 2);
  await tick();
  assert.equal(c.state, "unavailable");
  await tick();
  assert.equal(n, 1);
  fail = false;
  c.retry();
  await tick();
  assert.equal(n, 2);
  assert.equal(c.state, "ready");
  c.retry(); // not in unavailable: no-op
  assert.equal(n, 2);
});

test("network error, bad JSON and invalid shape are unavailable", async () => {
  for (const f of [async () => { throw new Error("net"); }, async () => ({ ok: true, json: async () => { throw new Error("bad"); } }), ok({ current: {} })]) {
    const { c } = makeController(f);
    c.setLocation(1, 2);
    await tick();
    assert.equal(c.state, "unavailable");
  }
});

test("timeout aborts the request and gives unavailable", async () => {
  const { c } = makeController((url, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("abort")))), { timeoutMs: 10 });
  c.setLocation(1, 2);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(c.state, "unavailable");
});

// T7
test("a superseded response is discarded", async () => {
  const resolvers = [];
  const { c, views } = makeController(() => new Promise((res) => resolvers.push(res)));
  c.setLocation(1, 2);
  c.setLocation(3, 4);
  resolvers[0]({ ok: true, json: async () => ({ current: { temperature_2m: 1, weather_code: 0 } }) });
  await tick();
  assert.equal(c.state, "loading");
  resolvers[1]({ ok: true, json: async () => ({ current: { temperature_2m: 9, weather_code: 3 } }) });
  await tick();
  assert.deepEqual(views.at(-1), { state: "ready", temperature: "9°C", conditions: "Overcast" });
});

// S3, S4, T8
test("denied and no-location abort requests; invalid input is ignored", async () => {
  let n = 0;
  const { c } = makeController(() => { n += 1; return new Promise(() => {}); });
  c.setLocation(NaN, 2);
  c.setLocation("1", 2);
  c.setLocation(100, 2);
  assert.equal(n, 0);
  assert.equal(c.state, "locating");
  c.showDenied();
  assert.equal(c.state, "denied");
  c.showLocationUnavailable();
  assert.equal(c.state, "no-location");
  c.setLocation(1, 2); // from denied/no-location replaces the message
  assert.equal(c.state, "loading");
});

test("render exceptions never reach the caller", () => {
  const c = createConditionsController({ render() { throw new Error("x"); }, fetch: ok({}) });
  assert.doesNotThrow(() => c.showDenied());
});
