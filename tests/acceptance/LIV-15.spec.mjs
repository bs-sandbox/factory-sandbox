// Browser acceptance tests for LIV-15 (AC S6 UI, S7, S8, S9, S13, S14, S15 DOM, S18, S19).
// Written from the AC and contracts/ui/daily-outlook.md (+ city-search.md, current-conditions.md) only.
// Synthetic data only. Every test builds its own browser context.
import { test, expect } from "@playwright/test";

const API = "https://api.open-meteo.com/**";
const GEOCODE = "https://geocoding-api.open-meteo.com/**";
const POS = { latitude: 47.6062, longitude: -122.3321 }; // place A (geolocation)
const PLACES = {
  Seattle: { results: [{ name: "Seattle", admin1: "Washington", country: "United States", latitude: 47.6062, longitude: -122.3321 }] },
  Springfield: { results: [{ name: "Springfield", admin1: "Illinois", country: "United States", latitude: 39.80172, longitude: -89.64371 }] },
};
const json = (status, obj) => ({ status, contentType: "application/json", body: JSON.stringify(obj) });
const dates = (n) => Array.from({ length: n }, (_, i) => `2026-10-${String(20 + i).padStart(2, "0")}`);
const forecast = ({ n = 10, high = 18, low = 9, code = 61, precip = 70 } = {}) => ({
  daily: {
    time: dates(n),
    weather_code: dates(n).map(() => code),
    temperature_2m_max: dates(n).map(() => high),
    temperature_2m_min: dates(n).map(() => low),
    precipitation_probability_max: dates(n).map(() => precip),
  },
});

/**
 * outlook: (info) => fulfil object | "abort" | Promise of those; info = { n (1-based call number), lat, lon }.
 * Geolocation grants POS immediately, so place A is loaded on page load.
 */
async function setup(browser, { outlook, viewport, geo = "grant" } = {}) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  const log = { requests: [], outlook: [], console: [], dialogs: [], pageErrors: [] };
  page.on("request", (r) => log.requests.push(r.url()));
  page.on("console", (m) => log.console.push(m.text()));
  page.on("dialog", async (d) => { log.dialogs.push(d.message()); await d.dismiss(); });
  page.on("pageerror", (e) => log.pageErrors.push(String(e)));
  await page.route(GEOCODE, (route) => route.fulfill(json(200, PLACES[new URL(route.request().url()).searchParams.get("name")] ?? { results: [] })));
  await page.route(API, async (route) => {
    const u = new URL(route.request().url());
    if (!u.searchParams.has("daily")) {
      return route.fulfill(json(200, { current: { temperature_2m: 14, weather_code: 2 } }));
    }
    const info = { n: log.outlook.length + 1, lat: Number(u.searchParams.get("latitude")), lon: Number(u.searchParams.get("longitude")) };
    log.outlook.push({ url: route.request().url(), ...info });
    const r = await outlook(info);
    if (r === "abort") return route.abort("failed");
    return route.fulfill(r);
  });
  await page.addInitScript(({ pos, geo }) => {
    const fake = {
      getCurrentPosition(ok, err) {
        setTimeout(() => (geo === "deny" ? err({ code: 1, message: "denied" }) : ok({ coords: { latitude: pos.latitude, longitude: pos.longitude, accuracy: 10 }, timestamp: Date.now() })), 0);
      },
      watchPosition() { return 0; },
      clearWatch() {},
    };
    Object.defineProperty(Navigator.prototype, "geolocation", { get() { return fake; }, configurable: true });
  }, { pos: POS, geo });
  await page.goto("/");
  return { page, context, log };
}

const section = (p) => p.getByTestId("outlook-section");
const days = (p) => p.getByTestId("outlook-day");
const unavailable = (p) => p.getByTestId("outlook-unavailable");
const retry = (p) => p.getByTestId("outlook-retry");
const MSG = "Outlook is unavailable right now.";
const settle = (p) => p.waitForTimeout(600);

async function choose(page, city) {
  await page.getByLabel("City name").fill(city);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByTestId("city-search-result-button").first().click();
}
const chooseSpringfield = (page) => choose(page, "Springfield");

test("S6 failure shows the message and Try again; activating it repeats the request and shows entries", async ({ browser }) => {
  const { page, log, context } = await setup(browser, { outlook: ({ n }) => (n === 1 ? json(500, {}) : json(200, forecast({ n: 3 }))) });
  await expect(unavailable(page)).toContainText(MSG);
  await expect(retry(page)).toBeVisible();
  await expect(retry(page)).toHaveText("Try again");
  await expect(days(page)).toHaveCount(0);
  await retry(page).click();
  await expect(days(page)).toHaveCount(3);
  expect(log.outlook.length).toBe(2);
  await expect(unavailable(page)).toBeHidden();
  await context.close();
});

test("S6 network error also shows the message and Try again", async ({ browser }) => {
  const { page, context } = await setup(browser, { outlook: () => "abort" });
  await expect(unavailable(page)).toContainText(MSG);
  await expect(retry(page)).toBeVisible();
  await context.close();
});

test("S7 choosing a different place via city search replaces the outlook", async ({ browser }) => {
  const { page, log, context } = await setup(browser, {
    geo: "deny",
    outlook: ({ lat }) => json(200, lat > 45 ? forecast({ n: 4, high: 18 }) : forecast({ n: 7, high: 5 })),
  });
  await choose(page, "Seattle");
  await expect(days(page)).toHaveCount(4);
  await expect(page.getByTestId("outlook-high").first()).toHaveText("18°C");
  await chooseSpringfield(page);
  await expect(days(page)).toHaveCount(7);
  await expect(page.getByTestId("outlook-high").first()).toHaveText("5°C");
  await expect(page.getByTestId("outlook-high").filter({ hasText: "18°C" })).toHaveCount(0);
  const last = log.outlook.at(-1);
  expect(last.lat).toBe(39.8);
  expect(last.lon).toBe(-89.64);
  await context.close();
});

test("S8 at 360 px all 10 entries are reachable by vertical scroll, show five items, and the page does not scroll horizontally", async ({ browser }) => {
  const { page, context } = await setup(browser, { viewport: { width: 360, height: 640 }, outlook: () => json(200, forecast({ n: 10, code: 99 })) });
  await expect(days(page)).toHaveCount(10);
  for (let i = 0; i < 10; i++) {
    const d = days(page).nth(i);
    await d.scrollIntoViewIfNeeded();
    for (const id of ["outlook-date", "outlook-high", "outlook-low", "outlook-conditions", "outlook-precip"]) {
      await expect(d.getByTestId(id)).toBeVisible();
    }
    await expect(d.getByTestId("outlook-conditions")).toHaveText("Thunderstorm with heavy hail");
    const box = await d.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  }
  const widths = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: document.documentElement.clientWidth }));
  expect(widths.w).toBeLessThanOrEqual(360);
  expect(widths.s).toBeLessThanOrEqual(widths.w);
  await context.close();
});

test("S9 attribution with link is visible while loading, with entries, and on failure", async ({ browser }) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { page, context } = await setup(browser, { outlook: async () => { await gate; return json(200, forecast({ n: 2 })); } });
  const attr = section(page).getByTestId("outlook-attribution");
  await expect(page.getByTestId("outlook-loading")).toBeVisible();
  await expect(attr).toBeVisible();
  await expect(attr).toContainText("Weather data by Open-Meteo.com");
  await expect(attr.locator('a[href="https://open-meteo.com/"]')).toBeVisible();
  release();
  await expect(days(page)).toHaveCount(2);
  await expect(attr).toBeVisible();
  await expect(attr.locator('a[href="https://open-meteo.com/"]')).toBeVisible();
  await context.close();

  const f = await setup(browser, { outlook: () => json(500, {}) });
  await expect(unavailable(f.page)).toBeVisible();
  const attr2 = section(f.page).getByTestId("outlook-attribution");
  await expect(attr2).toContainText("Weather data by Open-Meteo.com");
  await expect(attr2.locator('a[href="https://open-meteo.com/"]')).toBeVisible();
  await f.context.close();
});

test("S13 only request goes to api.open-meteo.com with <=2 dp coordinates; no cookies, localStorage, sessionStorage or IndexedDB", async ({ browser }) => {
  const { page, log, context } = await setup(browser, { outlook: () => json(200, forecast({ n: 5 })) });
  await expect(days(page)).toHaveCount(5);
  const daily = log.requests.filter((u) => u.includes("daily="));
  expect(daily.length).toBe(1);
  const u = new URL(daily[0]);
  expect(u.protocol + "//" + u.host).toBe("https://api.open-meteo.com");
  for (const k of ["latitude", "longitude"]) {
    expect(u.searchParams.get(k)).toMatch(/^-?\d+(\.\d{1,2})?$/);
  }
  expect(await context.cookies()).toEqual([]);
  const store = await page.evaluate(async () => ({
    cookie: document.cookie,
    local: localStorage.length,
    session: sessionStorage.length,
    idb: indexedDB.databases ? (await indexedDB.databases()).length : 0,
  }));
  expect(store).toEqual({ cookie: "", local: 0, session: 0, idb: 0 });
  await context.close();
});

test("S14 a late response for place A is not shown after choosing place B", async ({ browser }) => {
  let releaseA;
  const gateA = new Promise((r) => { releaseA = r; });
  const { page, log, context } = await setup(browser, {
    geo: "deny",
    outlook: async ({ lat }) => {
      if (lat > 45) { await gateA; return json(200, forecast({ n: 10, high: 18 })); }
      return json(200, forecast({ n: 7, high: 5 }));
    },
  });
  await choose(page, "Seattle");
  await expect.poll(() => log.outlook.length).toBe(1); // A pending
  await chooseSpringfield(page);
  await expect(days(page)).toHaveCount(7);
  releaseA();
  await settle(page);
  await expect(days(page)).toHaveCount(7);
  await expect(page.getByTestId("outlook-high").first()).toHaveText("5°C");
  await expect(page.getByTestId("outlook-high").filter({ hasText: "18°C" })).toHaveCount(0);
  await context.close();
});

test("S15 markup in daily.time[0] is not rendered: unavailable message, no img element, no script executed", async ({ browser }) => {
  const bad = forecast({ n: 10 });
  bad.daily.time[0] = "<img src=x onerror=alert(1)>";
  const { page, log, context } = await setup(browser, { outlook: () => json(200, bad) });
  await expect(unavailable(page)).toContainText(MSG);
  await expect(retry(page)).toBeVisible();
  await settle(page);
  expect(await section(page).locator("img").count()).toBe(0);
  expect(log.dialogs).toEqual([]);
  expect(log.pageErrors).toEqual([]);
  await context.close();
});

test("S18 no automatic retries; each Try again sends exactly one request", async ({ browser }) => {
  const { page, log, context } = await setup(browser, { outlook: () => json(500, {}) });
  await expect(unavailable(page)).toBeVisible();
  await expect.poll(() => log.outlook.length).toBe(1);
  await page.waitForTimeout(2000);
  expect(log.outlook.length).toBe(1);
  await retry(page).click();
  await expect.poll(() => log.outlook.length).toBe(2);
  await expect(unavailable(page)).toBeVisible();
  await page.waitForTimeout(1000);
  expect(log.outlook.length).toBe(2);
  await retry(page).click();
  await expect.poll(() => log.outlook.length).toBe(3);
  await page.waitForTimeout(1000);
  expect(log.outlook.length).toBe(3);
  await context.close();
});

for (const [name, outlook] of [["success", () => json(200, forecast({ n: 10 }))], ["failure", () => json(500, {})]]) {
  test(`S19 console has no latitude/longitude and no outlook request URL (${name})`, async ({ browser }) => {
    const { page, log, context } = await setup(browser, { outlook });
    if (name === "success") await expect(days(page)).toHaveCount(10);
    else await expect(unavailable(page)).toBeVisible();
    await settle(page);
    for (const line of log.console) {
      expect(line).not.toMatch(/47\.6|122\.3|-?\d{1,3}\.\d{2}\b/);
      expect(line).not.toContain("api.open-meteo.com");
      expect(line).not.toContain("latitude");
      expect(line).not.toContain("longitude");
      expect(line).not.toContain("daily=");
    }
    await context.close();
  });
}
