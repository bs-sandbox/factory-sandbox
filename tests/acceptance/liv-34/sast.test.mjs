// LIV-34 acceptance: sast scenarios S1, S5, S6, S7, S9, S12, S13 and the evidence-source rule.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  gh, sleep, createFixturePr, pushCommit, cleanupFixtures, waitForScans, jobLog,
  securityScanRunFor, EVAL_JS, EVAL_PATH,
} from './lib.mjs';

const T = { timeout: 40 * 60_000 };
after(cleanupFixtures);

async function alertFor(prNumber, path, timeoutMs = 5 * 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const alerts = await gh('GET', `/code-scanning/alerts?ref=refs/pull/${prNumber}/head&state=open&per_page=100`);
    const hit = alerts.find((a) => a.most_recent_instance?.location?.path === path && a.most_recent_instance.location.start_line > 0);
    if (hit) return hit;
    assert.ok(Date.now() < end, `no code-scanning alert for ${path} on PR ${prNumber}`);
    await sleep(15_000);
  }
}
const evalPr = (tag, extra = {}) => createFixturePr(tag, [{ files: { [EVAL_PATH]: EVAL_JS, ...extra } }]);

describe('sast', () => {
  test('S1: sast check on head SHA is success/failure (not missing/skipped) and an analysis exists for the SHA', T, async () => {
    const fx = await createFixturePr('s1', [{ files: { 'fixtures/clean.txt': 'hello\n' } }]);
    const { sast } = await waitForScans(fx.head);
    assert.equal(sast.head_sha, fx.head);
    assert.ok(['success', 'failure'].includes(sast.conclusion), `conclusion ${sast.conclusion}`);
    const analyses = await gh('GET', `/code-scanning/analyses?sha=${fx.head}`);
    assert.ok(analyses.length >= 1, 'at least one analysis for the head SHA');
    const run = await securityScanRunFor(sast);
    assert.ok(run, 'workflow run found for the check suite');
    assert.equal(run.path, '.github/workflows/security-scan.yml');
    assert.equal(run.head_sha, fx.head);
  });

  test('S5: high-severity finding fails sast and is visible with file and line', T, async () => {
    const fx = await evalPr('s5');
    const { sast } = await waitForScans(fx.head);
    assert.equal(sast.conclusion, 'failure');
    const alert = await alertFor(fx.number, EVAL_PATH);
    assert.ok(alert.most_recent_instance.location.start_line >= 1);
  });

  test('S6: a new commit re-runs both scans on the new head SHA', T, async () => {
    const fx = await createFixturePr('s6', [{ files: { 'fixtures/a.txt': 'a\n' } }]);
    const x = fx.head;
    await waitForScans(x);
    const y = await pushCommit(fx, { 'fixtures/b.txt': 'b\n' });
    assert.notEqual(x, y);
    const r = await waitForScans(y);
    assert.equal(r.sast.head_sha, y);
    assert.equal(r.secret.head_sha, y);
  });

  test('S7: merge_group runs of security-scan.yml report sast and secret-scan on the merge group commit', T, async () => {
    const { workflow_runs } = await gh('GET', '/actions/workflows/security-scan.yml/runs?event=merge_group&per_page=20');
    const run = workflow_runs.find((r) => r.status === 'completed');
    assert.ok(run, 'a completed merge_group run of security-scan.yml exists');
    const { check_runs } = await gh('GET', `/commits/${run.head_sha}/check-runs?per_page=100`);
    for (const n of ['sast', 'secret-scan']) {
      const c = check_runs.find((x) => x.name === n && x.check_suite.id === run.check_suite_id);
      assert.ok(c, `${n} reported on merge group commit ${run.head_sha}`);
      assert.equal(c.status, 'completed');
    }
  });

  test('S9: suppression outside /security/** (inline codeql comment) does not clear the finding', T, async () => {
    const fx = await createFixturePr('s9a', [{ files: { [EVAL_PATH]: `// codeql[js/code-injection]\n${EVAL_JS}` } }]);
    const { sast } = await waitForScans(fx.head);
    assert.equal(sast.conclusion, 'failure');
  });

  test('S9: suppression outside /security/** (.github/codeql config excluding the rule) does not clear the finding', T, async () => {
    const cfg = 'name: qa\nquery-filters:\n  - exclude:\n      id: js/code-injection\n';
    const fx = await evalPr('s9b', { '.github/codeql/codeql-config.yml': cfg });
    const { sast } = await waitForScans(fx.head);
    assert.equal(sast.conclusion, 'failure');
  });

  test('S12: expired allowlist entry does not suppress (run 1)', T, async () => {
    const entry = [{ ruleId: 'js/code-injection', path: EVAL_PATH, reason: 'qa', issue: 'LIV-34', expires: '2020-01-01' }];
    const fx = await evalPr('s12a', { 'security/sast-allowlist.json': JSON.stringify(entry) });
    const { sast } = await waitForScans(fx.head);
    assert.equal(sast.conclusion, 'failure');
  });

  for (const missing of ['reason', 'expires']) {
    test(`S12: allowlist entry without "${missing}" does not suppress (run 2)`, T, async () => {
      const entry = { ruleId: 'js/code-injection', path: EVAL_PATH, reason: 'qa', issue: 'LIV-34', expires: '2999-01-01' };
      delete entry[missing];
      const fx = await evalPr(`s12b-${missing}`, { 'security/sast-allowlist.json': JSON.stringify([entry]) });
      const { sast } = await waitForScans(fx.head);
      assert.equal(sast.conclusion, 'failure');
    });
  }

  test('S13: gate unit tests for (a) no SARIF (b) unparsable (c) missing language (d) unresolved rule run in the sast job', T, async () => {
    const fx = await createFixturePr('s13a', [{ files: { 'fixtures/clean.txt': 'x\n' } }]);
    const { sast } = await waitForScans(fx.head);
    const log = await jobLog(sast.id);
    assert.match(log, /node --test/, 'sast job runs node --test');
    assert.match(log, /# fail 0/, 'gate unit tests report zero failures');
    const pass = Number((log.match(/# pass (\d+)/) || [])[1]);
    assert.ok(pass >= 4, `at least 4 gate tests passed, saw ${pass}`);
    assert.match(log, /no sarif|missing sarif|sarif (is )?missing|not found/i, '(a) test present');
    assert.match(log, /pars|malformed|invalid json/i, '(b) test present');
    assert.match(log, /language|javascript-typescript|actions/i, '(c) test present');
    assert.match(log, /unresolved|cannot be resolved|unknown rule|rule not found/i, '(d) test present');
  });

  test('S13: sast fails whenever the gate tests fail (deliberately failing gate test)', T, async () => {
    const failing = "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('qa deliberate failure', () => assert.equal(1, 2));\n";
    const fx = await createFixturePr('s13b', [{ files: { '.ci/scan/zz-qa-fail.test.mjs': failing } }]);
    const { sast } = await waitForScans(fx.head);
    assert.equal(sast.conclusion, 'failure');
  });
});
