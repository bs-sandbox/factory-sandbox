// Acceptance helpers for LIV-17. Written from the AC and contracts/ui/radar-overlay.md only.
export const BASE_URL = process.env.RADAR_BASE_URL ?? "http://localhost:4173/";
export const API = "https://api.rainviewer.com/public/weather-maps.json";
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
export const isRv = (u) => /^https:\/\/(api|tilecache)\.rainviewer\.com\//.test(u);

export function payload({ host = "https://tilecache.rainviewer.com", latest } = {}) {
  return {
    version: "2.0",
    generated: 1792530700,
    host,
    radar: {
      past: [
        { time: 1792530000, path: "/v2/radar/aaa111" },
        latest ?? { time: 1792530600, path: "/v2/radar/bbb222" },
      ],
      nowcast: [],
    },
  };
}

// Sets up routes and request recording. mode: "json" | "500" | "abort" | "tile-abort"
export async function setup(page, { body = payload(), mode = "json" } = {}) {
  const rv = [];
  const tiles = [];
  const all = [];
  page.on("request", (r) => {
    all.push(r);
    if (isRv(r.url())) rv.push(r);
    if (r.url().startsWith("https://tilecache.rainviewer.com/")) tiles.push(r);
  });
  await page.route(API, (route) => {
    if (mode === "abort") return route.abort();
    if (mode === "500") return route.fulfill({ status: 500, body: "err" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(body),
    });
  });
  await page.route("https://tilecache.rainviewer.com/**", (route) =>
    mode === "tile-abort"
      ? route.abort()
      : route.fulfill({
          status: 200,
          contentType: "image/png",
          headers: { "access-control-allow-origin": "*" },
          body: PNG,
        }),
  );
  await page.route("https://attacker.example/**", (route) => route.fulfill({ status: 200, body: "x" }));
  await page.goto(BASE_URL);
  await page.locator('[data-testid="map"]').waitFor();
  return { rv, tiles, all };
}

export const toggle = (page) => page.locator('[data-testid="radar-toggle"]');
export const stamp = (page) => page.locator('[data-testid="radar-timestamp"]');
export const unavailable = (page) => page.locator('[data-testid="radar-unavailable"]');
export const overlayTiles = (page) =>
  page.locator('[data-testid="map"] img.leaflet-tile[src^="https://tilecache.rainviewer.com/v2/radar/"]');
export const attribution = (page) => page.locator('[data-testid="map-attribution"]');
