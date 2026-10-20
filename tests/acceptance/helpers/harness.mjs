// Acceptance-test harness for LIV-16 (written from the AC and contracts only).
// Requires: `playwright` (chromium) installed in the QA environment, and `npm run build` done (dist/).
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

export const SEATTLE = { latitude: 47.6062, longitude: -122.3321 };
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
export const TILE_RE = /^https:\/\/tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)\.png$/;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png" };

export function serveDist(dist = join(process.cwd(), "dist")) {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
      let f = join(dist, p === "" ? "index.html" : p);
      if (!f.startsWith(dist)) { res.writeHead(403); return res.end(); }
      if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
      if (!existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream" });
      res.end(readFileSync(f));
    });
    srv.listen(0, "127.0.0.1", () => resolve({
      origin: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close(),
    }));
  });
}

const FORECAST = {
  current: { temperature_2m: 14.0, weather_code: 2 },
  daily: { time: ["2026-10-20"], temperature_2m_max: [18], temperature_2m_min: [9], weather_code: [61], precipitation_probability_max: [70] },
};

// Opens the page with stubbed external services. Records every request.
export async function openPage(t, { geolocation = SEATTLE, deny = false, tiles = "ok", places = {}, viewport, hasTouch, cookies } = {}) {
  const server = await serveDist();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: viewport ?? { width: 1024, height: 800 }, hasTouch,
    permissions: deny ? [] : ["geolocation"], geolocation: deny ? undefined : geolocation,
  });
  t.after(async () => { await browser.close(); server.close(); });
  if (cookies) await context.addCookies(cookies);
  const page = await context.newPage();
  const log = { tiles: [], requests: [], consoleText: [] };
  page.on("console", (m) => log.consoleText.push(m.text()));
  page.on("request", (r) => log.requests.push({ url: r.url(), headers: r.headers() }));
  await context.route("https://tile.openstreetmap.org/**", async (route) => {
    const m = TILE_RE.exec(route.request().url());
    log.tiles.push({
      url: route.request().url(), z: m ? +m[1] : null, x: m ? +m[2] : null, y: m ? +m[3] : null,
      headers: await route.request().allHeaders(),
    });
    if (tiles === "fail") return route.abort();
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG, headers: { "access-control-allow-origin": "*" } });
  });
  await context.route("https://api.open-meteo.com/**", (r) => r.fulfill({
    status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(FORECAST),
  }));
  await context.route("https://geocoding-api.open-meteo.com/**", (r) => {
    const q = (new URL(r.request().url()).searchParams.get("name") ?? "").toLowerCase();
    const results = places[q] ?? [];
    return r.fulfill({
      status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(results.length ? { results } : {}),
    });
  });
  await page.goto(server.origin + "/");
  return { page, context, log, origin: server.origin };
}

export const place = (name, latitude, longitude) => ({ name, latitude, longitude, admin1: "X", country: "Y" });

export async function searchAndPick(page, query) {
  await page.getByRole("textbox", { name: "City name" }).fill(query);
  await page.getByRole("button", { name: "Search" }).click();
  await page.locator('[data-testid="city-search-result-button"]').first().click();
}

export function tileFor(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x, y };
}

export const settle = (page) => page.waitForTimeout(1500);
export const maxZ = (tiles, from = 0) => Math.max(...tiles.slice(from).map((t) => t.z));

export async function markerOffsetFromCentre(page) {
  const map = await page.locator('[data-testid="map"]').boundingBox();
  const mk = await page.locator('[data-testid="map-marker"]').boundingBox();
  // Leaflet's default icon anchor is bottom-centre of the icon.
  return { dx: mk.x + mk.width / 2 - (map.x + map.width / 2), dy: mk.y + mk.height - (map.y + map.height / 2) };
}

export async function dragMap(page, dx, dy) {
  const b = await page.locator('[data-testid="map"]').boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
  await page.mouse.up();
}
