# LIV-34 acceptance tests (QA)

Authored from the AC (S1–S15) and `contracts/ci/security-scans.md` only.

Run with `GH_TOKEN` (repo write, actions, checks, code-scanning and secret-scanning access):

    cd tests/acceptance/liv-34 && node --test --test-concurrency=4 *.test.mjs

Fixtures are throwaway branches/PRs (`qa-fixture/liv-34-*`), closed and deleted after each run, never merged.
Credential values are generated at test time and never printed. A missing token fails the tests; nothing is skipped.

- `secret-scan.test.mjs`: S2 S3 S4 S10 S11 S14 S15
- `sast.test.mjs`: S1 S5 S6 S7 S9 S12 S13
- `ownership.test.mjs`: S8
