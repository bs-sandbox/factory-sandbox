# CI contract: PR security scans (LIV-34)

Status: Proposed (ADR 0006). Security Review and QA target this contract. Adding a check or
a field is backward compatible. Renaming or removing a check name, an annotation format or
a suppression file path is a breaking change.

## 1. Checks

| Check run name | Workflow / job | Events | Reported on |
|---|---|---|---|
| `sast` | `.github/workflows/security-scan.yml` job `sast` | `pull_request` (opened, synchronize, reopened), `merge_group` | PR head SHA; merge-group head SHA |
| `secret-scan` | `.github/workflows/security-scan.yml` job `secret-scan` | same | same |

- Conclusion `success`: no blocking finding. Conclusion `failure`: a blocking finding was
  found, or the scanner could not produce a trustworthy result (fail-closed). Neither job
  is ever skipped on these events. No `if:` on the job may skip it.
- `sast` and `secret-scan` are required status checks on `main` alongside `ci`, with
  their source pinned to the GitHub Actions app.
- Evidence rule: a `sast` or `secret-scan` check run counts only if its check suite
  belongs to a workflow run of `.github/workflows/security-scan.yml` whose `head_sha` is
  the commit under review. No other workflow defines a job with either name.
- A timeout (`sast` 30 min, `secret-scan` 10 min) or a cancellation is never `success`.
  Merge-group runs are never cancelled by concurrency.
- The workflow uploads no artifacts.
- GitHub also creates a separate `CodeQL` code-scanning check run. It is informational
  only and is not part of this contract.

## 2. `sast`

- Scanner: CodeQL, languages `javascript-typescript` and `actions`, suite
  `security-extended`, config `security/codeql/codeql-config.yml`.
- Code-scanning analyses are uploaded for every run:
  - `pull_request`: `GET /repos/bs-sandbox/factory-sandbox/code-scanning/analyses?sha=<head sha>`
    returns >= 1 analysis, and its `ref` is `refs/pull/<n>/head`.
  - `merge_group`: the analysis `commit_sha` is the merge-group head SHA.
- Alerts with file and line:
  `GET /repos/bs-sandbox/factory-sandbox/code-scanning/alerts?ref=refs/pull/<n>/head`
  (`most_recent_instance.location.path` and `.start_line`).
- Blocking: a result whose rule has `security-severity` >= 7.0 and that matches no
  unexpired, valid entry in `security/sast-allowlist.json`. A result whose rule cannot be
  resolved, or that has no numeric `security-severity`, is also blocking.
- The check fails (fail-closed, S13) when:
  - there is no SARIF,
  - a SARIF file does not parse,
  - there is no run for `javascript-typescript` or for `actions`,
  - a rule is unresolved,
  - the allowlist is invalid, or any entry lacks `reason`, `issue` or `expires` (S12),
  - the gate's unit tests (`node --test .ci/scan/`) fail.
- An expired allowlist entry produces a `::warning`, and the finding stays blocking (S12).
- Allowlist matching is exact on `ruleId` and `path`, and on `startLine` when it is given.
  There are no globs.
- Check annotations, one per result:
  - blocking: `::error file=<path>,line=<startLine>,title=<ruleId>::<message>`
  - below 7.0: `::warning ...`, does not fail the check
- Ignored, never clears a finding: SARIF `suppressions` / `baselineState`, in-source
  comments (`// codeql[...]`, `// lgtm[...]`, `eslint-disable`), and any CodeQL config
  outside `security/`.

## 3. `secret-scan`

- Scanner: Gitleaks CLI, pinned version and SHA-256, config
  `security/gitleaks/gitleaks.toml` (default rules plus Security's allowlist), with
  `--redact` and `--ignore-gitleaks-allow`.
- Range: every commit in `merge-base(base, head)..head` (PR), or `base_sha..head_sha`
  (merge group). A secret added and later removed inside the range fails the check.
  - Merge commits are diffed against each parent (`-m`), so a secret introduced only by a
    conflict resolution fails the check (S15).
  - On a PR, the range's commit count must equal the PR's `commits`. On a merge group it
    must be >= 1. Otherwise the check fails, with
    `::error title=secret-scan range::<expected> vs <actual>`.
- Not honoured: inline `gitleaks:allow`, a root `.gitleaksignore` (removed from the
  working tree before the scan), a root `.gitleaks.toml`, and the `GITLEAKS_CONFIG*` env
  vars (S11).
- `success` only if Gitleaks exits 0 and its report exists and is an empty JSON array.
- Check annotations, one per finding:
  `::error file=<File>,line=<StartLine>,title=gitleaks <RuleID>::commit <short sha>`.
  Property values are escaped (`%`, CR, LF, `:`, `,`). The matched value never appears in
  the job log or the annotations, and there are no artifacts (S14). Gitleaks results are
  not uploaded to code scanning.
- GitHub native secret scanning and push protection are enabled.
  `GET /repos/bs-sandbox/factory-sandbox/secret-scanning/alerts` does not return
  "Secret scanning is disabled on this repository".

## 4. Test fixtures (QA)

- Fixtures that are meant to fail a scan exist only on throwaway PR branches, which are
  closed and never merged. They are never committed to `main`, and never to
  `tests/acceptance/` on a branch that will merge.
- AWS key-ID pattern (S3, S4): generate a fresh non-live value at test time:
  `AKIA` + 16 random characters from `[A-Z2-7]`, with at least 10 distinct characters so
  that entropy is >= 3.
  - Do NOT use the AWS documentation value `AKIAIOSFODNN7EXAMPLE`: Gitleaks allowlists
    `.+EXAMPLE$`, so it does not fail the scan.
  - Write it as `aws_access_key_id = <value>` in a new file such as `fixtures/leak.txt`.
  - The value is random, not a credential. It is never written to Jira; cite the file,
    line and commit SHA instead.
- S10 (GitHub native): GitHub's AWS detector needs a key ID + secret access key pair. Add a
  second line `aws_secret_access_key = <40 random chars from [A-Za-z0-9/+]>` next to the
  key ID line.
  - Expected outcome: the push is rejected by push protection, or an alert appears in the
    secret-scanning alerts API.
  - Hypothesis, unverified: GitHub alerts on a random, invalid pair. If it does not, QA
    reports S10 as not demonstrable with a non-live value. QA does not use a live
    credential.
- SAST high finding (S5): in a new `src/js/fixture-eval.js`, pass a browser remote source
  to `eval`, e.g. `eval(decodeURIComponent(location.hash.slice(1)))`. This is CodeQL
  `js/code-injection`, security-severity 9.3.
- S9: the same file plus `// codeql[js/code-injection]` on the line above, and/or a
  `.github/codeql/codeql-config.yml` that excludes `js/code-injection`. `sast` must still
  fail.
- S11: the S3 line with ` # gitleaks:allow` appended, plus a root `.gitleaksignore`
  holding that finding's fingerprint. To get the fingerprint without exposing the value,
  run Gitleaks locally with `--redact` and copy only the `Fingerprint` field
  (`<commit>:<file>:<rule>:<line>`).
  - The fingerprint includes the commit SHA, so add the secret in one commit and the
    `.gitleaksignore` in a following commit. The head therefore still contains both.
  - `secret-scan` must fail.
- S12: the S5 file plus a `security/sast-allowlist.json` entry
  `{ "ruleId": "js/code-injection", "path": "src/js/fixture-eval.js", "reason": "...", "issue": "LIV-34", "expires": "<a past date>" }`.
  Run 2 has the same entry with `expires` in the future but `reason` (or `expires`)
  removed. `sast` must fail in both runs.
- S13: covered by the gate's unit tests (ADR 0006 decision 4). QA confirms that the tests
  for (a) to (d) exist and run in the `sast` job log. It also confirms that a deliberately
  failing gate test on a throwaway branch fails `sast`.
- S14: on the S3 run, search the `secret-scan` job log (`GET .../actions/jobs/<id>/logs`),
  the check-run annotations and the run's artifacts list (which must be empty) for the
  generated value. It must not appear. Report only "found" or "not found", never the
  value.
- S15: branch A adds `config.txt` with `x = 1`. A commit on the base side changes the same
  line to `x = 2`. Merge them on the PR branch and resolve the conflict by writing the
  S3 line, so that it appears in no non-merge commit's diff. `secret-scan` on the head
  must fail.

## 5. Suppression files (Security + human Security Owner approval, S8)

| File | Purpose |
|---|---|
| `security/codeql/codeql-config.yml` | CodeQL `query-filters` / `paths-ignore` (starts with none) |
| `security/sast-allowlist.json` | JSON array of `{ ruleId, path, startLine?, reason, issue, expires }` (starts as `[]`) |
| `security/gitleaks/gitleaks.toml` | `[extend] useDefault = true` plus `[allowlist]` (starts empty) |
| `security/gitleaks/.gitleaksignore` | Fingerprint ignores (passed as `--gitleaks-ignore-path`; starts as an empty file) |

Any other suppression mechanism is not honoured.
