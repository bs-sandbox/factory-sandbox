// Acceptance tests for LIV-13 (AC S1-S20). Written from the AC and contracts/ui/current-conditions.md only.
// Synthetic data only. Every test builds its own page/context.
import { test, expect } from "@playwright/test";

const API = "https://api.open-meteo.com/**";
const POS = { latitude: 47.6062, longitude: -122.3321 };
const ok = (temp = 14, code = 2) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ current: { temperature_2m: temp, weather_code: code } }) });
const json = (status, obj) => ({ status, contentType: "application/json", body: JSON.stringify(obj) });
const MSG_DENIED = "Location access was denied.";
const MSG_NOLOC = "We couldn't determine your location.";
const MSG_UNAVAIL = "Weather is unavailable right now.";

/**
 * Prepare a page. geo: "grant" | "deny" | "unavailable" | "timeout" | "unsupported" | "pending"
 * "pending" never answers until window.__answerGeo(kind) is called (models an open prompt).
 * weather: a fulfil object, "abort", or a function (requestNumber) => fulfil object | "abort".
 */
async function setup(browser, { geo = "grant", weather = ok(), viewport, pos = POS } = {}) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  const log = { requests: [], weather: [], console: [], dialogs: [], pageErrors: [], example: [] };
  page.on("request", (r) => { log.requests.push({ url: r.url(), method: r.method() }); });
  page.on("console", (m) => log.console.push(m.text()));
  page.on("dialog", async (d) => { log.dialogs.push(d.message()); await d.dismiss(); });
  page.on("pageerror", (e) => log.pageErrors.push(String(e)));
  await page.route(API, async (route) => {
    const req = route.request();
    if (new URL(req.url()).searchParams.has("daily")) {
      // LIV-15 outlook request: not a current-conditions request; answer with a synthetic valid forecast.
      const days = Array.from({ length: 10 }, (_, i) => `2026-10-${String(20 + i).padStart(2, "0")}`);
      return route.fulfill(json(200, { daily: { time: days, weather_code: days.map(() => 2), temperature_2m_max: days.map(() => 15), temperature_2m_min: days.map(() => 8), precipitation_probability_max: days.map(() => 10) } }));
    }
    log.weather.push({ url: req.url(), headers: await req.allHeaders() });
    const w = typeof weather === "function" ? weather(log.weather.length) : weather;
    if (w === "abort") return route.abort("failed");
    return route.fulfill(w);
  });
  await page.route("https://example.com/**", (route) => { log.example.push(route.request().url()); return route.fulfill({ status: 200, body: "x" }); });
  await page.addInitScript(({ geo, pos }) => {
    window.__geoCalls = 0;
    const answer = (kind, ok_, err) => {
      if (kind === "grant") ok_({ coords: { latitude: pos.latitude, longitude: pos.longitude, accuracy: 10 }, timestamp: Date.now() });
      else err({ code: kind === "deny" ? 1 : kind === "unavailable" ? 2 : 3, message: "x" });
    };
    if (geo === "unsupported") {
      Object.defineProperty(Navigator.prototype, "geolocation", { get() { return undefined; }, configurable: true });
      return;
    }
    const fake = {
      getCurrentPosition(ok_, err) {
        window.__geoCalls++;
        if (geo === "pending") window.__answerGeo = (kind) => answer(kind, ok_, err);
        else setTimeout(() => answer(geo, ok_, err), 0);
      },
      watchPosition() { window.__geoCalls += 1000; return 0; },
      clearWatch() {},
    };
    Object.defineProperty(Navigator.prototype, "geolocation", { get() { return fake; }, configurable: true });
  }, { geo, pos });
  await page.goto("/");
  return { page, context, log };
}

const temp = (p) => p.getByTestId("conditions-temperature");
const text = (p) => p.getByTestId("conditions-text");
const retryBtn = (p) => p.getByTestId("conditions-section").getByRole("button", { name: "Try again" });
const noConditions = async (p) => {
  await expect(p.getByTestId("conditions-current")).toBeHidden();
  await expect(temp(p)).toHaveText("");
  await expect(text(p)).toHaveText("");
};

test("S1 permission prompt requested on load, and no data shown until the user responds", async ({ browser }) => {
  // Limitation: browser permission chrome is not observable from page automation. We assert the page
  // asks (exactly one getCurrentPosition call, no watchPosition) and shows nothing while unanswered.
  const { page, log, context } = await setup(browser, { geo: "pending" });
  await page.waitForLoadState("load");
  await expect.poll(() => page.evaluate(() => window.__geoCalls)).toBe(1);
  await page.waitForTimeout(500);
  await noConditions(page);
  expect(await page.locator("body").innerText()).not.toMatch(/\d\s*°|Partly cloudy|Unknown/);
  expect(log.weather.length).toBe(0);
  await page.evaluate(() => window.__answerGeo("grant"));
  await expect(temp(page)).toHaveText("14°C");
  await context.close();
});

test("S2 permission granted shows current conditions", async ({ browser }) => {
  const { page, context } = await setup(browser);
  await expect(temp(page)).toHaveText("14°C");
  await expect(text(page)).toHaveText("Partly cloudy");
  await context.close();
});

test("S3 permission denied", async ({ browser }) => {
  const { page, log, context } = await setup(browser, { geo: "deny" });
  await expect(page.getByText(MSG_DENIED)).toBeVisible();
  await noConditions(page);
  expect(log.weather.length).toBe(0);
  await context.close();
});

for (const geo of ["unavailable", "timeout"]) {
  test(`S4 position cannot be determined (${geo})`, async ({ browser }) => {
    const { page, log, context } = await setup(browser, { geo });
    await expect(page.getByText(MSG_NOLOC)).toBeVisible();
    await noConditions(page);
    expect(log.weather.length).toBe(0);
    await context.close();
  });
}

test("S5 weather service failure shows message and Try again; retry repeats the request and shows conditions", async ({ browser }) => {
  const { page, log, context } = await setup(browser, { weather: (n) => (n === 1 ? json(500, {}) : ok(14, 2)) });
  await expect(page.getByText(MSG_UNAVAIL)).toBeVisible();
  await expect(retryBtn(page)).toBeVisible();
  await retryBtn(page).click();
  await expect(temp(page)).toHaveText("14°C");
  await expect(text(page)).toHaveText("Partly cloudy");
  expect(log.weather.length).toBe(2);
  await context.close();
});

test("S5 network error also shows message and Try again", async ({ browser }) => {
  const { page, context } = await setup(browser, { weather: "abort" });
  await expect(page.getByText(MSG_UNAVAIL)).toBeVisible();
  await expect(retryBtn(page)).toBeVisible();
  await context.close();
});

test("S6 attribution visible without interaction when conditions are displayed", async ({ browser }) => {
  const { page, context } = await setup(browser);
  await expect(temp(page)).toHaveText("14°C");
  const link = page.getByTestId("conditions-section").getByRole("link", { name: "Open-Meteo.com" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://open-meteo.com/");
  await context.close();
});

test("S7 privacy: coordinates only to the weather service; no cookies or browser storage", async ({ browser }) => {
  const { page, context, log } = await setup(browser);
  await expect(temp(page)).toHaveText("14°C");
  const carrying = log.requests.filter((r) => /47\.6|122\.3/.test(decodeURIComponent(r.url)));
  expect(carrying.length).toBeGreaterThan(0);
  for (const r of carrying) expect(new URL(r.url).host).toBe("api.open-meteo.com");
  expect(await context.cookies()).toEqual([]);
  const stores = await page.evaluate(async () => ({
    cookie: document.cookie,
    local: localStorage.length,
    session: sessionStorage.length,
    idb: (await indexedDB.databases()).length,
    caches: (await caches.keys()).length,
  }));
  expect(stores).toEqual({ cookie: "", local: 0, session: 0, idb: 0, caches: 0 });
  await context.close();
});

test("S8 phone screen 360px: values fully visible, no horizontal scroll", async ({ browser }) => {
  const { page, context } = await setup(browser, { viewport: { width: 360, height: 740 }, weather: ok(-12.4, 2) });
  await expect(temp(page)).toHaveText("-12°C");
  await expect(text(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  for (const el of [temp(page), text(page)]) {
    const b = await el.boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(360);
  }
  await context.close();
});

test("S9 attribution text and link", async ({ browser }) => {
  const { page, context } = await setup(browser);
  await expect(temp(page)).toHaveText("14°C");
  const attr = page.getByTestId("conditions-attribution");
  await expect(attr).toBeVisible();
  await expect(attr).toHaveText(/^Weather data by\s+Open-Meteo\.com$/);
  await expect(attr.getByRole("link")).toHaveAttribute("href", "https://open-meteo.com/");
  await context.close();
});

for (const [reported, shown] of [[13.6, "14°C"], [-0.4, "0°C"]]) {
  test(`S10 temperature rounding ${reported} -> ${shown}`, async ({ browser }) => {
    const { page, context } = await setup(browser, { weather: ok(reported, 2) });
    await expect(temp(page)).toHaveText(shown);
    await context.close();
  });
}

test("S11 unknown condition code reads Unknown and no service text appears", async ({ browser }) => {
  const body = { current: { temperature_2m: 14, weather_code: 12345, note: "ZZ-service-text" }, reason: "ZZ-service-reason" };
  const { page, context } = await setup(browser, { weather: json(200, body) });
  await expect(text(page)).toHaveText("Unknown");
  const all = await page.locator("body").innerText();
  expect(all).not.toContain("ZZ-service");
  expect(all).not.toContain("12345");
  await context.close();
});

test("S12 no geolocation support", async ({ browser }) => {
  const { page, log, context } = await setup(browser, { geo: "unsupported" });
  await expect(page.getByText(MSG_NOLOC)).toBeVisible();
  await noConditions(page);
  expect(log.weather.length).toBe(0);
  await context.close();
});

test("S13 coordinate precision: request carries 47.61 and -122.33", async ({ browser }) => {
  const { page, log, context } = await setup(browser);
  await expect(temp(page)).toHaveText("14°C");
  expect(log.weather.length).toBe(1);
  const u = new URL(log.weather[0].url);
  expect(u.searchParams.get("latitude")).toBe("47.61");
  expect(u.searchParams.get("longitude")).toBe("-122.33");
  await context.close();
});

test("S14 retry is user-driven: no automatic requests; each activation sends exactly one", async ({ browser }) => {
  const { page, log, context } = await setup(browser, { weather: json(500, {}) });
  await expect(retryBtn(page)).toBeVisible();
  await page.waitForTimeout(1500);
  expect(log.weather.length).toBe(1);
  await retryBtn(page).click();
  await expect(retryBtn(page)).toBeVisible();
  await page.waitForTimeout(1000);
  expect(log.weather.length).toBe(2);
  await retryBtn(page).click();
  await expect(retryBtn(page)).toBeVisible();
  await page.waitForTimeout(1000);
  expect(log.weather.length).toBe(3);
  await context.close();
});

test("S15 markup in service data is never rendered", async ({ browser }) => {
  const { page, log, context } = await setup(browser, { weather: json(200, { current: { temperature_2m: "<img src=x onerror=alert(1)>", weather_code: 2 } }) });
  await expect(page.getByText(MSG_UNAVAIL)).toBeVisible();
  await expect(retryBtn(page)).toBeVisible();
  await expect(page.getByTestId("conditions-section").locator("img")).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(log.dialogs).toEqual([]);
  await context.close();
});

test("S16 numeric-looking strings are rejected", async ({ browser }) => {
  const { page, context } = await setup(browser, { weather: json(200, { current: { temperature_2m: "14", weather_code: "2" } }) });
  await expect(page.getByText(MSG_UNAVAIL)).toBeVisible();
  await noConditions(page);
  await context.close();
});

test("S17 service error text is never shown", async ({ browser }) => {
  const { page, context } = await setup(browser, { weather: json(400, { error: true, reason: "Visit evil.example" }) });
  await expect(page.getByText(MSG_UNAVAIL)).toBeVisible();
  await expect(retryBtn(page)).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain("evil.example");
  expect(await page.content()).not.toContain("evil.example");
  await context.close();
});

test("S18 CSP blocks unexpected hosts and inline script", async ({ browser }) => {
  const { page, log, context } = await setup(browser);
  await expect(temp(page)).toHaveText("14°C");
  const result = await page.evaluate(async () => {
    const violations = [];
    document.addEventListener("securitypolicyviolation", (e) => violations.push(e.violatedDirective));
    let fetched = "resolved";
    try { await fetch("https://example.com/"); } catch { fetched = "rejected"; }
    window.__inline = "not-run";
    const s = document.createElement("script");
    s.textContent = "window.__inline = 'ran'";
    document.body.appendChild(s);
    await new Promise((r) => setTimeout(r, 200));
    return { fetched, violations, inline: window.__inline };
  });
  expect(result.fetched).toBe("rejected");
  expect(result.violations.some((v) => v.startsWith("connect-src"))).toBe(true);
  expect(result.violations.some((v) => v.startsWith("script-src"))).toBe(true);
  expect(result.inline).toBe("not-run");
  expect(log.example).toEqual([]);
  expect(log.requests.filter((r) => new URL(r.url).hostname === "example.com")).toEqual([]);
  await context.close();
});

test("S19 weather request carries no Cookie or Referer header", async ({ browser }) => {
  const { page, context, log } = await setup(browser);
  // Pre-seed a cookie for the API host so a credentialed request would carry it.
  await context.addCookies([{ name: "qa", value: "synthetic", domain: "api.open-meteo.com", path: "/", secure: true }]);
  await page.reload();
  await expect(temp(page)).toHaveText("14°C");
  expect(log.weather.length).toBeGreaterThan(0);
  for (const w of log.weather) {
    const names = Object.keys(w.headers).map((h) => h.toLowerCase());
    expect(names).not.toContain("cookie");
    expect(names).not.toContain("referer");
  }
  await context.close();
});

for (const mode of ["success", "failure"]) {
  test(`S20 coordinates are not logged or put in the page address (${mode})`, async ({ browser }) => {
    const { page, log, context } = await setup(browser, { weather: mode === "success" ? ok() : json(500, {}) });
    if (mode === "success") await expect(temp(page)).toHaveText("14°C");
    else await expect(retryBtn(page)).toBeVisible();
    await page.waitForTimeout(300);
    // Browser-generated "Failed to load resource" lines carry no URL in their text; we check the text.
    for (const line of log.console) {
      expect(line).not.toMatch(/47\.6|122\.3|-?\d{1,3}\.\d{2,}/);
      expect(line.includes("open-meteo.com/v1")).toBe(false);
    }
    expect(log.pageErrors).toEqual([]);
    expect(page.url()).not.toMatch(/47\.6|122\.3|latitude|longitude/);
    expect(await page.title()).not.toMatch(/47\.6|122\.3/);
    await context.close();
  });
}
