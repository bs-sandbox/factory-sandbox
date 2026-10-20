// LIV-34 acceptance: secret-scan scenarios S2, S3, S4, S11, S14, S15 (and S10 push-time).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  gh, sleep, genAwsKeyId, genAwsSecret, leakLine, createFixturePr, pushCommit, cleanupFixtures,
  waitForScans, jobLog, annotations, securityScanRunFor,
} from './lib.mjs';

const T = { timeout: 40 * 60_000 };
after(cleanupFixtures);

async function leakPr(tag) {
  const id = genAwsKeyId();
  const fx = await createFixturePr(tag, [{ files: { 'fixtures/leak.txt': leakLine(id) } }]);
  return { fx, id };
}

describe('secret-scan', () => {
  test('S2: clean PR gets secret-scan check with conclusion success', T, async () => {
    const fx = await createFixturePr('s2', [{ files: { 'fixtures/clean.txt': 'nothing secret here\n' } }]);
    assert.ok(fx.number, 'fixture PR opened');
    const { secret } = await waitForScans(fx.head);
    assert.equal(secret.head_sha, fx.head);
    assert.equal(secret.conclusion, 'success');
  });

  test('S3: credential pattern fails secret-scan; output names file and line, not the value', T, async () => {
    const { fx, id } = await leakPr('s3');
    const { secret } = await waitForScans(fx.head);
    assert.equal(secret.conclusion, 'failure');
    const anns = await annotations(secret.id);
    const hit = anns.find((a) => a.path === 'fixtures/leak.txt' && a.start_line === 1);
    assert.ok(hit, `annotation naming fixtures/leak.txt line 1; got ${anns.map((a) => `${a.path}:${a.start_line}`)}`);
    assert.ok(!JSON.stringify([anns, secret.output]).includes(id), 'full value absent from check output/annotations');
  });

  test('S4: credential only in 1st of 3 commits (removed at head) still fails secret-scan', T, async () => {
    const id = genAwsKeyId();
    const fx = await createFixturePr('s4', [
      { files: { 'fixtures/leak.txt': leakLine(id) }, message: 'qa s4 commit 1' },
      { files: { 'fixtures/other.txt': 'harmless\n' }, message: 'qa s4 commit 2' },
      { files: { 'fixtures/leak.txt': 'removed\n' }, message: 'qa s4 commit 3 (head)' },
    ]);
    const pr = await gh('GET', `/pulls/${fx.number}`);
    assert.equal(pr.commits, 3);
    const { secret } = await waitForScans(pr.head.sha);
    assert.equal(secret.conclusion, 'failure');
  });

  test('S11: inline gitleaks:allow and root .gitleaksignore are not honoured', T, async () => {
    // Fingerprint <commit>:<file>:<rule>:<line> includes the secret's commit SHA: add the secret first,
    // then the .gitleaksignore in a following commit (contract §4).
    const id = genAwsKeyId();
    const fx = await createFixturePr('s11', [{ files: { 'fixtures/leak.txt': `aws_access_key_id = ${id} # gitleaks:allow\n` } }]);
    const first = fx.head;
    const rules = ['aws-access-token', 'aws-access-key-id', 'generic-api-key'];
    await pushCommit(fx, { '.gitleaksignore': rules.map((r) => `${first}:fixtures/leak.txt:${r}:1`).join('\n') + '\n' }, 'qa s11 add root .gitleaksignore');
    const { secret } = await waitForScans(fx.head);
    assert.equal(secret.head_sha, fx.head);
    assert.equal(secret.conclusion, 'failure');
  });

  test('S14: generated value is absent from job log, annotations and run artifacts', T, async () => {
    const { fx, id } = await leakPr('s14');
    const { secret } = await waitForScans(fx.head);
    assert.equal(secret.conclusion, 'failure', 'precondition: S3 PR fails');
    const log = await jobLog(secret.id);
    assert.ok(log.length > 0, 'job log retrieved');
    assert.ok(!log.includes(id), 'value not found in job log');
    assert.ok(!JSON.stringify(await annotations(secret.id)).includes(id), 'value not found in annotations');
    const run = await securityScanRunFor(secret);
    assert.ok(run, 'workflow run for the check suite found');
    const arts = await gh('GET', `/actions/runs/${run.id}/artifacts`);
    assert.equal(arts.total_count, 0, 'workflow run has no artifacts');
  });

  test('S15: credential introduced only by a merge-commit conflict resolution fails secret-scan', T, async () => {
    const id = genAwsKeyId();
    const mainSha = (await gh('GET', '/git/ref/heads/main')).object.sha;
    const baseTree = (await gh('GET', `/git/commits/${mainSha}`)).tree.sha;
    const treeWith = async (content) => {
      const blob = await gh('POST', '/git/blobs', { content, encoding: 'utf-8' });
      return gh('POST', '/git/trees', { base_tree: baseTree, tree: [{ path: 'config.txt', mode: '100644', type: 'blob', sha: blob.sha }] });
    };
    const side = async (n) => gh('POST', '/git/commits', { message: `qa s15 x = ${n}`, tree: (await treeWith(`x = ${n}\n`)).sha, parents: [mainSha] });
    const p1 = await side(1);
    const s1 = await side(2);
    const merge = await gh('POST', '/git/commits', {
      message: 'qa s15 merge (conflict resolved)', tree: (await treeWith(leakLine(id))).sha, parents: [p1.sha, s1.sha],
    });
    const branch = `qa-fixture/liv-34-s15-${Date.now().toString(36)}`;
    await gh('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: merge.sha });
    let number;
    try {
      const pr = await gh('POST', '/pulls', { title: 'QA fixture LIV-34 s15 (throwaway, never merge)', head: branch, base: 'main', body: 'Throwaway QA fixture. Close without merging.' });
      number = pr.number;
      const { secret } = await waitForScans(merge.sha);
      assert.equal(secret.conclusion, 'failure');
    } finally {
      if (number) await gh('PATCH', `/pulls/${number}`, { state: 'closed' }, { okStatuses: [404, 422] });
      await gh('DELETE', `/git/refs/heads/${branch}`, null, { okStatuses: [404, 422] });
    }
  });

  test('S10: pushed credential pair is rejected, or visible as a secret-scanning alert (API not "disabled")', T, async () => {
    const content = `${leakLine(genAwsKeyId())}aws_secret_access_key = ${genAwsSecret()}\n`;
    const fx = await createFixturePr('s10', [{ files: { 'fixtures/leak-pair.txt': content } }]);
    if (fx.pushRejected) {
      assert.ok([409, 422].includes(fx.pushRejected.status), `push rejected with ${fx.pushRejected.status}`);
      return;
    }
    const sha = fx.head;
    const end = Date.now() + 5 * 60_000;
    for (;;) {
      const r = await gh('GET', '/secret-scanning/alerts?state=open&per_page=100', null, { okStatuses: [404, 403] });
      assert.equal(r.status, 200, `alerts API must not be disabled/forbidden: ${r.status} ${JSON.stringify(r.json?.message)}`);
      for (const a of r.json) {
        const locs = await gh('GET', `/secret-scanning/alerts/${a.number}/locations`);
        if (locs.some((l) => l.details?.commit_sha === sha)) return;
      }
      assert.ok(Date.now() < end, `no secret-scanning alert for commit ${sha} within 5 min`);
      await sleep(20_000);
    }
  });
});
