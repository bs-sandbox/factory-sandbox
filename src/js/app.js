// Entry module: wiring only.
import { createCurrentConditions } from "./current-conditions.js";
import { requestLocation } from "./location-source.js";
import { startShell } from "./page-shell.js";

const conditions = createCurrentConditions(document.querySelector('[data-testid="conditions-section"]'));
const consumers = [conditions];
const onDenied = [() => conditions.showDenied()];
const onUnavailable = [() => conditions.showLocationUnavailable()];

startShell({ requestLocation, consumers, onDenied, onUnavailable });
