// Pure model: URL building and strict response validation. No DOM, no network.
import { roundCoordinate, formatTemperature } from "./format.js";
import { conditionLabel } from "./weather-codes.js";

export const CONDITIONS_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

export function buildConditionsUrl(lat, lon, endpoint = CONDITIONS_ENDPOINT) {
  const url = new URL(endpoint);
  url.searchParams.set("latitude", String(roundCoordinate(lat)));
  url.searchParams.set("longitude", String(roundCoordinate(lon)));
  url.searchParams.set("current", "temperature_2m,weather_code");
  return url.toString();
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Plausible range guard (Security non-blocking recommendation a).
const MIN_C = -100;
const MAX_C = 100;

export function parseCurrentConditions(json) {
  if (!isPlainObject(json) || json.error === true) return null;
  const current = json.current;
  if (!isPlainObject(current)) return null;
  const t = current.temperature_2m;
  const c = current.weather_code;
  if (typeof t !== "number" || !Number.isFinite(t) || t < MIN_C || t > MAX_C) return null;
  if (typeof c !== "number" || !Number.isInteger(c)) return null;
  return { temperature: formatTemperature(t), conditions: conditionLabel(c) };
}
