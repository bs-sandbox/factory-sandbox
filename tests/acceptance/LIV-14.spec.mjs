// End-to-end acceptance test for LIV-14 S3. Written from the AC and the contracts only.
// Synthetic data only; geocoding and weather requests are stubbed.
import { test, expect } from "@playwright/test";

const GEO = "https://geocoding-api.open-meteo.com/**";
const WEATHER = "https://api.open-meteo.com/**";
const json = (obj) => ({ status: 200, contentType: "application/json", body: JSON.stringify(obj) });

const SPRINGFIELD = {
  results: [
    { name: "Springfield", admin1: "Illinois", country: "United States", latitude: 39.80172, longitude: -89.64371 },
    { name: "Springfield", admin1: "Missouri", country: "United States", latitude: 37.21533, longitude: -93.29824 },
  ],
};

test("S3 selecting the first entry shows temperature and conditions in the current-conditions format", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const geoRequests = [];
  const weatherRequests = [];
  await page.route(GEO, (route) => { geoRequests.push(route.request().url()); return route.fulfill(json(SPRINGFIELD)); });
  await page.route(WEATHER, (route) => {
    weatherRequests.push(route.request().url());
    return route.fulfill(json({ current: { temperature_2m: 21.4, weather_code: 3 } }));
  });
  await page.addInitScript(() => {
    const fake = {
      getCurrentPosition(_ok, err) { setTimeout(() => err({ code: 1, message: "denied" }), 0); },
      watchPosition() { return 0; },
      clearWatch() {},
    };
    Object.defineProperty(Navigator.prototype, "geolocation", { get() { return fake; }, configurable: true });
  });
  await page.goto("/");

  // Given the results list for "Springfield" is shown
  await expect(page.getByText("Location access was denied.")).toBeVisible();
  await page.getByRole("textbox", { name: "City name" }).fill("Springfield");
  await page.getByRole("button", { name: "Search" }).click();
  const results = page.getByTestId("city-search-result-button");
  await expect(results).toHaveCount(2);
  expect(weatherRequests.length).toBe(0);

  // When the user selects the first entry
  await results.first().click();

  // Then the current temperature and conditions for that place are shown, in the LIV-13 format
  await expect(page.getByTestId("conditions-temperature")).toHaveText("21°C");
  await expect(page.getByTestId("conditions-text")).toHaveText("Overcast");
  await expect(page.getByTestId("conditions-current")).toBeVisible();
  await expect(page.getByText("Location access was denied.")).toBeHidden();

  // and they are for the first entry's place
  expect(weatherRequests.length).toBe(1);
  const u = new URL(weatherRequests[0]);
  expect(u.searchParams.get("latitude")).toBe("39.8");
  expect(u.searchParams.get("longitude")).toBe("-89.64");
  await context.close();
});
