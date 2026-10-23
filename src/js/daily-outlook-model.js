// Pure model for the 10-day outlook (contracts/ui/daily-outlook.md section 1a). No DOM, no network.
import { conditionLabel } from "./weather-codes.js";
import { roundCoordinate, formatTemperature } from "./format.js";

export { formatTemperature };

export const OUTLOOK_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const MAX_DAYS = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function buildOutlookUrl(endpoint, lat, lon) {
  const query = new URLSearchParams({
    latitude: String(roundCoordinate(lat)),
    longitude: String(roundCoordinate(lon)),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: String(MAX_DAYS),
  });
  return `${endpoint}?${query.toString().replaceAll("%2C", ",")}`;
}

export function formatPrecipitation(percent) {
  return `${Math.min(100, Math.max(0, Math.round(percent)))}%`;
}

function validDate(iso) {
  if (typeof iso !== "string" || !DATE_RE.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

// Weekday and date come from the ISO date itself (UTC arithmetic), so the device time zone is irrelevant.
export function formatDayLabel(isoDate) {
  const date = validDate(isoDate);
  if (!date) throw new RangeError("invalid date");
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function parseDailyOutlook(json) {
  try {
    const daily = json?.daily;
    if (!daily || typeof daily !== "object") return null;
    const {
      time,
      weather_code: codes,
      temperature_2m_max: highs,
      temperature_2m_min: lows,
      precipitation_probability_max: precip,
    } = daily;
    if (![time, codes, highs, lows, precip].every(Array.isArray)) return null;
    const days = [];
    const count = Math.min(time.length, MAX_DAYS);
    for (let i = 0; i < count; i++) {
      const complete =
        validDate(time[i]) && isNum(codes[i]) && isNum(highs[i]) && isNum(lows[i]) && isNum(precip[i]);
      if (!complete) break;
      days.push({
        date: time[i],
        label: formatDayLabel(time[i]),
        high: formatTemperature(highs[i]),
        low: formatTemperature(lows[i]),
        conditions: conditionLabel(codes[i]),
        precipitation: formatPrecipitation(precip[i]),
      });
    }
    return days.length > 0 ? days : null;
  } catch {
    return null;
  }
}
