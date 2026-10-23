// Wrapper over the browser Geolocation API. Never rejects, never logs.
export function requestLocation(
  geolocation = globalThis.navigator?.geolocation,
  { timeoutMs = 10000 } = {},
) {
  return new Promise((resolve) => {
    const unavailable = () => resolve({ kind: "unavailable" });
    if (!geolocation || typeof geolocation.getCurrentPosition !== "function") {
      unavailable();
      return;
    }
    const onSuccess = (pos) => {
      const lat = pos?.coords?.latitude;
      const lon = pos?.coords?.longitude;
      if (
        typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
        typeof lon === "number" && Number.isFinite(lon) && lon >= -180 && lon <= 180
      ) {
        resolve({ kind: "position", latitude: lat, longitude: lon });
      } else {
        unavailable();
      }
    };
    const onError = (err) => {
      if (err && err.code === 1) resolve({ kind: "denied" });
      else unavailable();
    };
    try {
      geolocation.getCurrentPosition(onSuccess, onError, {
        enableHighAccuracy: false,
        timeout: timeoutMs,
        maximumAge: 0,
      });
    } catch {
      unavailable();
    }
  });
}
