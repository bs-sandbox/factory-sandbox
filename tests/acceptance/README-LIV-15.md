# LIV-15 acceptance tests

`LIV-15-daily-outlook-model.test.mjs` covers the pure-model scenarios (S1-S5, S10-S12, parts of S6, S13, S15-S17)
from contracts/ui/daily-outlook.md sections 1a, 3, 4. Run: `node --test tests/acceptance`.

Browser-level scenarios (S6 UI, S7, S8, S9, S13 cookies/storage, S14, S18, S19, S15 DOM) need a real browser and
network stubbing; no browser or DOM dependency exists in the repo. They are run as scripted browser checks against
the preview at In QA (P3) and recorded in Test Evidence.
