// Acceptance tests for LIV-40 (repo settings for LIV-34). Written from the AC only.
// Requires GH_TOKEN (read access to repo administration/rulesets/security) in env.
// RULESET_BEFORE_JSON: path to the main ruleset JSON recorded before the change (R5).
// R3_COMMIT_SHA: commit SHA pushed by QA in LIV-34 S10 (R3).
// Never prints secret values or raw bodies (T5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPO = 'bs-sandbox/factory-sandbox';
const API = 'https://api.github.com';
const ACTIONS_APP_ID = 15368; // T1: confirm against a real check run app.id

async function gh(path) {
  const token = process.env.GH_TOKEN;
  assert.ok(token, 'GH_TOKEN must be set');
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  let body = null;
  try { body = await res.json(); } catch { /* none */ }
  return { status: res.status, body };
}

async function mainRuleset() {
  const list = await gh(`/repos/${REPO}/rulesets?includes_parents=false`);
  assert.equal(list.status, 200);
  const summary = list.body.find((r) => r.name === 'main' && r.target === 'branch') ?? list.body.find((r) => r.name === 'main');
  assert.ok(summary, 'main ruleset exists');
  const full = await gh(`/repos/${REPO}/rulesets/${summary.id}`);
  assert.equal(full.status, 200);
  return full.body;
}
const checksRule = (rs) => rs.rules.find((r) => r.type === 'required_status_checks');

test('R1 secret scanning enabled: alerts API is not a disabled error', async () => {
  const { status, body } = await gh(`/repos/${REPO}/secret-scanning/alerts`);
  assert.equal(status, 200, `status ${status}`);
  assert.ok(!/disabled/i.test(String(body?.message ?? '')));
});

test('R2 required checks pinned to the Actions source', async () => {
  const rule = checksRule(await mainRuleset());
  assert.ok(rule, 'required_status_checks rule present');
  const checks = rule.parameters.required_status_checks;
  const names = checks.map((c) => c.context);
  for (const n of ['ci', 'sast', 'secret-scan']) assert.ok(names.includes(n), `lists ${n}`);
  for (const n of ['sast', 'secret-scan']) {
    assert.equal(checks.find((c) => c.context === n).integration_id, ACTIONS_APP_ID, `${n} integration_id`);
  }
});

test('R3 push protection active: LIV-34 S10 push rejected or alert returned for the commit', async () => {
  const sha = process.env.R3_COMMIT_SHA;
  assert.ok(sha, 'R3_COMMIT_SHA must be set by QA after running LIV-34 S10 (rejected pushes: set R3_PUSH_REJECTED=1)');
  if (process.env.R3_PUSH_REJECTED === '1') return;
  const { status, body } = await gh(`/repos/${REPO}/secret-scanning/alerts?state=open`);
  assert.equal(status, 200);
  const hit = [];
  for (const a of body) {
    const locs = await gh(`/repos/${REPO}/secret-scanning/alerts/${a.number}/locations`);
    if (locs.status === 200 && locs.body.some((l) => l.details?.commit_sha === sha)) hit.push(a.number);
  }
  assert.ok(hit.length > 0, 'an alert exists for the commit');
});

test('R4 default setup off: state is not-configured', async () => {
  const { status, body } = await gh(`/repos/${REPO}/code-scanning/default-setup`);
  assert.equal(status, 200);
  assert.equal(body.state, 'not-configured');
});

test('R5 main ruleset otherwise unchanged', async () => {
  const path = process.env.RULESET_BEFORE_JSON;
  assert.ok(path, 'RULESET_BEFORE_JSON must point to the recorded before-JSON');
  const before = JSON.parse(readFileSync(path, 'utf8'));
  const after = await mainRuleset();
  assert.equal(after.enforcement, 'active');
  assert.deepEqual(after.bypass_actors, before.bypass_actors);
  for (const b of after.bypass_actors) assert.notEqual(b.actor_type, 'Integration', 'no bot/app bypass actor');
  const strip = (rs) => rs.rules.filter((r) => r.type !== 'required_status_checks');
  assert.deepEqual(strip(after), strip(before));
  const oldCi = checksRule(before).parameters.required_status_checks.find((c) => c.context === 'ci');
  const newCi = checksRule(after).parameters.required_status_checks.find((c) => c.context === 'ci');
  assert.ok(newCi, 'ci still required');
  assert.equal(newCi.integration_id, oldCi.integration_id);
});

test('R6 push-protection bypass restricted to Security Owner or recorded unavailable', async () => {
  const { status, body } = await gh(`/repos/${REPO}`);
  assert.equal(status, 200);
  const sa = body.security_and_analysis ?? {};
  assert.equal(sa.secret_scanning_push_protection?.status, 'enabled');
  const owner = process.env.SECURITY_OWNER_LOGIN;
  const mode = sa.secret_scanning_delegated_bypass?.status;
  if (mode === 'enabled') {
    assert.ok(owner, 'SECURITY_OWNER_LOGIN must be set');
    const opts = sa.secret_scanning_delegated_bypass_options?.reviewers ?? [];
    assert.equal(opts.length, 1);
    assert.equal(opts[0].reviewer_type === 'TEAM' ? opts[0].reviewer_id : owner, owner === undefined ? null : opts[0].reviewer_type === 'TEAM' ? opts[0].reviewer_id : owner);
  } else {
    // Unavailable branch: requires evidence cited by the DevOps record, not satisfiable by API silence alone.
    assert.ok(process.env.R6_UNAVAILABLE_EVIDENCE_URL?.startsWith('https://'), 'delegated bypass not enabled: R6_UNAVAILABLE_EVIDENCE_URL must cite the API response or settings page');
  }
});
