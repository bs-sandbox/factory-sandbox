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
- `sast` and `secret-scan` are required status checks on `main` alongside `ci`.
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
  unexpired entry in `security/sast-allowlist.json`.
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
- Check annotations, one per finding:
  `::error file=<File>,line=<StartLine>,title=gitleaks <RuleID>::commit <short sha>`.
  The matched value never appears in the log, the annotations or uploaded artifacts.
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

## 5. Suppression files (Security + human Security Owner approval, S8)

| File | Purpose |
|---|---|
| `security/codeql/codeql-config.yml` | CodeQL `query-filters` / `paths-ignore` (starts with none) |
| `security/sast-allowlist.json` | JSON array of `{ ruleId, path, startLine?, reason, issue, expires }` (starts as `[]`) |
| `security/gitleaks/gitleaks.toml` | `[extend] useDefault = true` plus `[allowlist]` (starts empty) |
| `security/gitleaks/.gitleaksignore` | Fingerprint ignores (optional; starts absent or empty) |

Any other suppression mechanism is not honoured.
