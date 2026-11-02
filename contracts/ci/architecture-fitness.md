# CI contract: architecture fitness check (LIV-50)

Status: Proposed (ADR 0008). The Developer, DevOps and QA target this contract. Adding a
rule, a pure-module pattern or a forbidden name is backward compatible only if `main` still
passes. Renaming the check, a rule ID, the exit codes or the output line format is breaking.

## 1. Modules and layers

A module is every file ending `.js` or `.mjs` under `<root>/src/js/` (recursive).
Paths in output are root-relative with `/` separators, e.g. `src/js/format.js`.

| Layer | Rule | Today (main@68aff28) |
|---|---|---|
| pure | basename without extension ends with `-model`, or is `format` or `weather-codes` | `city-search-model.js`, `current-conditions-model.js`, `daily-outlook-model.js`, `format.js`, `weather-codes.js` |
| entry | exactly `src/js/app.js` | `app.js` |
| view | every other module | `city-search.js`, `current-conditions.js`, `daily-outlook.js`, `location-map.js`, `location-source.js`, `page-shell.js` |

Layers come only from these name patterns. No file list exists, so a new
`src/js/example-model.js` is pure with no configuration edit (S7).

## 2. Rules

Code means tokens outside comments, outside string literals, outside the text parts of
template literals (`${...}` is code) and outside regular-expression literals.

- **R1** (pure modules only). Fails for each code identifier `document`, `window`,
  `navigator`, `localStorage` or `fetch`, except a property name after `.` or `?.` whose
  object is not `globalThis` or `self`. So `fetch(`, `globalThis.fetch`, `self.navigator`,
  `window`, `const document = 1` and `{ fetch: f }` fail; `x.fetch`, `opts?.document`,
  `fetchImpl` and `// document` pass. `globalThis[` and `self[` (computed access) also
  fail R1, reported with the name `globalThis` or `self`.
- **R2** (pure modules only). Fails for each import of a non-pure module (view or entry).
  Also fails for a dynamic `import(` whose argument is not a single string literal.
- **R3** (view modules only). Fails for each import of another view module or of the entry.
  `src/js/app.js` may import anything. A view may import any pure module (S6).

Imports are `import ... from "<s>"`, `import "<s>"`, `export ... from "<s>"` and
`import("<s>")`. Only specifiers starting `./` or `../` are resolved, relative to the
importing file. A target outside `src/js/`, or a bare specifier such as `leaflet`, is out
of scope for R2/R3 (see LIV-51). A target is classified by its path even if the file is
missing. A non-literal dynamic `import(` in a view or entry module is not checked.

## 3. CLI

`node architecture/fitness/check.mjs [--root <dir>]` (default root: current directory).
Also `npm run fitness`. No dependencies; Node >= 24. Reads files only; writes nothing.

| Exit | Meaning |
|---|---|
| 0 | no violation |
| 1 | one or more violations |
| 2 | checker error: unknown argument, root or `src/js/` unreadable, no module, no pure module, unreadable file, or a tokenizer error (unterminated comment, string, template or regex). Fails closed. |

Stdout, one line per violation, sorted by path, then line, then rule:

    ::error file=<path>,line=<line>,title=fitness <rule>::<rule> <path>:<line> <message>

Messages:
- R1: `pure module references browser global '<name>'`
- R2: `pure module imports non-pure module '<target path>'`, or
  `pure module uses a non-literal dynamic import`
- R3: `view module imports '<target path>' (only src/js/app.js may import view modules)`

A checker error prints `::error title=fitness::<reason>`. The last line is always
`fitness: <n> violation(s); <m> module(s): <p> pure, <v> view, <e> entry`, or
`fitness: error` on exit 2.

## 4. CI check

- Job `architecture` (check run name `architecture`) in `.github/workflows/ci.yml`, on the
  workflow's events (`pull_request`, `merge_group`). No job-level `if:`, no
  `continue-on-error`, `timeout-minutes: 5`, `permissions: contents: read`, checkout with
  `persist-credentials: false`, Node 24 via the pinned `actions/setup-node`. No `npm ci`.
  It runs `node architecture/fitness/check.mjs`; its exit code is the job's conclusion.
  No `${{ }}` expression is interpolated in a `run:` block.
- Transition guard: if `architecture/fitness/check.mjs` does not exist, the job prints
  `::warning title=architecture::fitness checker not present` and succeeds.
- The required `ci` job gets `needs: architecture` and `if: ${{ !cancelled() }}`, and its
  first step fails unless `needs.architecture.result` is `success` (passed through
  `env:`). A failed or skipped `architecture` therefore makes `ci` fail and the PR
  unmergeable (S8). No ruleset change is needed.
- Unit tests for the checker are `architecture/fitness/*.test.mjs` and run under `npm test`.
  Fixture trees live in `architecture/fitness/fixtures/<case>/src/js/`, never under a
  directory named `test`, and are never imported by `src/`.
