import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { build } from "../scripts/build.mjs";

test("the build copies src/ to dist/", () => {
  const root = mkdtempSync(join(tmpdir(), "build-"));
  mkdirSync(join(root, "src", "css"), { recursive: true });
  writeFileSync(join(root, "src", "index.html"), "<p>hi</p>");
  writeFileSync(join(root, "src", "css", "a.css"), "p{}");
  const dist = build(root);
  assert.equal(readFileSync(join(dist, "index.html"), "utf8"), "<p>hi</p>");
  assert.equal(readFileSync(join(dist, "css", "a.css"), "utf8"), "p{}");
});

test("the build fails without src/index.html", () => {
  const root = mkdtempSync(join(tmpdir(), "build-"));
  mkdirSync(join(root, "src"));
  assert.throws(() => build(root), /src\/index.html is missing/);
});

test("the real site has a page", () => {
  const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
});

test("the build vendors Leaflet ESM, CSS and images into dist/vendor/leaflet", () => {
  const root = mkdtempSync(join(tmpdir(), "build-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "index.html"), "<p>hi</p>");
  const dist0 = join(root, "node_modules", "leaflet", "dist");
  mkdirSync(join(dist0, "images"), { recursive: true });
  writeFileSync(join(dist0, "leaflet-src.esm.js"), "export default {}");
  writeFileSync(join(dist0, "leaflet.css"), ".a{}");
  writeFileSync(join(dist0, "leaflet.js"), "not copied");
  writeFileSync(join(dist0, "images", "marker-icon.png"), "png");
  const dist = build(root);
  assert.equal(readFileSync(join(dist, "vendor", "leaflet", "leaflet-src.esm.js"), "utf8"), "export default {}");
  assert.equal(readFileSync(join(dist, "vendor", "leaflet", "leaflet.css"), "utf8"), ".a{}");
  assert.equal(readFileSync(join(dist, "vendor", "leaflet", "images", "marker-icon.png"), "utf8"), "png");
  assert.equal(existsSync(join(dist, "vendor", "leaflet", "leaflet.js")), false);
});
