// Pure formatting helpers (contracts/ui/current-conditions.md section 1.1).
export function roundCoordinate(x) {
  const r = Number(x.toFixed(2));
  return Object.is(r, -0) ? 0 : r;
}

export function formatTemperature(celsius) {
  const r = Math.round(celsius);
  return `${Object.is(r, -0) ? 0 : r}°C`;
}
