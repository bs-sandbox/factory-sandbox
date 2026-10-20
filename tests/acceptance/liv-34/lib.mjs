// Helpers for LIV-34 acceptance tests. Written from the AC and contracts/ci/security-scans.md only.
// Needs GH_TOKEN (contents, pull-requests, actions, checks, code-scanning, secret-scanning access).
// Every fixture lives on a throwaway branch/PR that is closed and deleted afterwards (contract §4).
import { randomBytes } from 'node:crypto';

export const REPO = process.env.QA_REPO || 'bs-sandbox/factory-sandbox';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const API = 'https://api.github.com';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function gh(method, path, body, { raw = false, okStatuses = [] } = {}) {
  if (!TOKEN) throw new Error('GH_TOKEN is required (tests never skip)');
  const res = await fetch(path.startsWith('http') ? path : `${API}/repos/${REPO}${path}`, {
    method,
    redirect: 'follow',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok && !okStatuses.includes(res.status)) {
    const e = new Error(`${method} ${path} -> ${res.status}`);
    e.status = res.status; e.body = json; throw e;
  }
  return okStatuses.length ? { status: res.status, json } : json;
}

// Fresh non-live AWS key ID: AKIA + 16 chars from [A-Z2-7], >= 10 distinct (contract §4).
export function genAwsKeyId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  for (;;) {
    const s = Array.from(randomBytes(16), (b) => alphabet[b % 32]).join('');
    if (new Set(s).size >= 10) return `AKIA${s}`;
  }
}
export function genAwsSecret() {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/+';
  return Array.from(randomBytes(40), (b) => a[b % a.length]).join('');
}
export const leakLine = (id) => `aws_access_key_id = ${id}\n`;

export const EVAL_JS = 'eval(decodeURIComponent(location.hash.slice(1)));\n';
export const EVAL_PATH = 'src/js/fixture-eval.js';

let created = [];
const rand = () => randomBytes(4).toString('hex');

async function mainSha() {
  return (await gh('GET', '/git/ref/heads/main')).object.sha;
}
async function putFile(branch, path, content, message) {
  let sha;
  const cur = await gh('GET', `/contents/${path}?ref=${branch}`, null, { okStatuses: [404] });
  if (cur.status === 200) sha = cur.json.sha;
  const r = await gh('PUT', `/contents/${path}`, {
    message, branch, sha, content: Buffer.from(content).toString('base64'),
  }, { okStatuses: [409, 422] });
  return r; // {status, json}
}

// commits: array of {files: {path: content}, message?}. Opens a PR against main.
export async function createFixturePr(tag, commits, { draft = false } = {}) {
  const branch = `qa-fixture/liv-34-${tag}-${rand()}`;
  await gh('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: await mainSha() });
  const fx = { branch, number: null, pushRejected: null };
  created.push(fx);
  let head;
  for (const [i, c] of commits.entries()) {
    for (const [p, content] of Object.entries(c.files)) {
      const r = await putFile(branch, p, content, c.message || `qa fixture ${tag} commit ${i + 1}`);
      if (r.status >= 400) { fx.pushRejected = r; return fx; }
      head = r.json.commit.sha;
    }
  }
  const pr = await gh('POST', '/pulls', {
    title: `QA fixture LIV-34 ${tag} (throwaway, never merge)`, head: branch, base: 'main', draft,
    body: 'Throwaway QA fixture for LIV-34. Close without merging.',
  });
  fx.number = pr.number; fx.head = pr.head.sha;
  return fx;
}

export async function pushCommit(fx, files, message = 'qa fixture follow-up') {
  let head;
  for (const [p, c] of Object.entries(files)) head = (await putFile(fx.branch, p, c, message)).json.commit.sha;
  fx.head = head; return head;
}

export async function cleanupFixtures() {
  for (const fx of created.splice(0)) {
    if (fx.number) await gh('PATCH', `/pulls/${fx.number}`, { state: 'closed' }, { okStatuses: [404, 422] });
    await gh('DELETE', `/git/refs/heads/${fx.branch}`, null, { okStatuses: [404, 422] });
  }
}

export async function waitForScans(sha, { timeoutMs = 25 * 60_000 } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const { check_runs } = await gh('GET', `/commits/${sha}/check-runs?per_page=100`);
    const pick = (n) => check_runs.filter((c) => c.name === n);
    const s = pick('sast'), g = pick('secret-scan');
    if (s.length && g.length && [...s, ...g].every((c) => c.status === 'completed')) {
      return { sast: s.at(-1), secret: g.at(-1), all: check_runs };
    }
    if (Date.now() > end) throw new Error(`timeout waiting for sast/secret-scan on ${sha}: have ${check_runs.map((c) => `${c.name}:${c.status}`)}`);
    await sleep(20_000);
  }
}

export async function jobLog(checkRunId) {
  const res = await gh('GET', `/actions/jobs/${checkRunId}/logs`, null, { raw: true });
  if (!res.ok) throw new Error(`job log ${checkRunId} -> ${res.status}`);
  return res.text();
}
export async function annotations(checkRunId) {
  return gh('GET', `/check-runs/${checkRunId}/annotations?per_page=100`);
}
export async function securityScanRunFor(checkRun) {
  const { workflow_runs } = await gh('GET', `/actions/runs?head_sha=${checkRun.head_sha}&per_page=100`);
  return workflow_runs.find((r) => r.check_suite_id === checkRun.check_suite.id);
}
