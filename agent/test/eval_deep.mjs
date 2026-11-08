// agent/test/eval_deep.mjs — Role 3. Scores Deep Check (server + model) and Quick Check (offline) on Role 4's
// eval set, plus Role 4's "phrase match only" baseline. Read-only on data/ and eval/.
//
// Usage (server running):  node agent/test/eval_deep.mjs [--server http://localhost:8787/api/chat] [--json out.json]
//   Test set: eval/test_messages.json (or EVAL_SET=<file>; falls back to `git show origin/data:…`).
//   CODE_ROOT=<dir> → load agent/, core/, data/ from another folder (e.g. a copy with the data branch's data/).
// Deep Check runs 3 messages at a time. Prints a summary; the JSON has every row.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const REPO = path.resolve(new URL("../..", import.meta.url).pathname);
const ROOT = path.resolve(process.env.CODE_ROOT || REPO);
const SERVER = arg("--server", "http://localhost:8787/api/chat");
const OUT = arg("--json", null);
const CONCURRENCY = 3;

// Default: eval/test_messages.json in this checkout (on main since Role 4's merge); else origin/data's copy.
const LOCAL_SET = path.join(REPO, "eval/test_messages.json");
const SET_FILE = process.env.EVAL_SET || (existsSync(LOCAL_SET) ? LOCAL_SET : null);
const testSet = JSON.parse(SET_FILE
  ? readFileSync(SET_FILE, "utf8")
  : execSync("git show origin/data:eval/test_messages.json", { cwd: REPO, encoding: "utf8" }));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const agent = await imp("agent/agent.js");
const { runQuickCheck } = await imp("core/quickcheck.js");
const redFlags = JSON.parse(readFileSync(path.join(ROOT, "data/red_flags.json"), "utf8"));
agent.CONFIG.serverUrl = SERVER;
if ("cacheMs" in agent.CONFIG) agent.CONFIG.cacheMs = 0; // score real runs, not cache hits

// Role 4's baseline, copied from eval/run_eval.js: 2+ red-flag phrases → scam, 1 → suspicious, 0 → safe.
function baseline(m) {
  const t = m.text.toLowerCase();
  const hits = (redFlags[m.lang] || []).filter((f) => t.includes(String(f.phrase).toLowerCase())).length;
  return hits >= 2 ? "scam" : hits === 1 ? "suspicious" : "safe";
}

// Watch the agent's calls to the server: which backend answered (X-Kavach-Backend) and whether the model
// ever called submit_verdict. Calls are tagged by message via an async-local id.
const { AsyncLocalStorage } = await import("node:async_hooks");
const als = new AsyncLocalStorage();
const calls = new Map(); // id -> [{ backend, submitted }]
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const res = await realFetch(url, opts);
  const id = als.getStore();
  if (id && String(url) === SERVER) {
    const backend = res.headers.get("x-kavach-backend") || "?";
    let submitted = false;
    try {
      const j = await res.clone().json();
      submitted = (j.choices?.[0]?.message?.tool_calls || []).some((c) => c.function?.name === "submit_verdict");
    } catch {}
    calls.get(id).push({ backend, submitted, vision: String(opts?.body || "").includes('"model":"vision"') });
  }
  return res;
};

const codeErrors = [];
agent.CONFIG.onError = (e) => codeErrors.push(String(e && e.message));
async function deep(m) {
  calls.set(m.id, []);
  const t0 = Date.now();
  const v = await als.run(m.id, () => agent.runDeepCheck({ text: m.text }, () => {}));
  const ms = Date.now() - t0;
  const c = calls.get(m.id);
  return {
    verdict: v.verdict, confidence: v.confidence, mode: v.mode, ms,
    requests: c.length,
    hostedFallbacks: c.filter((x) => x.backend.includes("fallback")).length,
    backends: [...new Set(c.map((x) => x.backend.split(" ")[0]))].join("+"),
    finishedLocally: v.mode === "deep" && !c.some((x) => x.submitted)
  };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const t0 = Date.now();
const deepRows = await pool(testSet, CONCURRENCY, deep);
const rows = await Promise.all(testSet.map(async (m, i) => {
  const q0 = Date.now();
  const q = await runQuickCheck(m.text);
  return { id: m.id, lang: m.lang, expected: m.expected, notes: m.notes, deep: deepRows[i], quick: { verdict: q.verdict, confidence: q.confidence, ms: Date.now() - q0 }, baseline: baseline(m) };
}));

const pct = (a, b) => `${a}/${b} (${b ? Math.round((100 * a) / b) : 0}%)`;
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : 0; };
function score(get) {
  const by = (e) => rows.filter((r) => r.expected === e);
  const scam = by("scam"), safe = by("safe");
  return {
    exact: rows.filter((r) => get(r) === r.expected).length,
    caught: scam.filter((r) => get(r) !== "safe").length,
    caughtAsScam: scam.filter((r) => get(r) === "scam").length,
    falseAlarm: safe.filter((r) => get(r) !== "safe").length,
    falseScam: safe.filter((r) => get(r) === "scam").length,
    nScam: scam.length, nSafe: safe.length, n: rows.length,
    byLang: Object.fromEntries(["en", "es", "hi", "zh"].map((l) => [l, rows.filter((r) => r.lang === l && get(r) === r.expected).length])),
    matrix: Object.fromEntries(["scam", "suspicious", "safe"].map((e) => [e, Object.fromEntries(["scam", "suspicious", "safe"].map((g) => [g, by(e).filter((r) => get(r) === g).length]))]))
  };
}
const engines = { "Quick Check": score((r) => r.quick.verdict), "Deep Check": score((r) => r.deep.verdict), "Baseline (phrases only)": score((r) => r.baseline) };
const ms = rows.map((r) => r.deep.ms);
const summary = {
  when: new Date().toISOString(), commit: execSync("git rev-parse --short HEAD", { cwd: REPO, encoding: "utf8" }).trim(),
  setCommit: SET_FILE ? path.relative(REPO, SET_FILE) : execSync("git rev-parse --short origin/data", { cwd: REPO, encoding: "utf8" }).trim(),
  codeRoot: ROOT === REPO ? "repo" : ROOT, n: rows.length, wallMs: Date.now() - t0,
  deepLatency: { median: q(ms, 0.5), p90: q(ms, 0.9), max: Math.max(...ms) },
  deepModeQuick: rows.filter((r) => r.deep.mode !== "deep").length,
  deepFinishedLocally: rows.filter((r) => r.deep.finishedLocally).length,
  deepHostedFallbackRequests: rows.reduce((a, r) => a + r.deep.hostedFallbacks, 0),
  deepRequests: rows.reduce((a, r) => a + r.deep.requests, 0),
  deepBackends: [...new Set(rows.map((r) => r.deep.backends))],
  codeErrors: [...new Set(codeErrors)],
  scamUnsure: rows.filter((r) => r.deep.verdict === "scam" && r.deep.confidence === "unsure").length,
  safeHigh: rows.filter((r) => r.deep.verdict === "safe" && r.deep.confidence === "high").length,
  engines
};

console.log(`\n${rows.length} messages · Deep Check ${CONCURRENCY} at a time · ${(summary.wallMs / 1000).toFixed(1)}s total`);
console.log("| engine | exactly right | scams flagged (scam or suspicious) | scams called scam | safe msgs flagged | safe called scam |");
for (const [k, s] of Object.entries(engines))
  console.log(`| ${k} | ${pct(s.exact, s.n)} | ${pct(s.caught, s.nScam)} | ${pct(s.caughtAsScam, s.nScam)} | ${pct(s.falseAlarm, s.nSafe)} | ${pct(s.falseScam, s.nSafe)} |`);
console.log(`Deep latency median ${summary.deepLatency.median}ms · p90 ${summary.deepLatency.p90}ms · max ${summary.deepLatency.max}ms`);
console.log(`Fallbacks: Deep→Quick ${summary.deepModeQuick} · finished locally ${summary.deepFinishedLocally} · Brev→hosted requests ${summary.deepHostedFallbackRequests}/${summary.deepRequests} · backends ${summary.deepBackends.join(", ")}`);
if (codeErrors.length) console.log(`⚠ ${codeErrors.length} code error(s) — results not valid: ${[...new Set(codeErrors)].join("; ")}`);
console.log(`Rule checks: scam+unsure ${summary.scamUnsure} · safe+high ${summary.safeHigh}`);
console.log("Deep misses:");
for (const r of rows.filter((r) => r.deep.verdict !== r.expected))
  console.log(`  ${r.id} expected ${r.expected} → ${r.deep.verdict}/${r.deep.confidence} (quick ${r.quick.verdict}) — ${r.notes}`);
if (OUT) writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2));
