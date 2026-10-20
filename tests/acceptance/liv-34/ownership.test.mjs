// LIV-34 acceptance: S8 suppression changes need Security + human Security Owner approval.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { gh, sleep, createFixturePr, pushCommit, cleanupFixtures } from './lib.mjs';

after(cleanupFixtures);

test('S8: /security/** is code-owned by two owners (Security role + human Security Owner)', async () => {
  let co;
  for (const p of ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']) {
    const r = await gh('GET', `/contents/${p}?ref=main`, null, { okStatuses: [404] });
    if (r.status === 200) { co = Buffer.from(r.json.content, 'base64').toString(); break; }
  }
  assert.ok(co, 'CODEOWNERS found on main');
  const line = co.split('\n').filter((l) => /^\s*\/?security\//.test(l)).at(-1);
  assert.ok(line, 'a CODEOWNERS rule for /security/** exists');
  const owners = line.trim().split(/\s+/).slice(1);
  assert.ok(owners.length >= 2, `at least two owners on the /security/ rule: ${line}`);
});

test('S8: an unapproved PR modifying a suppression file under /security/** cannot be merged', { timeout: 20 * 60_000 }, async () => {
  const fx = await createFixturePr('s8', [{ files: { 'security/sast-allowlist.json': '[]\n' } }]);
  await pushCommit(fx, { 'security/sast-allowlist.json': '[]\n\n' }, 'qa s8 touch suppression file');
  let pr;
  for (let i = 0; i < 30; i++) {
    pr = await gh('GET', `/pulls/${fx.number}`);
    if (pr.mergeable_state && pr.mergeable_state !== 'unknown') break;
    await sleep(10_000);
  }
  const reviews = await gh('GET', `/pulls/${fx.number}/reviews`);
  assert.equal(reviews.filter((r) => r.state === 'APPROVED').length, 0, 'precondition: no approvals');
  assert.equal(pr.mergeable_state, 'blocked', 'PR touching /security/** without approvals is not mergeable');
});
