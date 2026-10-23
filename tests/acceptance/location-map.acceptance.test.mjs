// LIV-16 acceptance tests. One or more tests per AC scenario; names carry the scenario ID.
import assert from "node:assert/strict";
import { test } from "node:test";
import { openPage, place, searchAndPick, tileFor, settle, maxZ, markerOffsetFromCentre, dragMap, SEATTLE, TILE_RE } from "./helpers/harness.mjs";

const PORTLAND = place("Portland", 45.5152, -122.6784);
const places = { portland: [PORTLAND], seattle: [place("Seattle", SEATTLE.latitude, SEATTLE.longitude)] };
const map = (p) => p.locator('[data-testid="map"]');
const near = (v, tol = 4) => Math.abs(v) <= tol;

test("S1_map_centred_with_marker", async (t) => {
  const { page, log } = await openPage(t);
  await map(page).waitFor({ state: "visible" });
  await page.locator('[data-testid="map-marker"]').waitFor({ state: "visible" });
  await settle(page);
  const o = await markerOffsetFromCentre(page);
  assert.ok(near(o.dx) && near(o.dy), `marker not at map centre: ${JSON.stringify(o)}`);
  const c = tileFor(SEATTLE.latitude, SEATTLE.longitude, 15);
  assert.ok(log.tiles.some((x) => x.z === 15 && x.x === c.x && x.y === c.y), "centre tile for the position was not requested");
});

test("S1_street_names_visible_at_default_zoom_is_zoom_15", async (t) => {
  // Street names come from the OSM style at z15 (DR1). Visual check on real tiles is an exploratory charter.
  const { page, log } = await openPage(t);
  await settle(page);
  assert.equal(maxZ(log.tiles), 15);
});

test("S2_pan_by_drag_changes_visible_area", async (t) => {
  const { page } = await openPage(t);
  await settle(page);
  const before = await markerOffsetFromCentre(page);
  await dragMap(page, 120, 60);
  const after = await markerOffsetFromCentre(page);
  assert.ok(Math.abs(after.dx - before.dx) > 50 && Math.abs(after.dy - before.dy) > 20, "visible area did not change after drag");
});

test("S2_zoom_in_and_out_controls", async (t) => {
  const { page, log } = await openPage(t);
  await settle(page);
  const n0 = log.tiles.length;
  await page.getByRole("button", { name: "Zoom in" }).click();
  await settle(page);
  assert.equal(maxZ(log.tiles, n0), 16);
  const n1 = log.tiles.length;
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await settle(page);
  assert.ok(log.tiles.slice(n1).some((x) => x.z === 14), "zoom-out did not request z14 tiles");
});

test("S3_recentre_after_pan_keeps_zoom", async (t) => {
  const { page, log } = await openPage(t);
  await settle(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await settle(page);
  await dragMap(page, 150, 100);
  const away = await markerOffsetFromCentre(page);
  assert.ok(!near(away.dx, 20), "precondition: map should be panned away");
  const n = log.tiles.length;
  await page.getByRole("button", { name: "Recentre" }).click();
  await page.waitForTimeout(1000);
  const o = await markerOffsetFromCentre(page);
  assert.ok(near(o.dx) && near(o.dy), `marker not recentred: ${JSON.stringify(o)}`);
  await settle(page);
  assert.ok(log.tiles.slice(n).every((x) => x.z === 16), "Recentre must keep zoom 16, not reset to 15");
});

test("S4_location_changes_via_city_search", async (t) => {
  // City search is shown when geolocation is denied (LIV-14), so reach the map via search both times.
  const { page, log } = await openPage(t, { deny: true, places });
  await searchAndPick(page, "seattle");
  await map(page).waitFor({ state: "visible" });
  await settle(page);
  const n = log.tiles.length;
  await searchAndPick(page, "portland");
  await settle(page);
  const o = await markerOffsetFromCentre(page);
  assert.ok(near(o.dx) && near(o.dy), `marker not at centre: ${JSON.stringify(o)}`);
  const c = tileFor(PORTLAND.latitude, PORTLAND.longitude, 15);
  assert.ok(log.tiles.slice(n).some((x) => x.z === 15 && x.x === c.x && x.y === c.y), "new place's centre tile not requested");
});

test("S5_attribution_visible_without_interaction", async (t) => {
  const { page } = await openPage(t);
  const a = page.locator('[data-testid="map-attribution"]');
  await a.waitFor({ state: "visible" });
  assert.match(await a.innerText(), /© OpenStreetMap contributors/);
  assert.equal(await a.locator('a[href="https://www.openstreetmap.org/copyright"]').isVisible(), true);
});

test("S6_tile_service_failure_shows_message_and_keeps_conditions", async (t) => {
  const { page } = await openPage(t, { tiles: "fail" });
  const m = page.locator('[data-testid="map-unavailable"]');
  await m.waitFor({ state: "visible", timeout: 20000 });
  assert.equal((await m.innerText()).trim(), "Map is unavailable right now.");
  assert.equal(await map(page).isVisible(), false);
  assert.equal(await page.locator('[data-testid="conditions-current"]').isVisible(), true);
  assert.equal(await page.locator('[data-testid="outlook-list"]').isVisible(), true);
});

test("S7_privacy_requests_and_storage", async (t) => {
  const { page, context, log, origin } = await openPage(t);
  await settle(page);
  for (const r of log.requests) {
    const u = r.url;
    if (u.startsWith(origin) || u.startsWith("data:") || u.startsWith("blob:")) continue;
    if (u.startsWith("https://tile.openstreetmap.org/")) { assert.match(u, TILE_RE); continue; }
    assert.ok(/^https:\/\/(api|geocoding-api)\.open-meteo\.com\//.test(u), `unexpected request ${u}`);
  }
  for (const r of log.requests.filter((x) => x.url.includes("tile.openstreetmap.org"))) {
    assert.ok(!/47\.6|122\.3/.test(r.url), "tile URL contains raw coordinates");
  }
  assert.deepEqual(await context.cookies(), []);
  const s = await page.evaluate(async () => ({
    l: localStorage.length, s: sessionStorage.length, db: (await indexedDB.databases?.())?.length ?? 0, cookie: document.cookie,
  }));
  assert.deepEqual(s, { l: 0, s: 0, db: 0, cookie: "" });
});

test("S8_phone_360_layout", async (t) => {
  const { page } = await openPage(t, { viewport: { width: 360, height: 640 }, hasTouch: true });
  await map(page).waitFor({ state: "visible" });
  await settle(page);
  const sec = await page.locator('[data-testid="map-section"]').boundingBox();
  const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw.sw <= sw.cw, `horizontal scroll: ${JSON.stringify(sw)}`);
  const content = await page.evaluate(() => (document.querySelector("main") ?? document.body).getBoundingClientRect().width);
  assert.ok(Math.abs(sec.width - content) <= 1, `map section ${sec.width} is not the content width ${content}`);
  for (const n of ["Zoom in", "Zoom out", "Recentre"]) {
    assert.equal(await page.getByRole("button", { name: n }).isVisible(), true, n);
  }
  const y0 = await page.evaluate(() => scrollY);
  await page.mouse.move(180, 300);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  assert.ok((await page.evaluate(() => scrollY)) > y0, "page did not scroll past the map");
});

test("S9_default_zoom_on_first_display", async (t) => {
  const { page, log } = await openPage(t);
  await settle(page);
  assert.ok(log.tiles.length > 0);
  assert.equal(Math.min(...log.tiles.map((x) => x.z)), 15);
  assert.equal(maxZ(log.tiles), 15);
});

test("S10_default_zoom_after_place_change", async (t) => {
  const { page, log } = await openPage(t, { deny: true, places });
  await searchAndPick(page, "seattle");
  await settle(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await settle(page);
  assert.equal(maxZ(log.tiles), 17, "precondition: map at z17");
  const n = log.tiles.length;
  await searchAndPick(page, "portland");
  await settle(page);
  const after = log.tiles.slice(n);
  const c = tileFor(PORTLAND.latitude, PORTLAND.longitude, 15);
  assert.ok(after.every((x) => x.z === 15), "tiles after place change must all be z15");
  assert.ok(after.some((x) => x.x === c.x && x.y === c.y));
});

test("S11_coordinates_never_in_page_url", async (t) => {
  const { page } = await openPage(t, { deny: true, places });
  const load = page.url();
  await searchAndPick(page, "seattle");
  await settle(page);
  await searchAndPick(page, "portland");
  await settle(page);
  assert.equal(page.url(), load);
});

test("S11_url_unchanged_with_geolocation", async (t) => {
  const { page } = await openPage(t);
  const load = page.url();
  await settle(page);
  assert.equal(page.url(), load);
});

test("S12_csp_img_src_exact_and_image_hosts", async (t) => {
  const { page, origin } = await openPage(t);
  await settle(page);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  const dirs = Object.fromEntries(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const [k, ...v] = d.split(/\s+/);
    return [k, v.join(" ")];
  }));
  assert.equal(dirs["img-src"], "'self' https://tile.openstreetmap.org");
  assert.equal(dirs["default-src"], "'none'");
  assert.equal(dirs["script-src"], "'self'");
  assert.equal(dirs["style-src"], "'self'");
  assert.equal(dirs["base-uri"], "'none'");
  assert.equal(dirs["form-action"], "'none'");
  assert.equal(dirs["object-src"], "'none'");
  assert.ok(dirs["connect-src"].split(" ").every((h) => h.startsWith("https://")), "connect-src has a non-https source");
  const imgs = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.initiatorType === "img").map((e) => e.name));
  for (const u of imgs) {
    assert.ok(u.startsWith(origin + "/") || u.startsWith("https://tile.openstreetmap.org/"), `image from ${u}`);
  }
});

test("S13_tile_requests_no_cookie_and_origin_only_referer", async (t) => {
  const cookies = [{ name: "probe", value: "1", domain: "tile.openstreetmap.org", path: "/", secure: true, sameSite: "None" }];
  const { page, log, origin } = await openPage(t, { cookies });
  await settle(page);
  assert.ok(log.tiles.length > 0);
  for (const r of log.tiles) {
    assert.equal(r.headers["cookie"], undefined, `Cookie sent on ${r.url}`);
    if (r.headers["referer"] !== undefined) assert.equal(r.headers["referer"], origin + "/");
  }
});

test("S14_invalid_coordinates_ignored", async (t) => {
  const all = {
    seattle: places.seattle,
    badlat: [place("Bad lat", 91, 10)],
    badlon: [place("Bad lon", 10, -181)],
    badtype: [{ name: "Bad type", latitude: "abc", longitude: 10, admin1: "X", country: "Y" }],
  };
  const { page, log } = await openPage(t, { deny: true, places: all });
  await searchAndPick(page, "seattle");
  await settle(page);
  for (const q of ["badlat", "badlon", "badtype"]) {
    const n = log.tiles.length;
    await searchAndPick(page, q);
    await settle(page);
    assert.equal(log.tiles.length, n, `${q}: a tile request was made`);
    const o = await markerOffsetFromCentre(page);
    assert.ok(near(o.dx) && near(o.dy), `${q}: marker moved ${JSON.stringify(o)}`);
    assert.equal(await map(page).isVisible(), true);
  }
});
