// Acceptance tests for LIV-44 (AC S4: the ci contract). Written from the AC only.
// S1-S3 are properties of CI run logs (cache hit/miss, apt lines, timing, failing-test
// conclusion); QA verifies them from the ci run logs in P3 and cites run IDs.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CI = fileURLToPath(new URL("../../.github/workflows/ci.yml", import.meta.url));
const lines = () => readFileSync(CI, "utf8").split(/\r?\n/);
const code = () => lines().filter((l) => !/^\s*#/.test(l));

function topBlock(key) {
  const ls = code();
  const i = ls.findIndex((l) => l.startsWith(`${key}:`));
  expect(i, `top-level ${key}: present`).toBeGreaterThanOrEqual(0);
  const out = [];
  for (let j = i + 1; j < ls.length && (/^\s/.test(ls[j]) || ls[j] === ""); j++) out.push(ls[j]);
  return out;
}

function steps() {
  const ls = code();
  const out = [];
  let cur = null;
  for (const l of ls) {
    if (/^ {6}- /.test(l)) { cur = [l]; out.push(cur); }
    else if (cur && (/^ {7,}/.test(l) || l === "")) cur.push(l);
    else cur = null;
  }
  return out.map((s) => s.join("\n"));
}

test("S4 job and check are named ci", () => {
  expect(code().some((l) => /^name:\s*ci\s*$/.test(l))).toBe(true);
  const jobs = topBlock("jobs");
  expect(jobs.filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim())).toEqual(["ci:"]);
  expect(jobs.some((l) => /^ {4}name:\s*ci\s*$/.test(l))).toBe(true);
});

test("S4 the only triggers are pull_request and merge_group", () => {
  const keys = topBlock("on").filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().replace(/:.*$/, ""));
  expect(keys.sort()).toEqual(["merge_group", "pull_request"]);
});

test("S4 every action is pinned to a full commit SHA with its release named in a comment", () => {
  const uses = code().filter((l) => /\buses:/.test(l));
  expect(uses.length).toBeGreaterThan(0);
  for (const l of uses) {
    expect(l, l).toMatch(/uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v?\d+(\.\d+)*\S*/);
  }
});

test("S4 every npm ci keeps --ignore-scripts", () => {
  const npmCi = code().filter((l) => /\bnpm\s+ci\b/.test(l));
  expect(npmCi.length).toBeGreaterThan(0);
  for (const l of npmCi) expect(l, l).toContain("--ignore-scripts");
});

test("S4 acceptance tests run if and only if tests/acceptance/package-lock.json exists", () => {
  const runners = steps().filter((s) => /\bplaywright\s+test\b/.test(s));
  expect(runners.length).toBeGreaterThan(0);
  for (const s of runners) {
    expect(s).toMatch(/if:\s*hashFiles\(\s*'tests\/acceptance\/package-lock\.json'\s*\)\s*!=\s*''/);
  }
});

test("S4 workflow permissions remain contents: read", () => {
  const perms = topBlock("permissions").map((l) => l.trim()).filter(Boolean);
  expect(perms).toEqual(["contents: read"]);
  expect(code().some((l) => /^\s*permissions:/.test(l) && !l.startsWith("permissions:"))).toBe(false);
});

test("S4 timeout-minutes on the ci job is no more than 15", () => {
  const jobs = topBlock("jobs");
  const t = jobs.filter((l) => /^ {4}timeout-minutes:/.test(l));
  expect(t.length).toBe(1);
  const n = Number(t[0].split(":")[1].trim());
  expect(Number.isInteger(n)).toBe(true);
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(15);
});
