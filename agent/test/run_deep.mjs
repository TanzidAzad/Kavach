// agent/test/run_deep.mjs — hardening harness for runDeepCheck (needs the server running on :8787
// for the live cases). Prints each case's steps, then a pass/fail table.
//
// Usage: node agent/test/run_deep.mjs [rounds=1] [caseId]
//   RECORD=agent/demo_run.json node agent/test/run_deep.mjs 1 es-screenshot   → saves a replay file
//   THINK=first,later …                                                       → Nemotron thinking on
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runDeepCheck, CONFIG, getLastRun, clearCache } from "../agent.js";
import { replayDemo } from "../demoReplay.js";
import { hasUrl, hasPhone, hasPlaceholder, hasDoubledWord, isFirstPerson, sentences } from "../sanitize.js";
import { TEST_MESSAGES } from "./messages.js";
import { sanitizeFailures } from "./sanitize.test.mjs";

const rounds = Number(process.argv[2] || 1);
const only = process.argv[3];
if (process.env.THINK !== undefined) {
  CONFIG.thinkFirstTurn = process.env.THINK.includes("first");
  CONFIG.thinkLaterTurns = process.env.THINK.includes("later");
}
const CACHE_MS = CONFIG.cacheMs;
CONFIG.cacheMs = 0; // every round is a real run; the "cache" case below turns it on
const HERE = new URL(".", import.meta.url);
const png = (name) => {
  const f = new URL(name, HERE);
  return existsSync(f) ? "data:image/png;base64," + readFileSync(f).toString("base64") : null;
};
const msg = (id) => TEST_MESSAGES.find((m) => m.id === id);

// ---------- fake server replies (for cases the real model can't be forced into) ----------
const reply = (message) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });
const isVision = (opts) => String(opts?.body ?? "").includes('"model":"vision"');
let visionCalls = 0;
// Hangs until the agent aborts it (like a stalled hosted request).
const stall = (opts) => new Promise((_, reject) => opts?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
const MOCKS = {
  // First vision request stalls; the hedged 2nd request (real server) must answer. Agent calls are real.
  visionStall: (n, url, opts) => (isVision(opts) && visionCalls++ === 0 ? stall(opts) : null),
  // Vision always errors → "could not read the screenshot" (never "safe").
  visionFails: (n, url, opts) => (isVision(opts) ? new Response('{"error":"down"}', { status: 502 }) : null),
  // Model keeps calling tools / talking and never calls submit_verdict.
  neverSubmits: (n) =>
    n % 2 ? reply({ role: "assistant", content: "I think this is a scam." }) : reply({ role: "assistant", content: "", tool_calls: [call(`c${n}`, "find_red_flags", { lang: "es" })] }),
  // Broken JSON, unknown tool, made-up case number / link, then a garbage submit_verdict.
  malformed: (n) =>
    n === 0
      ? reply({
          role: "assistant",
          content: "",
          tool_calls: [
            call("a", "check_official_contact", "{{{not json"),
            call("b", "hack_the_planet", { x: 1 }),
            call("c", "validate_case_number", { caseNumber: "IRS-12345" }),
            call("d", "check_lookalike_domain", { url: "evil-uscis.com" }),
            call("e", "check_official_contact", { claimedAgency: "USCIS", channel: "carrier pigeon", paymentMethod: "bananas" })
          ]
        })
      : reply({ role: "assistant", content: "", tool_calls: [call("z", "submit_verdict", "verdict: scam, totally {")] })
};

// ---------- cases ----------
const LONG = msg("es-uscis-whatsapp").text + " " + "Por favor lea esto con atención. ".repeat(250);
const CASES = [
  { id: "es-text", text: msg("es-uscis-whatsapp").text, expect: "scam", mode: "deep", minSteps: 4, secrets: msg("es-uscis-whatsapp").secrets },
  { id: "en-irs", text: msg("en-irs-giftcard").text, expect: "scam", mode: "deep", secrets: msg("en-irs-giftcard").secrets },
  { id: "hi-ice", text: msg("hi-ice-threat").text, expect: "scam", mode: "deep", secrets: msg("hi-ice-threat").secrets },
  { id: "zh-lookalike", text: msg("zh-uscis-lookalike").text, expect: "scam", mode: "deep", secrets: [] },
  { id: "en-safe", text: msg("en-uscis-safe").text, expect: "not-scam", mode: "deep", secrets: [] },
  { id: "empty", text: "", expect: "any", mode: "quick", secrets: [] },
  { id: "very-long", text: LONG, expect: "scam", mode: "deep", secrets: ["EAC2490123456", "555-0187"], maxBodyText: 4600 },
  { id: "server-down", text: msg("en-irs-giftcard").text, expect: "scam", mode: "quick", server: "http://localhost:1/api/chat", secrets: [] },
  { id: "never-submits", text: msg("es-uscis-whatsapp").text, expect: "scam", mode: "deep", mock: "neverSubmits", secrets: msg("es-uscis-whatsapp").secrets },
  { id: "malformed-args", text: msg("es-uscis-whatsapp").text, expect: "any", mode: "deep", mock: "malformed", secrets: msg("es-uscis-whatsapp").secrets, noTools: ["hack_the_planet"] },
  { id: "es-screenshot", image: png("es-uscis-whatsapp.png"), file: "es-uscis-whatsapp.png", expect: "scam", mode: "deep", minSteps: 4, needsTool: "read_screenshot", secrets: ["EAC2490123456", "555-0187"] },
  { id: "hi-screenshot", image: png("hi-ice-whatsapp.png"), file: "hi-ice-whatsapp.png", expect: "scam", mode: "deep", needsTool: "read_screenshot", secrets: ["972-555-0199"] },
  { id: "vision-stall", image: png("hi-ice-whatsapp.png"), file: "hi-ice-whatsapp.png", expect: "scam", mode: "deep", mock: "visionStall", needsTool: "read_screenshot", secrets: ["972-555-0199"] },
  { id: "vision-fails", image: png("hi-ice-whatsapp.png"), file: "hi-ice-whatsapp.png", expect: "suspicious", mode: "quick", mock: "visionFails", needsTool: "read_screenshot", secrets: [] },
  { id: "replay", replay: true, expect: "scam", mode: "deep", minSteps: 4, secrets: [] }
];

// ---------- checks ----------
function verdictProblems(v) {
  const p = [];
  if (!v || typeof v !== "object") return ["no verdict"];
  if (!["scam", "suspicious", "safe"].includes(v.verdict)) p.push("bad verdict");
  if (!["high", "medium", "unsure"].includes(v.confidence)) p.push("bad confidence");
  for (const k of ["reasons", "steps"]) {
    if (!Array.isArray(v[k]) || v[k].length > 3 || v[k].some((s) => typeof s !== "string")) p.push(`bad ${k}`);
    else if (v[k].some((s) => hasUrl(s) || hasPhone(s))) p.push(`${k} has link/phone`);
    else if (v[k].some(hasDoubledWord)) p.push(`${k} doubled word`);
    else if (v[k].some((s) => /\[[A-Z]+_\d+\]/.test(s))) p.push(`${k} placeholder`);
  }
  const c = v.officialContact;
  if (c !== null && !(c && typeof c.agency === "string" && "url" in c && "phone" in c)) p.push("bad officialContact");
  if (!Array.isArray(v.trace) || v.trace.some((r) => !r || !r.tool || !["fail", "pass", "unknown"].includes(r.status) || !r.label || typeof r.detail !== "string"))
    p.push("bad trace");
  if (!["quick", "deep"].includes(v.mode)) p.push("bad mode");
  const f = String(v.familyMessage ?? "");
  if (!isFirstPerson(f)) p.push("family not first person");
  if (hasPlaceholder(f) || hasUrl(f) || hasPhone(f)) p.push("family has placeholder/link/phone");
  if (sentences(f).length > 3) p.push("family >3 sentences");
  if (v.verdict === "safe" && v.confidence === "high") p.push("safe+high");
  if (v.verdict === "scam" && v.confidence === "unsure") p.push("scam+unsure");
  if (v.verdict === "safe" && (v.trace || []).some((r) => r.status === "fail" && r.tool !== "search_guidance")) p.push("safe with a failed check");
  return p;
}

const CASE_RE = /\b[A-Z]{3}\d{10}\b/;
const PHONE_RE = /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/;

const realFetch = globalThis.fetch;
const defaultServer = process.env.SERVER || CONFIG.serverUrl; // SERVER=http://localhost:8790/api/chat to test another server
const rows = [];
let failures = sanitizeFailures ? 1 : 0;
rows.push({ round: "-", case: "sanitizer unit tests", verdict: "-", conf: "-", steps: "-", ms: "-", mode: "-", result: sanitizeFailures ? "FAIL" : "PASS" });

for (let round = 1; round <= rounds; round++) {
  for (const c of CASES.filter((x) => !only || x.id === only)) {
    if (c.file !== undefined && !c.image) {
      console.log(`\n=== ${c.id}: SKIPPED — agent/test/${c.file} not found (make it with agent/test/make_screenshot.html)`);
      rows.push({ round, case: c.id, verdict: "-", conf: "-", steps: "-", ms: "-", mode: "-", result: "SKIP (no PNG)" });
      continue;
    }
    if (c.replay && !existsSync(new URL("../demo_run.json", HERE))) {
      rows.push({ round, case: c.id, verdict: "-", conf: "-", steps: "-", ms: "-", mode: "-", result: "SKIP (no demo_run.json)" });
      continue;
    }
    // per-case fetch: record bodies, optionally mock the server
    const bodies = [];
    let n = 0;
    CONFIG.serverUrl = c.server || defaultServer;
    globalThis.fetch = async (url, opts = {}) => {
      if (String(url).includes("/api/chat")) {
        bodies.push(String(opts.body ?? ""));
        if (c.mock) { const r = await MOCKS[c.mock](n++, url, opts); if (r) return r; }
      }
      return realFetch(url, opts);
    };

    console.log(`\n=== round ${round} · ${c.id}`);
    visionCalls = 0;
    const codeErrors = []; // bugs in our code that runDeepCheck caught and fell back from
    CONFIG.onError = (e) => { if (!/fetch failed|abort|timeout/i.test(String(e && e.message)) || e instanceof ReferenceError) codeErrors.push(e); };
    const t0 = Date.now();
    let v;
    let threw = null;
    try {
      const onStep = (r) => console.log(`  +${String(Date.now() - t0).padStart(5)}ms  [${r.status}] ${r.label}: ${r.detail}`);
      v = c.replay ? await replayDemo(onStep) : await runDeepCheck({ text: c.text ?? "", imageDataUrl: c.image ?? null }, onStep);
    } catch (e) {
      threw = e;
    }
    const ms = Date.now() - t0;
    globalThis.fetch = realFetch;

    const problems = threw ? ["THREW " + threw.message] : verdictProblems(v);
    if (!threw) {
      console.log(`  → ${v.mode} ${v.verdict}/${v.confidence} · ${v.trace.length} steps · ${ms}ms · ${bodies.length} requests`);
      console.log(`    reasons: ${JSON.stringify(v.reasons)}`);
      console.log(`    steps:   ${JSON.stringify(v.steps)}`);
      console.log(`    family:  ${v.familyMessage}`);
      if (ms > 15500) problems.push("over 15s");
      for (const e of codeErrors) problems.push("CODE ERROR " + (e && e.message));
      if (c.mode && v.mode !== c.mode) problems.push(`mode ${v.mode}≠${c.mode}`);
      if (c.expect === "scam" && v.verdict !== "scam") problems.push("expected scam");
      if (c.expect === "suspicious" && v.verdict !== "suspicious") problems.push("expected suspicious");
      if (c.expect === "not-scam" && v.verdict === "scam") problems.push("safe came back as scam");
      if (c.minSteps && v.trace.length < c.minSteps) problems.push(`<${c.minSteps} steps`);
      if (c.needsTool && !v.trace.some((r) => r.tool === c.needsTool)) problems.push(`no ${c.needsTool} step`);
      if (c.noTools && v.trace.some((r) => c.noTools.includes(r.tool))) problems.push("junk tool in trace");
      // privacy: no case number / phone in anything sent to /api/chat
      const agentBodies = bodies.map((b) => {
        try {
          const j = JSON.parse(b);
          return j.model === "vision" ? "" : b; // vision body = the image itself (sent as pixels, by design)
        } catch {
          return b;
        }
      });
      const leaks = c.secrets.filter((s) => bodies.some((b) => b.includes(s)));
      if (leaks.length) problems.push("LEAK " + leaks.join(","));
      if (agentBodies.some((b) => CASE_RE.test(b) || PHONE_RE.test(b))) problems.push("case/phone pattern in request");
      if (c.maxBodyText) {
        const longest = Math.max(0, ...agentBodies.map((b) => {
          try {
            return JSON.parse(b).messages.find((m) => m.role === "user")?.content?.length || 0;
          } catch {
            return 0;
          }
        }));
        if (longest > c.maxBodyText) problems.push(`input not capped (${longest} chars)`);
      }
    }
    if (problems.length) failures++;
    console.log(`    ${problems.length ? "FAIL: " + problems.join(", ") : "PASS"}`);
    rows.push({
      round,
      case: c.id,
      verdict: v?.verdict ?? "-",
      conf: v?.confidence ?? "-",
      steps: v?.trace?.length ?? "-",
      ms,
      mode: v?.mode ?? "-",
      result: problems.length ? "FAIL: " + problems.join(", ") : "PASS"
    });

    if (process.env.RECORD && c.id === "es-screenshot" && !problems.length) {
      const rec = getLastRun();
      const json = JSON.stringify(rec, null, 2);
      if (rec && !c.secrets.some((s) => json.includes(s))) {
        writeFileSync(process.env.RECORD, json + "\n");
        console.log(`    recorded → ${process.env.RECORD}`);
      }
    }
  }
}
CONFIG.serverUrl = defaultServer;
globalThis.fetch = realFetch;

// Cache: same message twice → 2nd is instant, identical, steps replayed; other case number → real run;
// demo replay on → cache not used.
if (!only || only === "cache") {
  console.log("\n=== cache");
  CONFIG.cacheMs = CACHE_MS;
  clearCache();
  const es = msg("es-uscis-whatsapp").text;
  const timeIt = async (input) => { const t0 = Date.now(); const st = []; const v = await runDeepCheck(input, (r) => st.push(r)); return { v, st, ms: Date.now() - t0 }; };
  const a = await timeIt({ text: es });
  const b = await timeIt({ text: es });
  const c = await timeIt({ text: es.replace("EAC2490123456", "EAC2490999999") });
  globalThis.localStorage = { _: { kavach_demo_replay: "true" }, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = v; }, removeItem(k) { delete this._[k]; } };
  const d = await timeIt({ text: es });
  delete globalThis.localStorage;
  CONFIG.cacheMs = 0;
  const p = [];
  if (a.v.mode !== "deep") p.push("1st not deep");
  if (b.ms > 50) p.push(`2nd took ${b.ms}ms`);
  if (JSON.stringify(a.v) !== JSON.stringify(b.v)) p.push("2nd verdict differs");
  if (b.st.length !== a.st.length) p.push(`2nd replayed ${b.st.length}/${a.st.length} steps`);
  if (c.ms < 300) p.push("other case number was served from cache");
  const recSteps = JSON.parse(readFileSync(new URL("../demo_run.json", import.meta.url), "utf8")).steps.length;
  if (d.ms < 3000 || d.st.length !== recSteps) p.push(`replay flag on but cache answered (${d.st.length}/${recSteps} steps)`);
  console.log(`  1st ${a.ms}ms · 2nd ${b.ms}ms (${b.st.length} steps) · other case number ${c.ms}ms · replay on ${d.ms}ms`);
  if (p.length) failures++;
  rows.push({ round: "-", case: "cache (10 min)", verdict: b.v.verdict, conf: b.v.confidence, steps: b.st.length, ms: `${a.ms}→${b.ms}`, mode: b.v.mode, result: p.length ? "FAIL: " + p.join(", ") : "PASS" });
}

console.log("\n| round | case | verdict | conf | steps | ms | mode | result |\n|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.round} | ${r.case} | ${r.verdict} | ${r.conf} | ${r.steps} | ${r.ms} | ${r.mode} | ${r.result} |`);
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
