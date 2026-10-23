// Composition logic: routes the location result to feature consumers.
function safeCall(fn) {
  try {
    fn();
  } catch {
    // One failing feature must not affect the others. Nothing is logged.
  }
}

export function setLocationAll(consumers, lat, lon) {
  for (const consumer of consumers) safeCall(() => consumer.setLocation(lat, lon));
}

export async function startShell({ requestLocation, consumers, onDenied = [], onUnavailable = [] }) {
  let result;
  try {
    result = await requestLocation();
  } catch {
    result = { kind: "unavailable" };
  }
  try {
    if (result?.kind === "position") {
      setLocationAll(consumers, result.latitude, result.longitude);
    } else if (result?.kind === "denied") {
      for (const fn of onDenied) safeCall(fn);
    } else {
      for (const fn of onUnavailable) safeCall(fn);
    }
  } catch {
    // never rejects
  }
}
