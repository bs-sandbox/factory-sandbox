// SARIF gate for the `sast` job (LIV-34, ADR 0006 decision 4). Node 24, no dependencies.
// Usage: node .ci/scan/sarif-gate.mjs <sarif-dir> <allowlist.json>
// Fail-closed: any problem exits non-zero.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_LANGUAGES = ['javascript-typescript', 'actions'];
export const THRESHOLD = 7.0;

const escMsg = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => escMsg(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export function loadAllowlist(path, now = new Date()) {
  if (!existsSync(path)) throw new Error(`allowlist missing: ${path}`);
  let data;
  try { data = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Error(`allowlist does not parse: ${e.message}`); }
  if (!Array.isArray(data)) throw new Error('allowlist is not an array');
  const warnings = [];
  const active = [];
  data.forEach((e, i) => {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) throw new Error(`allowlist entry ${i} is not an object`);
    for (const k of ['ruleId', 'path', 'reason', 'issue', 'expires']) {
      if (typeof e[k] !== 'string' || e[k].trim() === '') throw new Error(`allowlist entry ${i} missing ${k}`);
    }
    if (e.startLine !== undefined && !Number.isInteger(e.startLine)) throw new Error(`allowlist entry ${i} has invalid startLine`);
    const t = Date.parse(e.expires);
    if (Number.isNaN(t)) throw new Error(`allowlist entry ${i} has unparsable expires`);
    if (t < now.getTime()) warnings.push(`allowlist entry ${i} (${e.ruleId} ${e.path}) expired ${e.expires}`);
    else active.push(e);
  });
  return { active, warnings };
}

export function languageOf(run) {
  const id = run?.automationDetails?.id;
  if (typeof id !== 'string') return null;
  const m = id.match(/\/language:([^/\s]+)/);
  if (!m) return null;
  return m[1] === 'javascript' ? 'javascript-typescript' : m[1];
}

const rulesOf = (component) => (Array.isArray(component?.rules) ? component.rules : []);

export function resolveRule(run, result) {
  const driver = run?.tool?.driver;
  const exts = Array.isArray(run?.tool?.extensions) ? run.tool.extensions : [];
  const ref = result?.rule;
  const idx = ref?.index ?? result?.ruleIndex;
  const id = ref?.id ?? result?.ruleId;
  let component = null;
  if (Number.isInteger(ref?.toolComponent?.index)) component = exts[ref.toolComponent.index] ?? null;
  else if (ref?.toolComponent?.name) component = exts.find((x) => x?.name === ref.toolComponent.name) ?? null;
  if (component) {
    const rules = rulesOf(component);
    if (Number.isInteger(idx) && rules[idx]) return rules[idx];
    return rules.find((r) => r?.id === id) ?? null;
  }
  const dr = rulesOf(driver);
  if (Number.isInteger(idx) && dr[idx] && (id === undefined || dr[idx].id === id)) return dr[idx];
  const byId = dr.find((r) => r?.id === id);
  if (byId) return byId;
  for (const x of exts) {
    const f = rulesOf(x).find((r) => r?.id === id);
    if (f) return f;
  }
  return null;
}

// Returns { exitCode, lines }.
export function evaluate(sarifDir, allowlistPath, now = new Date()) {
  const lines = [];
  const fail = (m) => { lines.push(`::error title=sarif-gate::${escMsg(m)}`); return { exitCode: 1, lines }; };
  let allow;
  try { allow = loadAllowlist(allowlistPath, now); } catch (e) { return fail(e.message); }
  for (const w of allow.warnings) lines.push(`::warning title=sast-allowlist::${escMsg(w)}`);

  let files = [];
  try {
    if (!existsSync(sarifDir) || !statSync(sarifDir).isDirectory()) return fail(`no sarif: directory missing ${sarifDir}`);
    files = readdirSync(sarifDir).filter((f) => f.endsWith('.sarif')).sort();
  } catch (e) { return fail(`no sarif: ${e.message}`); }
  if (files.length === 0) return fail('no sarif: no *.sarif file found');

  const seen = new Set();
  const runDescriptions = [];
  let blocking = 0;
  for (const f of files) {
    let doc;
    try { doc = JSON.parse(readFileSync(join(sarifDir, f), 'utf8')); } catch (e) { return fail(`parse error in ${f}: ${e.message}`); }
    if (!doc || !Array.isArray(doc.runs) || doc.runs.length === 0) return fail(`parse: ${f} has zero runs`);
    for (const run of doc.runs) {
      const lang = languageOf(run);
      runDescriptions.push(`file=${f} props=${JSON.stringify(Object.keys(run?.properties ?? {}))} lang=${JSON.stringify(run?.properties?.languages ?? run?.tool?.driver?.properties ?? null).slice(0, 200)} id=${run?.automationDetails?.id ?? 'none'} driver=${run?.tool?.driver?.name ?? 'none'} results=${Array.isArray(run?.results) ? run.results.length : 'n/a'}`);
      if (lang) seen.add(lang);
      if (run.results !== undefined && !Array.isArray(run.results)) return fail(`parse: results is not an array in ${f}`);
      for (const res of run.results ?? []) {
        const rule = resolveRule(run, res);
        const ruleId = res?.ruleId ?? res?.rule?.id ?? 'unknown';
        if (!rule) return fail(`unresolved rule ${ruleId} in ${f}`);
        const loc = res?.locations?.[0]?.physicalLocation;
        const uri = loc?.artifactLocation?.uri ?? '';
        const line = loc?.region?.startLine;
        const msg = res?.message?.text ?? '';
        const raw = rule.properties?.['security-severity'];
        const sev = Number(raw);
        const hasSev = raw !== undefined && raw !== '' && Number.isFinite(sev);
        const isBlocking = !hasSev || sev >= THRESHOLD;
        // SARIF suppressions / baselineState are deliberately ignored.
        const allowed = isBlocking && allow.active.some((e) =>
          e.ruleId === ruleId && e.path === uri && (e.startLine === undefined || e.startLine === line));
        const where = `file=${escProp(uri)},line=${escProp(line ?? 1)},title=${escProp(ruleId)}`;
        if (isBlocking && !allowed) { blocking++; lines.push(`::error ${where}::${escMsg(msg)}`); }
        else lines.push(`::warning ${where}::${escMsg(msg)}`);
      }
    }
  }
  for (const l of REQUIRED_LANGUAGES) {
    if (!seen.has(l)) return fail(`language ${l} has no run in the SARIF (runs: ${runDescriptions.join(' | ')})`);
  }
  if (blocking > 0) { lines.push(`::error title=sarif-gate::${blocking} blocking result(s)`); return { exitCode: 1, lines }; }
  return { exitCode: 0, lines };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, allow] = process.argv.slice(2);
  if (!dir || !allow) { console.log('::error title=sarif-gate::usage: sarif-gate.mjs <sarif-dir> <allowlist>'); process.exit(2); }
  let r;
  try { r = evaluate(dir, allow); } catch (e) { console.log(`::error title=sarif-gate::${escMsg(e.message)}`); process.exit(1); }
  for (const l of r.lines) console.log(l);
  process.exit(r.exitCode);
}
