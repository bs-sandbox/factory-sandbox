import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
