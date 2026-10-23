// Entry module: wiring only.
import { createCurrentConditions } from "./current-conditions.js";
import { createDailyOutlook } from "./daily-outlook.js";
import { requestLocation } from "./location-source.js";
import { startShell } from "./page-shell.js";

const conditions = createCurrentConditions(document.querySelector('[data-testid="conditions-section"]'));
const outlook = createDailyOutlook(document.querySelector('[data-testid="outlook-section"]'));
const consumers = [conditions, outlook];
const onDenied = [() => conditions.showDenied()];
const onUnavailable = [() => conditions.showLocationUnavailable()];

startShell({ requestLocation, consumers, onDenied, onUnavailable });
