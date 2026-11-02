# 0008. Architecture fitness functions for JS layering (R1-R3)
Status: Proposed
Date: 2026-11-02

Context:
- LIV-50 (Tier 2, tech debt). ADRs 0002, 0004 and 0005 split `src/js/` into pure modules
  (URL building, parsing, formatting; unit-testable in Node) and controller/view modules
  (DOM, network, browser APIs), composed only by the entry module `src/js/app.js`. This is
  a convention today, checked only by review. On main@68aff28 it holds: the pure modules
  (`*-model.js`, `format.js`, `weather-codes.js`) reference no browser global and import
  only each other; view modules import only pure modules; only `app.js` imports views.
- No fitness functions exist (`/architecture/` is absent) and `ci.yml` runs none, so the
  weekly fitness check (Architect charter P5) has nothing to measure.
- Constraints from LIV-50: runs in the existing CI workflow on every PR and blocks merge;
  a new `*-model.js` is covered with no configuration edit; output names the file and the
  rule; QA can show each rule catches a known violation and passes clean code. Rule R4
  (dependency list) is out of scope (LIV-51).
- The repo has one runtime dependency (`leaflet`), no dev dependencies and no bundler.
  `npm test` runs `node --test`. `/.github/workflows/**` is owned by DevOps and Security
  (CODEOWNERS); `/architecture/**` by the Architect.

Decision:
1. A zero-dependency Node checker, `architecture/fitness/check.mjs`, with its layer
   patterns and rule data in `architecture/fitness/rules.mjs`. Its observable behaviour
   (layers, rules, CLI, exit codes, output) is `contracts/ci/architecture-fitness.md`.
2. Layers are assigned by file name, never by a list of files:
   pure = basename `*-model`, `format` or `weather-codes` (`.js`/`.mjs`); entry =
   `src/js/app.js`; view = every other module under `src/js/`. A new file is classified
   on arrival, and an unknown module defaults to the stricter view rules.
3. Detection is lexical. A small tokenizer separates code from comments, string and
   template text (template `${}` expressions are code) and regular-expression literals.
   The rules match tokens, not raw text, so a word in a comment or string never counts.
   A `/` starts a regex literal when the previous code token is absent, a punctuator other
   than `)`, `]` or `}`, or one of the keywords `return typeof instanceof in of new delete
   void throw case do else yield await`; otherwise it is division.
4. The check runs as its own job, `architecture`, in `.github/workflows/ci.yml`. The
   required `ci` job depends on it and fails unless it succeeded, so a failure blocks
   merge with no ruleset change. The wiring is a DevOps Task (workflow ownership).
5. The checker fails closed: any read or tokenizer error, or a tree with no module or no
   pure module, exits 2 and fails the check.

Alternatives:
- ESLint (`no-restricted-globals`, `no-restricted-imports`) or dependency-cruiser: mature,
  but adds a dev-dependency tree to audit and pin, and the R4 dependency-list policy
  (LIV-51) is still open. Rejected for now; revisit if rules outgrow a tokenizer.
- `acorn` for a real AST: more exact, still a new dependency for the same reason.
  Rejected; the tokenizer's limits are listed below and in the contract.
- Plain regex over file text: false positives from comments and strings, and from names
  such as `fetchImpl`. Rejected.
- A hand-kept list of pure files: breaks the "new `*-model.js` is covered" constraint.
- A step inside the `ci` job: blocks merge too, but the failure shows as `ci`, not as a
  named architecture check (LIV-50 S8). Rejected.
- Making `architecture` a separately required check in the ruleset: the check must exist
  on main first or every PR stalls. Not needed given decision 4.

Consequences:
- Easier: layering breaks fail at PR time with file, line and rule; the weekly check can
  count violations by rule.
- Harder: a pure module may not use the names `document`, `window`, `navigator`,
  `localStorage` or `fetch` even as a local variable or object key. Rename instead.
- Known limits (lexical, no scope analysis): access through an alias
  (`const g = globalThis; g.fetch`) is not detected. Review still applies.
- Until the checker exists on main, the `architecture` job passes with a warning
  (transition guard, contract section 4). Removing the checker later needs Architect
  approval under CODEOWNERS.
- Follow-up: R4 in LIV-51. New rules are Tasks under `/architecture/fitness/**`, with QA
  showing each one catches a known violation and passes clean code.

Related: LIV-50, LIV-51; ADRs 0002, 0004, 0005; contracts/ci/architecture-fitness.md.
