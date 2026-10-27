import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RADAR_MAX_TIME_S, RADAR_TILE_HOST, buildRadarTileUrl, formatRadarTimestamp, parseWeatherMaps,
} from "../src/js/radar-model.js";

const frames = (...past) => ({ radar: { past } });
const ok = { time: 1792530600, path: "/v2/radar/bbb222" };

test("picks the largest time from an unsorted list", () => {
  const r = parseWeatherMaps(frames(ok, { time: 1792530000, path: "/v2/radar/aaa111" }));
  assert.deepEqual(r, ok);
});

for (const path of ["/v2/radar/../x", "/v2/radar/{s}abc", "https://attacker.example/v2/radar/x", "/v2/radar/abc?x=1", "/v2/radar/a/b", "/v2/radar/", 5, undefined]) {
  test(`rejects path ${String(path)}`, () => {
    assert.equal(parseWeatherMaps(frames({ time: 1792530600, path })), null);
  });
}

for (const time of [0, -5, "1792530600", 1792530600.5, 9007199254740991, RADAR_MAX_TIME_S + 1, NaN, Infinity]) {
  test(`rejects time ${String(time)}`, () => {
    assert.equal(parseWeatherMaps(frames({ time, path: "/v2/radar/abc" })), null);
  });
}

test("accepts time at the Date bound", () => {
  assert.equal(parseWeatherMaps(frames({ time: RADAR_MAX_TIME_S, path: "/v2/radar/abc" })).time, RADAR_MAX_TIME_S);
});

test("an invalid latest frame is not replaced by an older valid one", () => {
  assert.equal(parseWeatherMaps(frames({ time: 1, path: "/v2/radar/ok" }, { time: 2, path: "/v2/radar/../x" })), null);
});

test("empty, missing and malformed radar.past give null", () => {
  for (const j of [frames(), {}, { radar: {} }, { radar: { past: "x" } }, null, undefined, 5, "s", frames(null), frames(5)]) {
    assert.equal(parseWeatherMaps(j), null);
  }
});

test("host from the response is ignored", () => {
  const r = parseWeatherMaps({ host: "https://attacker.example", radar: { past: [ok] } });
  assert.deepEqual(Object.keys(r).sort(), ["path", "time"]);
  assert.ok(buildRadarTileUrl(r.path).startsWith(`${RADAR_TILE_HOST}/`));
  assert.equal(buildRadarTileUrl(r.path), "https://tilecache.rainviewer.com/v2/radar/bbb222/256/{z}/{x}/{y}/2/1_1.png");
});

test("formats the timestamp in the given zone with plain spaces", () => {
  const s = formatRadarTimestamp(1792530600, "America/Los_Angeles");
  assert.equal(s, "Radar updated 2:10 PM PDT");
  assert.doesNotMatch(s, /[  ]/);
});

test("formats the largest accepted time without throwing", () => {
  assert.doesNotThrow(() => formatRadarTimestamp(RADAR_MAX_TIME_S, "UTC"));
});
