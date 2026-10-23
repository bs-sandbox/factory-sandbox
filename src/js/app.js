// Entry module: wiring only.
import { createCitySearch } from "./city-search.js";
import { createCurrentConditions } from "./current-conditions.js";
import { createDailyOutlook } from "./daily-outlook.js";
import { requestLocation } from "./location-source.js";
import { setLocationAll, startShell } from "./page-shell.js";

const conditions = createCurrentConditions(document.querySelector('[data-testid="conditions-section"]'));
const outlook = createDailyOutlook(document.querySelector('[data-testid="outlook-section"]'));
const consumers = [conditions, outlook];
const citySearch = createCitySearch({
  root: document.querySelector('[data-testid="city-search"]'),
  onPlaceSelected: (place) => setLocationAll(consumers, place.latitude, place.longitude),
});
const onDenied = [() => conditions.showDenied(), () => citySearch.show()];
const onUnavailable = [() => conditions.showLocationUnavailable()];

startShell({ requestLocation, consumers, onDenied, onUnavailable });
