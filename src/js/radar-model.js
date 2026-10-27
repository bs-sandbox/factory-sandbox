// Radar model (LIV-17, contracts/ui/radar-overlay.md section 1). Pure: no DOM, no network.
export const RADAR_API_URL = "https://api.rainviewer.com/public/weather-maps.json";
export const RADAR_TILE_HOST = "https://tilecache.rainviewer.com";
export const RADAR_ATTRIBUTION = 'Weather data by <a href="https://www.rainviewer.com/">RainViewer</a>';
// 8.64e12 s is the ECMAScript Date range, so time * 1000 is always a valid Date. A constant:
// it never depends on the browser clock (THREAT-MODEL T2a).
export const RADAR_MAX_TIME_S = 8640000000000;

const PATH_RE = /^\/v2\/radar\/[A-Za-z0-9_-]{1,64}$/;

// Returns { time, path } for the radar.past entry with the largest `time`, or null.
// Ignores `host` and every other field. Never throws.
export function parseWeatherMaps(json) {
  try {
    const past = json?.radar?.past;
    if (!Array.isArray(past) || past.length === 0) return null;
    let latest = null;
    for (const e of past) {
      if (e === null || typeof e !== "object") return null;
      if (typeof e.time === "number" && (latest === null || e.time > latest.time)) latest = e;
    }
    if (latest === null) return null;
    const { time, path } = latest;
    if (!Number.isInteger(time) || time < 1 || time > RADAR_MAX_TIME_S) return null;
    if (typeof path !== "string" || !PATH_RE.test(path)) return null;
    return { time, path };
  } catch {
    return null;
  }
}

export function buildRadarTileUrl(path) {
  return `${RADAR_TILE_HOST}${path}/256/{z}/{x}/{y}/2/1_1.png`;
}

export function formatRadarTimestamp(time, timeZone) {
  const text = new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone,
  }).format(time * 1000);
  return `Radar updated ${text}`.replace(/\s/g, " ");
}
