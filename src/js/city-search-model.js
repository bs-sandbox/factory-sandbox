// Pure model for city search (LIV-14). No DOM, no network. See contracts/ui/city-search.md.
export const MAX_QUERY_LENGTH = 100;
export const MAX_RESULTS = 10;
const MAX_PART_LENGTH = 200;
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
// C0, DEL, C1 and bidi controls.
const CONTROLS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

export function normalizeQuery(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed.length > MAX_QUERY_LENGTH ? trimmed.slice(0, MAX_QUERY_LENGTH) : trimmed;
}

export function buildSearchUrl(query) {
  const url = new URL(GEOCODING_URL);
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(MAX_RESULTS));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  return url.toString();
}

function cleanText(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(CONTROLS, "").trim();
  if (cleaned === "") return null;
  return cleaned.length > MAX_PART_LENGTH ? cleaned.slice(0, MAX_PART_LENGTH) : cleaned;
}

function validCoord(v, limit) {
  return typeof v === "number" && Number.isFinite(v) && v >= -limit && v <= limit;
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseSearchResponse(json) {
  if (!isPlainObject(json) || json.error === true) return { kind: "error" };
  const results = json.results;
  if (results === undefined || results === null) return { kind: "none" };
  if (!Array.isArray(results)) return { kind: "error" };
  if (results.length === 0) return { kind: "none" };
  const places = [];
  for (const entry of results) {
    if (places.length >= MAX_RESULTS) break;
    if (!isPlainObject(entry)) continue;
    const name = cleanText(entry.name);
    const { latitude, longitude } = entry;
    if (name === null || !validCoord(latitude, 90) || !validCoord(longitude, 180)) continue;
    places.push({
      name,
      region: cleanText(entry.admin1),
      country: cleanText(entry.country),
      latitude,
      longitude,
    });
  }
  return places.length === 0 ? { kind: "error" } : { kind: "results", places };
}

export function formatPlaceLabel(place) {
  return [place.name, place.region, place.country].filter((p) => p !== null && p !== undefined).join(", ");
}
