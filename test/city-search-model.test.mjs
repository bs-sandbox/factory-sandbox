import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSearchUrl, formatPlaceLabel, normalizeQuery, parseSearchResponse } from "../src/js/city-search-model.js";

const ok = (o = {}) => ({ name: "Paris", admin1: "Ile-de-France", country: "France", latitude: 48.85, longitude: 2.35, ...o });

test("normalizeQuery trims, cuts to 100 and returns null when empty", () => {
  assert.equal(normalizeQuery("  Paris  "), "Paris");
  assert.equal(normalizeQuery("   "), null);
  assert.equal(normalizeQuery(""), null);
  assert.equal(normalizeQuery("a".repeat(120)), "a".repeat(100));
});

test("buildSearchUrl encodes the query and adds fixed parameters only", () => {
  const u = new URL(buildSearchUrl("a&b=c #d"));
  assert.equal(u.origin, "https://geocoding-api.open-meteo.com");
  assert.equal(u.pathname, "/v1/search");
  assert.equal(u.searchParams.get("name"), "a&b=c #d");
  assert.deepEqual([...u.searchParams.keys()], ["name", "count", "language", "format"]);
});

test("parseSearchResponse: error, none and results kinds", () => {
  assert.equal(parseSearchResponse(null).kind, "error");
  assert.equal(parseSearchResponse([]).kind, "error");
  assert.equal(parseSearchResponse({ error: true, results: [ok()] }).kind, "error");
  assert.equal(parseSearchResponse({ results: "x" }).kind, "error");
  assert.equal(parseSearchResponse({}).kind, "none");
  assert.equal(parseSearchResponse({ results: [] }).kind, "none");
  const r = parseSearchResponse({ results: [ok()] });
  assert.deepEqual(r, { kind: "results", places: [{ name: "Paris", region: "Ile-de-France", country: "France", latitude: 48.85, longitude: 2.35 }] });
});

test("parseSearchResponse drops invalid coordinates and entries; all invalid is error", () => {
  for (const bad of [{ latitude: 91 }, { latitude: -90.1 }, { longitude: 181 }, { longitude: "2.3" }, { latitude: NaN }, { latitude: Infinity }, { name: "" }, { name: 5 }, { name: "‮" }]) {
    assert.equal(parseSearchResponse({ results: [ok(bad)] }).kind, "error", JSON.stringify(bad));
  }
  const r = parseSearchResponse({ results: [null, "x", ok({ latitude: 200 }), ok({ name: "Lyon" })] });
  assert.deepEqual(r.places.map((p) => p.name), ["Lyon"]);
});

test("parseSearchResponse keeps 10 in order, cleans text, whitelists fields", () => {
  const many = Array.from({ length: 12 }, (_, i) => ok({ name: "P" + i }));
  assert.deepEqual(parseSearchResponse({ results: many }).places.map((p) => p.name), many.slice(0, 10).map((p) => p.name));
  const p = parseSearchResponse({ results: [ok({ name: " A\u0000B‮c ", admin1: "", country: "x".repeat(300), extra: 1, __proto__: { polluted: 1 } })] }).places[0];
  assert.equal(p.name, "ABc");
  assert.equal(p.region, null);
  assert.equal(p.country.length, 200);
  assert.deepEqual(Object.keys(p), ["name", "region", "country", "latitude", "longitude"]);
  assert.equal(p.polluted, undefined);
});

test("formatPlaceLabel omits absent parts", () => {
  assert.equal(formatPlaceLabel({ name: "Springfield", region: "Illinois", country: "United States" }), "Springfield, Illinois, United States");
  assert.equal(formatPlaceLabel({ name: "Singapore", region: null, country: "Singapore" }), "Singapore, Singapore");
});
