# 0006. SAST (CodeQL) and secret scanning (Gitleaks + GitHub secret scanning) on every PR
Status: Proposed
Date: 2026-10-20

Context:
- LIV-34. Security Review of LIV-13 (PR #10, head 614c995) found that SCA (`npm audit` in
  `.github/workflows/ci.yml`) exists, but code scanning returns "no analysis found" and
  secret scanning is disabled. Security needs scanner evidence it can cite, tied to the
  exact PR head commit SHA and readable through the repository API.
- `bs-sandbox/factory-sandbox` is a public repository (observed 2026-10-20:
  `GET /repos/bs-sandbox/factory-sandbox` returned `"private": false`). On public
  repositories GitHub code scanning (CodeQL), secret scanning and push protection are
  available without a paid licence. Turning them on is a repository setting that needs an
  admin.
- Merges reach `main` only through the merge queue. A required check that never reports on
  `merge_group` stalls the queue (see the header of `ci.yml`).
- On `pull_request` events the workflow and the scripts it runs come from the PR itself,
  so a PR can change its own scanner. CODEOWNERS puts `/.github/workflows/**` and `/.ci/**`
  under DevOps + Security, and `/security/**` under Security + the human Security Owner.
  The `factory/ownership-gate` check enforces owner + second approver.
- Gitleaks' default rule `aws-access-token` (regex
  `(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}`, entropy >= 3) has an allowlist
  `.+EXAMPLE$`. The AWS documentation value `AKIAIOSFODNN7EXAMPLE` therefore does NOT
  trigger it (observed in `gitleaks/gitleaks` `config/gitleaks.toml` on master,
  2026-10-20). See the fixture rules in `contracts/ci/security-scans.md` §4.
- Out of scope: DAST and preview environments, the existing SCA step, other repositories,
  and history that has already been merged.

Decision:
1. Workflow. A new workflow `.github/workflows/security-scan.yml` runs on `pull_request`
   (default types: opened, synchronize, reopened) and `merge_group`.
   - It has two jobs, and their names are the check names: `sast` and `secret-scan`.
   - Top-level permissions are `contents: read`. Only `sast` adds
     `security-events: write` and `actions: read`.
   - Concurrency group:
     `security-scan-${{ github.event.pull_request.number || github.ref }}`, with
     `cancel-in-progress: true`.
   - Both jobs check out with `persist-credentials: false`.
   - Actions are pinned to a full commit SHA with the release named in a comment, as in
     `ci.yml`.
2. SAST is CodeQL (`github/codeql-action` v4, `init` + `analyze`) using advanced setup.
   - Languages are `javascript-typescript` and `actions` (workflow injection), run in one
     job with `build-mode: none`.
   - Query suite: `security-extended`.
   - Config file: `./security/codeql/codeql-config.yml`, the only SAST configuration.
     Nothing under `.github/codeql/` and no other `config` or `queries` input is used.
   - Head attribution. On `pull_request` the job checks out
     `github.event.pull_request.head.sha` and passes `analyze` the inputs
     `sha: <head sha>` and `ref: refs/pull/<number>/head`. The analysis is then recorded
     against the head SHA (S1), not against GitHub's synthetic merge commit. On
     `merge_group` the defaults are used (`github.sha` and `github.ref` of the merge
     group).
   - `analyze` is called with `upload: always` and `output: <runner temp>/sarif`. The
     code-scanning upload makes findings readable by Security, with file and line (S5),
     via `GET /repos/{owner}/{repo}/code-scanning/analyses?sha=<sha>` and
     `.../code-scanning/alerts?ref=<ref>`.
   - The job's conclusion is decided by the SARIF gate (decision 4), not by GitHub's
     separate "CodeQL" code-scanning check run.
   - GitHub "default setup" for code scanning must be off. Advanced-setup uploads are
     rejected while it is on.
3. Secret scanning in CI uses the Gitleaks CLI. It does not use `gitleaks-action`, which
   needs a paid licence for organisation accounts.
   - Install: download the release tarball `gitleaks_<version>_linux_x64.tar.gz` and check
     its SHA-256 against a value pinned in the workflow. If the checksum does not match,
     the job fails. The version and checksum are pinned together with a
     "looked up <date>" comment (latest release seen 2026-10-20: v8.30.1).
   - Range. Checkout uses `fetch-depth: 0`. The scanned range is every commit in the
     change:
     - `pull_request`: `$(git merge-base <base.sha> <head.sha>)..<head.sha>`
     - `merge_group`: `<merge_group.base_sha>..<merge_group.head_sha>`

     A secret added in an earlier commit and removed later is still found (S4).
   - Command: `gitleaks git --log-opts="<range>" --config security/gitleaks/gitleaks.toml
     --gitleaks-ignore-path security/gitleaks --ignore-gitleaks-allow --redact
     --report-format json --report-path <runner temp>/gitleaks.json --exit-code 1
     --no-banner`.
   - `security/gitleaks/gitleaks.toml` is `[extend] useDefault = true` plus Security's
     allowlist, which is empty at first. Inline `gitleaks:allow` comments and a
     root-level `.gitleaksignore` are not honoured (S9 principle: suppressions only under
     `/security/**`).
   - Output. `--redact` keeps the matched value out of the log and the report. A follow-up
     step (`if: always()`) emits one annotation per finding from the redacted JSON report:
     `::error file=<File>,line=<StartLine>,title=gitleaks <RuleID>::commit <Commit short sha>`.
     File and line are therefore in the check's output (S3) without the value. The step
     never prints the `Secret` or `Match` fields.
   - If Gitleaks exits with any code other than 0 or 1, or the report is missing, the job
     fails.
4. SARIF gate: `.ci/scan/sarif-gate.mjs` (Node 24, no dependencies), with unit tests in
   `.ci/scan/sarif-gate.test.mjs` that run in the `sast` job via `node --test .ci/scan/`.
   - It reads every `*.sarif` in the `analyze` output directory and the allowlist
     `security/sast-allowlist.json`.
   - Blocking result: the rule's `properties["security-severity"]` is >= 7.0 (CVSS high
     or critical). The rule is looked up through `ruleIndex`/`rule.id` in
     `tool.driver.rules` or `tool.extensions[].rules`.
   - The SARIF `suppressions` and `baselineState` fields are ignored. In-source comments
     such as `// codeql[...]` or `// lgtm[...]` therefore never clear a finding (S9).
   - Output: each blocking result is printed as
     `::error file=<uri>,line=<startLine>,title=<ruleId>::<message>`. Results below 7.0
     are printed as `::warning` and do not fail the job.
   - Exit 1 (fail-closed) when a blocking result has no allowlist match, when no SARIF file
     is found, or when a SARIF file does not parse or has zero runs.
   - Allowlist schema: a JSON array of
     `{ "ruleId", "path", "startLine"?, "reason", "issue", "expires" }`. All fields except
     `startLine` are required. An entry whose `expires` date (ISO 8601) has passed no
     longer matches and is reported as a warning.
5. Suppressions exist only under `/security/**`:
   - `security/codeql/codeql-config.yml` (`query-filters`, `paths-ignore`)
   - `security/sast-allowlist.json`
   - `security/gitleaks/`

   CODEOWNERS already lists `/security/**` →
   `@bs-sandbox/security-bot @bs-sandbox/security-owners`, and `factory/ownership-gate`
   requires both (S8). This ADR makes no CODEOWNERS change.
6. GitHub native secret scanning and push protection are switched on in repository
   settings (Settings → Advanced Security). A push that contains a supported provider
   pattern is then rejected, or raises an alert readable through
   `GET /repos/{owner}/{repo}/secret-scanning/alerts` (S10). This complements Gitleaks and
   does not replace it: GitHub alerts only on provider patterns, and treats an AWS key ID
   only as part of a key ID + secret pair.
7. The ruleset for `main` adds `sast` and `secret-scan` as required status checks
   alongside `ci`. Both jobs report on `merge_group`, so the queue does not stall (S7).
8. No new npm dependency. Gitleaks is a CI binary and CodeQL is a GitHub action. Neither is
   added to `package.json`.

Alternatives:
- Semgrep CE for SAST: rejected. Its results reach the code-scanning API only through a
  separate SARIF upload, and its free JS rules are narrower than CodeQL
  `security-extended`. CodeQL is GitHub's own and is free on public repositories.
- CodeQL default setup: rejected. It cannot pin the config to `/security/**`, attribute to
  the head SHA, or add the gate.
- Failing on GitHub's "CodeQL" code-scanning check run: rejected. Its threshold is a
  repository setting rather than reviewed code, it honours alert dismissals made in the UI,
  and it attaches to the merge ref.
- TruffleHog: rejected. Its verification sends candidate secrets to providers, which is
  not wanted in a CI gate. Gitleaks covers S3/S4 offline with `--redact`.
- `gitleaks-action`: rejected because of the licence requirement for organisations.
- GitHub secret scanning only: rejected. It gives no per-commit pass/fail check (S2/S3),
  covers only provider patterns, and treats AWS key IDs only as part of a pair.
- Adding the jobs to `ci.yml`: rejected. Separate check names let Security cite scanner
  evidence on its own, and keep the `ci` contract in `ci.yml` unchanged.

Consequences:
- Easier: Security Review cites the `sast` and `secret-scan` check runs and the
  code-scanning analyses for the head SHA. Every suppression is a reviewed file under
  `/security/**`.
- Harder: every PR runs two more jobs, and CodeQL adds a few minutes. Test fixtures with
  credential-like or vulnerable code fail the scans by design. QA's S3/S4/S5/S9/S10
  fixtures therefore live only on throwaway PR branches that are never merged. The
  Gitleaks and CodeQL pins must be bumped by hand.
- Requires a repository admin (human): enable secret scanning and push protection, keep
  code scanning default setup off, and add the required checks to the ruleset.
- Residual risk: a PR that edits `security-scan.yml` or `.ci/scan/**` can weaken its own
  scan. This is mitigated only by the DevOps + Security review that CODEOWNERS and
  `factory/ownership-gate` require.
- Follow-up (not in LIV-34): a DAST/preview environment, and an audit step for
  `tests/acceptance` dependencies (the PM's optional note).

Related: LIV-34, LIV-13, `contracts/ci/security-scans.md`, `.github/workflows/ci.yml`,
`.github/CODEOWNERS`.
