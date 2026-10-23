import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOutlookUrl, parseDailyOutlook, formatDayLabel, formatPrecipitation,
} from "../src/js/daily-outlook-model.js";

const base = (over = {}) => ({
  daily: {
    time: ["2026-10-20"], weather_code: [1], temperature_2m_max: [1],
    temperature_2m_min: [0], precipitation_probability_max: [5], ...over,
  },
});

test("formatPrecipitation clamps to 0..100", () => {
  assert.equal(formatPrecipitation(-5), "0%");
  assert.equal(formatPrecipitation(140), "100%");
});

test("formatDayLabel rejects impossible dates", () => {
  assert.throws(() => formatDayLabel("2026-02-31"));
  assert.throws(() => formatDayLabel("<b>x</b>"));
});

test("parseDailyOutlook reads at most 10 days", () => {
  const n = 14;
  const time = Array.from({ length: n }, (_, i) => `2026-10-${String(10 + i).padStart(2, "0")}`);
  const fill = (v) => Array(n).fill(v);
  const days = parseDailyOutlook(base({
    time, weather_code: fill(0), temperature_2m_max: fill(1),
    temperature_2m_min: fill(0), precipitation_probability_max: fill(1),
  }));
  assert.equal(days.length, 10);
});

test("parseDailyOutlook rejects non-array fields and non-finite numbers", () => {
  assert.equal(parseDailyOutlook(base({ time: "2026-10-20" })), null);
  assert.equal(parseDailyOutlook(base({ temperature_2m_max: [Infinity] })), null);
  assert.equal(parseDailyOutlook(base({ weather_code: [NaN] })), null);
});

test("buildOutlookUrl rounds negative coordinates to 2 dp", () => {
  const u = new URL(buildOutlookUrl("https://api.open-meteo.com/v1/forecast", -33.8688, 151.2093));
  assert.equal(u.searchParams.get("latitude"), "-33.87");
  assert.equal(u.searchParams.get("longitude"), "151.21");
});
