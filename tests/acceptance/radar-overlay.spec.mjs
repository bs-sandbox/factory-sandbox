// LIV-17 acceptance tests, one per AC scenario (S1..S13). Run with @playwright/test.
import { test, expect } from "@playwright/test";
import { setup, toggle, stamp, unavailable, overlayTiles, attribution, payload } from "./radar-helpers.mjs";

test.use({ timezoneId: "America/Los_Angeles", locale: "en-US" });

async function expectOffAfterFailure(page, tiles) {
  await expect(unavailable(page)).toBeVisible();
  await expect(unavailable(page)).toHaveText("Radar is unavailable right now.");
  await expect(toggle(page)).not.toBeChecked();
  await expect(stamp(page)).toBeHidden();
  await expect(overlayTiles(page)).toHaveCount(0);
  await expect(page.locator('[data-testid="map"]')).toBeVisible();
  await expect(page.locator('[data-testid="map"] .leaflet-tile-pane')).toBeAttached();
  if (tiles) expect(tiles.length).toBe(0);
}

async function turnOn(page) {
  await toggle(page).click();
  await expect(stamp(page)).toBeVisible();
}

test("S1 toggle default: visible, off, no overlay, no timestamp", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("switch", { name: "Radar" })).toBeVisible();
  await expect(toggle(page)).not.toBeChecked();
  await expect(overlayTiles(page)).toHaveCount(0);
  await expect(stamp(page)).toBeHidden();
});

test("S2 turning radar on draws overlay and shows on state", async ({ page }) => {
  await setup(page);
  await toggle(page).click();
  await expect(overlayTiles(page).first()).toBeAttached();
  await expect(toggle(page)).toBeChecked();
});

test("S3 timestamp from the data source in browser zone", async ({ page }) => {
  await setup(page);
  await toggle(page).click();
  await expect(page.getByText("Radar updated 2:10 PM PDT", { exact: true })).toBeVisible();
});

test("S4 turning radar off removes overlay and timestamp, base map remains", async ({ page }) => {
  await setup(page);
  await turnOn(page);
  await toggle(page).uncheck();
  await expect(overlayTiles(page)).toHaveCount(0);
  await expect(stamp(page)).toBeHidden();
  await expect(toggle(page)).not.toBeChecked();
  await expect(page.locator('[data-testid="map"] .leaflet-tile-pane')).toBeAttached();
  await expect(page.locator('[data-testid="map"]')).toBeVisible();
});

test("S5 attribution text and link visible without interaction", async ({ page }) => {
  await setup(page);
  await turnOn(page);
  const link = attribution(page).locator('a[href="https://www.rainviewer.com/"]');
  await expect(link).toBeVisible();
  await expect(link).toHaveText("RainViewer");
  await expect(attribution(page)).toContainText("Weather data by RainViewer");
});

for (const mode of ["500", "abort", "tile-abort"]) {
  test(`S6 radar unavailable (${mode}): message, toggle off, base map remains`, async ({ page }) => {
    const { tiles } = await setup(page, { mode });
    await toggle(page).click();
    await expectOffAfterFailure(page, mode === "tile-abort" ? null : tiles);
  });
}

test("S7 state not persisted: reload gives off and nothing stored", async ({ page }) => {
  await setup(page);
  await turnOn(page);
  await page.reload();
  await page.locator('[data-testid="map"]').waitFor();
  await expect(toggle(page)).not.toBeChecked();
  const stored = await page.evaluate(async () => ({
    cookie: document.cookie,
    local: localStorage.length,
    session: sessionStorage.length,
    idb: (await indexedDB.databases()).length,
  }));
  expect(stored).toEqual({ cookie: "", local: 0, session: 0, idb: 0 });
  expect((await page.context().cookies()).length).toBe(0);
});

test("S8 360px viewport: toggle and timestamp inside viewport, not covering attribution", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await setup(page);
  await turnOn(page);
  const a = await attribution(page).boundingBox();
  for (const loc of [toggle(page), stamp(page)]) {
    const b = await loc.boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(360);
    const overlap = b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
    expect(overlap).toBe(false);
  }
});

test("S9 no RainViewer traffic before opt-in or after opt-out", async ({ page }) => {
  const { rv } = await setup(page);
  await page.waitForTimeout(1500);
  expect(rv.length).toBe(0);
  await turnOn(page);
  await toggle(page).uncheck();
  await expect(toggle(page)).not.toBeChecked();
  await page.waitForTimeout(500);
  const n = rv.length;
  await page.waitForTimeout(2000);
  expect(rv.length).toBe(n);
});

test("S10 no Referer and no Cookie on RainViewer requests", async ({ page, context }) => {
  await context.addCookies([{ name: "probe", value: "1", url: "https://api.rainviewer.com/" }]);
  await context.addCookies([{ name: "probe", value: "1", url: "https://tilecache.rainviewer.com/" }]);
  const { rv } = await setup(page);
  await turnOn(page);
  expect(rv.length).toBeGreaterThan(0);
  for (const r of rv) {
    const h = await r.allHeaders();
    expect(Object.keys(h)).not.toContain("referer");
    expect(Object.keys(h)).not.toContain("cookie");
  }
});

test("S11 tile host fixed, response host ignored", async ({ page }) => {
  const { tiles, all } = await setup(page, { body: payload({ host: "https://attacker.example" }) });
  await toggle(page).click();
  await expect(overlayTiles(page).first()).toBeAttached();
  expect(tiles.length).toBeGreaterThan(0);
  for (const t of tiles) expect(t.url().startsWith("https://tilecache.rainviewer.com/")).toBe(true);
  expect(all.some((r) => r.url().includes("attacker.example"))).toBe(false);
});

const S12 = [
  ["path", "/v2/radar/../x"],
  ["path", "/v2/radar/{s}abc"],
  ["path", "https://attacker.example/v2/radar/x"],
  ["path", "/v2/radar/abc?x=1"],
  ["time", 0],
  ["time", -5],
  ["time", "1792530600"],
  ["time", 1792530600.5],
  ["time", 9007199254740991],
];
for (const [field, value] of S12) {
  test(`S12 invalid frame rejected: ${field}=${JSON.stringify(value)}`, async ({ page }) => {
    // Single-entry list so the frame under test is unambiguously "the latest frame".
    const latest = { time: 1792530600, path: "/v2/radar/bbb222", [field]: value };
    const body = payload({ latest });
    body.radar.past = [latest];
    const { tiles } = await setup(page, { body });
    await toggle(page).click();
    await expectOffAfterFailure(page, tiles);
  });
}

for (const [name, mutate] of [
  ["empty radar.past", (b) => { b.radar.past = []; }],
  ["missing radar.past", (b) => { delete b.radar.past; }],
]) {
  test(`S13 ${name} rejected`, async ({ page }) => {
    const body = payload();
    mutate(body);
    const { tiles } = await setup(page, { body });
    await toggle(page).click();
    await expectOffAfterFailure(page, tiles);
  });
}
