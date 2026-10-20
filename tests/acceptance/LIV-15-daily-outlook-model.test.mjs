// Acceptance tests for LIV-15 (10-day outlook), pure-model level.
// Written from the AC and contracts/ui/daily-outlook.md only (sections 1a, 3, 4).
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildOutlookUrl,
  parseDailyOutlook,
  formatTemperature,
  formatPrecipitation,
  formatDayLabel,
} from "../../src/js/daily-outlook-model.js";
import { conditionLabel } from "../../src/js/weather-codes.js";

function isoDays(n, start = "2026-10-20") {
  const out = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
function response(n, over = {}) {
  const fill = (v) => Array.from({ length: n }, () => v);
  return {
    daily: {
      time: isoDays(n),
      weather_code: fill(61),
      temperature_2m_max: fill(18),
      temperature_2m_min: fill(9),
      precipitation_probability_max: fill(70),
      ...over,
    },
  };
}

test("test_S1_ten_days_in_date_order_first_is_day_one", () => {
  const days = parseDailyOutlook(response(10));
  assert.equal(days.length, 10);
  assert.deepEqual(days.map((d) => d.date), isoDays(10));
  assert.equal(days[0].date, "2026-10-20");
});

test("test_S2_entry_contents", () => {
  const r = response(10, {
    weather_code: [61, ...Array(9).fill(0)],
    temperature_2m_max: [18, ...Array(9).fill(1)],
    temperature_2m_min: [9, ...Array(9).fill(0)],
    precipitation_probability_max: [70, ...Array(9).fill(0)],
  });
  const d = parseDailyOutlook(r)[0];
  assert.equal(d.label, "Tue 20 Oct");
  assert.equal(d.high, "18°C");
  assert.equal(d.low, "9°C");
  assert.equal(d.conditions, "Light rain");
  assert.equal(d.precipitation, "70%");
});

test("test_S3_precipitation_boundaries", () => {
  const r = response(2, { precipitation_probability_max: [0, 100] });
  const days = parseDailyOutlook(r);
  assert.equal(days[0].precipitation, "0%");
  assert.equal(days[1].precipitation, "100%");
});

test("test_S4_sub_zero_temperatures", () => {
  const r = response(1, { temperature_2m_max: [-2], temperature_2m_min: [-11] });
  const d = parseDailyOutlook(r)[0];
  assert.equal(d.high, "-2°C");
  assert.equal(d.low, "-11°C");
  assert.equal(formatTemperature(-2), "-2°C");
});

test("test_S5_fewer_than_ten_days_no_empty_entries", () => {
  const days = parseDailyOutlook(response(6));
  assert.equal(days.length, 6);
  for (const d of days) {
    for (const k of ["label", "high", "low", "conditions", "precipitation"]) {
      assert.ok(typeof d[k] === "string" && d[k].length > 0, `${k} empty`);
    }
  }
});

test("test_S10_rounding", () => {
  const r = response(1, {
    temperature_2m_max: [18.4],
    temperature_2m_min: [-0.4],
    precipitation_probability_max: [69.6],
  });
  const d = parseDailyOutlook(r)[0];
  assert.equal(d.high, "18°C");
  assert.equal(d.low, "0°C");
  assert.equal(d.precipitation, "70%");
  assert.equal(formatTemperature(-0.4), "0°C");
  assert.equal(formatPrecipitation(69.6), "70%");
});

test("test_S11_date_format_independent_of_time_zone", () => {
  assert.equal(formatDayLabel("2026-10-20"), "Tue 20 Oct");
  assert.equal(parseDailyOutlook(response(1))[0].label, "Tue 20 Oct");
});

test("test_S12_incomplete_day_truncates_list", () => {
  const p = Array(10).fill(50);
  p[6] = null; // day 7
  const days = parseDailyOutlook(response(10, { precipitation_probability_max: p }));
  assert.equal(days.length, 6);
  assert.deepEqual(days.map((d) => d.date), isoDays(6));
});

test("test_S12_day_one_incomplete_is_unavailable", () => {
  const p = Array(10).fill(50);
  p[0] = null;
  assert.equal(parseDailyOutlook(response(10, { precipitation_probability_max: p })), null);
});

test("test_S13_request_url_two_decimals_and_host", () => {
  const u = new URL(buildOutlookUrl("https://api.open-meteo.com/v1/forecast", 51.507351, -0.127758));
  assert.equal(u.origin, "https://api.open-meteo.com");
  assert.equal(u.pathname, "/v1/forecast");
  assert.equal(u.searchParams.get("latitude"), "51.51");
  assert.equal(u.searchParams.get("longitude"), "-0.13");
  assert.equal(u.searchParams.get("daily"),
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  assert.equal(u.searchParams.get("timezone"), "auto");
  assert.equal(u.searchParams.get("forecast_days"), "10");
});

test("test_S15_markup_in_date_is_rejected", () => {
  const r = response(10);
  r.daily.time[0] = "<img src=x onerror=alert(1)>";
  assert.equal(parseDailyOutlook(r), null);
});

test("test_S16_non_numeric_weather_code_is_rejected", () => {
  const codes = Array(10).fill(61);
  codes[0] = "<b>Sunny</b>";
  assert.equal(parseDailyOutlook(response(10, { weather_code: codes })), null);
});

test("test_S16_non_numeric_temperature_is_rejected", () => {
  const t = Array(10).fill(18);
  t[0] = "<b>hot</b>";
  assert.equal(parseDailyOutlook(response(10, { temperature_2m_max: t })), null);
});

test("test_S17_unknown_code_shows_Unknown_and_extra_fields_ignored", () => {
  const codes = Array(10).fill(61);
  codes[0] = 12345;
  const r = response(10, { weather_code: codes, summary: ["Visit evil.example"] });
  const days = parseDailyOutlook(r);
  assert.equal(days[0].conditions, "Unknown");
  assert.ok(!JSON.stringify(days).includes("evil.example"));
  assert.equal(conditionLabel(12345), "Unknown");
});

test("test_S2_label_table_codes", () => {
  const expected = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog",
    48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    56: "Light freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain",
    65: "Heavy rain", 66: "Light freezing rain", 67: "Freezing rain", 71: "Light snow",
    73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Light showers", 81: "Showers",
    82: "Heavy showers", 85: "Light snow showers", 86: "Snow showers", 95: "Thunderstorm",
    96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
  };
  for (const [code, label] of Object.entries(expected)) {
    assert.equal(conditionLabel(Number(code)), label, `code ${code}`);
  }
});

test("test_S6_invalid_shapes_are_unavailable", () => {
  for (const bad of [null, {}, { daily: null }, { daily: { time: [] } }, "x", 5]) {
    assert.equal(parseDailyOutlook(bad), null);
  }
});
