import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluate } from './sarif-gate.mjs';

const GATE = fileURLToPath(new URL('./sarif-gate.mjs', import.meta.url));
const NOW = new Date('2026-10-20T00:00:00Z');

// Real CodeQL v4.39.0 shape (PR #14 first run): files javascript.sarif and actions.sarif, runs without
// automationDetails.id. Fixtures below also cover the id form (/language:<lang>/).
const rule = (id, sev) => ({ id, properties: sev === undefined ? {} : { 'security-severity': sev } });
const run = (lang, rules = [], results = []) => ({
  automationDetails: { id: `.github/workflows/security-scan.yml:sast/language:${lang}/` },
  tool: { driver: { name: 'CodeQL', rules } },
  results,
});
const result = (ruleId, ruleIndex, uri = 'src/a.js', line = 3, extra = {}) => ({
  ruleId, ruleIndex, message: { text: 'm' },
  locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: line } } }], ...extra,
});
const clean = () => [run('javascript-typescript'), run('actions')];

function setup(runs, allowlist = [], raw) {
  const d = mkdtempSync(join(tmpdir(), 'gate-'));
  if (raw !== undefined) writeFileSync(join(d, 'x.sarif'), raw);
  else if (runs) writeFileSync(join(d, 'x.sarif'), JSON.stringify({ version: '2.1.0', runs }));
  const a = join(d, 'allow.json');
  writeFileSync(a, typeof allowlist === 'string' ? allowlist : JSON.stringify(allowlist));
  return { d, a };
}
const ev = (s) => evaluate(s.d, s.a, NOW);

test('clean SARIF with both languages passes', () => {
  assert.equal(ev(setup(clean())).exitCode, 0);
});
test('no sarif file fails closed', () => {
  assert.equal(ev(setup(null)).exitCode, 1);
});
test('no sarif: missing directory fails closed', () => {
  assert.equal(evaluate(join(tmpdir(), 'does-not-exist-xyz'), 'x', NOW).exitCode, 1);
});
test('parse error in SARIF fails closed', () => {
  assert.equal(ev(setup(null, [], '{not json')).exitCode, 1);
});
test('parse: zero runs fails closed', () => {
  assert.equal(ev(setup([])).exitCode, 1);
});
test('missing language run (actions) fails closed', () => {
  assert.equal(ev(setup([run('javascript-typescript')])).exitCode, 1);
});
test('missing language run (javascript-typescript) fails closed', () => {
  assert.equal(ev(setup([run('actions')])).exitCode, 1);
});
test('language: javascript alias counts as javascript-typescript', () => {
  assert.equal(ev(setup([run('javascript'), run('actions')])).exitCode, 0);
});
test('unresolved rule fails closed', () => {
  const r = run('javascript-typescript', [], [result('js/x', 5)]);
  assert.equal(ev(setup([r, run('actions')])).exitCode, 1);
});
test('unresolved rule: rule without security-severity is blocking', () => {
  const r = run('javascript-typescript', [rule('js/x')], [result('js/x', 0)]);
  assert.equal(ev(setup([r, run('actions')])).exitCode, 1);
});
const high = () => [
  run('javascript-typescript', [rule('js/code-injection', '9.3')], [result('js/code-injection', 0)]),
  run('actions'),
];
test('blocking result without allowlist fails', () => {
  assert.equal(ev(setup(high())).exitCode, 1);
});
test('result below 7.0 only warns', () => {
  const r = run('javascript-typescript', [rule('js/low', '4.0')], [result('js/low', 0)]);
  const out = ev(setup([r, run('actions')]));
  assert.equal(out.exitCode, 0);
  assert.ok(out.lines.some((l) => l.startsWith('::warning')));
});
const entry = (o = {}) => ({ ruleId: 'js/code-injection', path: 'src/a.js', reason: 'r', issue: 'LIV-1', expires: '2027-01-01', ...o });
test('valid allowlist entry clears the finding', () => {
  assert.equal(ev(setup(high(), [entry()])).exitCode, 0);
});
test('allowlist match is exact: glob path does not clear', () => {
  assert.equal(ev(setup(high(), [entry({ path: 'src/*.js' })])).exitCode, 1);
});
test('allowlist startLine must match when given', () => {
  assert.equal(ev(setup(high(), [entry({ startLine: 99 })])).exitCode, 1);
  assert.equal(ev(setup(high(), [entry({ startLine: 3 })])).exitCode, 0);
});
test('expired allowlist entry does not match and warns', () => {
  const out = ev(setup(high(), [entry({ expires: '2026-01-01' })]));
  assert.equal(out.exitCode, 1);
  assert.ok(out.lines.some((l) => l.startsWith('::warning')));
});
for (const k of ['reason', 'issue', 'expires']) {
  test(`allowlist entry missing ${k} fails closed`, () => {
    const e = entry();
    delete e[k];
    assert.equal(ev(setup(clean(), [e])).exitCode, 1);
  });
}
test('allowlist with unparsable expires fails closed', () => {
  assert.equal(ev(setup(clean(), [entry({ expires: 'soon' })])).exitCode, 1);
});
test('allowlist not an array or not parseable fails closed', () => {
  assert.equal(ev(setup(clean(), '{}')).exitCode, 1);
  assert.equal(ev(setup(clean(), 'nope')).exitCode, 1);
});
test('SARIF suppressions and baselineState are ignored', () => {
  const r = run('javascript-typescript', [rule('js/code-injection', '9.3')], [
    result('js/code-injection', 0, 'src/a.js', 3, { suppressions: [{ kind: 'inSource' }], baselineState: 'unchanged' }),
  ]);
  assert.equal(ev(setup([r, run('actions')])).exitCode, 1);
});
test('rule resolved through extensions with toolComponent index', () => {
  const r = run('javascript-typescript');
  r.tool.extensions = [{ name: 'ext', rules: [rule('js/ext', '8.0')] }];
  r.results = [result('js/ext', undefined, 'src/a.js', 1, { rule: { id: 'js/ext', index: 0, toolComponent: { index: 0 } } })];
  assert.equal(ev(setup([r, run('actions')])).exitCode, 1);
});
test('CLI exits non-zero with no sarif', () => {
  const s = setup(null);
  assert.notEqual(spawnSync(process.execPath, [GATE, s.d, s.a]).status, 0);
});
test('CLI exits zero on clean SARIF', () => {
  const s = setup(clean());
  assert.equal(spawnSync(process.execPath, [GATE, s.d, s.a]).status, 0);
});

function setupFiles(files) {
  const d = mkdtempSync(join(tmpdir(), 'gate-'));
  for (const [name, runs] of Object.entries(files)) writeFileSync(join(d, name), JSON.stringify({ version: '2.1.0', runs }));
  const a = join(d, 'allow.json');
  writeFileSync(a, '[]');
  return { d, a };
}
const bare = () => ({ tool: { driver: { name: 'CodeQL', rules: [] } }, results: [] });
test('language taken from file name when runs have no automationDetails (real CodeQL shape)', () => {
  assert.equal(ev(setupFiles({ 'javascript.sarif': [bare()], 'actions.sarif': [bare()] })).exitCode, 0);
});
test('language: file name actions only is missing javascript-typescript', () => {
  assert.equal(ev(setupFiles({ 'actions.sarif': [bare()] })).exitCode, 1);
});
test('language: unrelated file names do not satisfy the languages', () => {
  assert.equal(ev(setupFiles({ 'python.sarif': [bare()], 'ruby.sarif': [bare()] })).exitCode, 1);
});
