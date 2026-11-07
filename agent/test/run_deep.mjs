// agent/test/run_deep.mjs — Node harness for runDeepCheck (needs the server running on :8787).
// Usage: node agent/test/run_deep.mjs [runs=1] [messageId]
// Logs every request body sent to the server and checks no secret (receipt/phone) leaked.
import { runDeepCheck, CONFIG } from "../agent.js";
import { TEST_MESSAGES } from "./messages.js";

const runs = Number(process.argv[2] || 1);
const only = process.argv[3];
// THINK=first,later turns Nemotron thinking on for those turns (default: CONFIG in agent.js).
if (process.env.THINK !== undefined) {
  CONFIG.thinkFirstTurn = process.env.THINK.includes("first");
  CONFIG.thinkLaterTurns = process.env.THINK.includes("later");
}
console.log(`thinking: first=${CONFIG.thinkFirstTurn} later=${CONFIG.thinkLaterTurns}`);

// Wrap fetch: record every body sent to our server.
const bodies = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => {
  if (String(url).includes("/api/chat")) bodies.push(String(opts.body ?? ""));
  return realFetch(url, opts);
};

let failures = 0;
const rows = [];
for (let run = 1; run <= runs; run++) {
  for (const m of TEST_MESSAGES.filter((x) => !only || x.id === only)) {
    bodies.length = 0;
    const t0 = Date.now();
    console.log(`\n=== run ${run} · ${m.id} (expect ${m.expect})`);
    const v = await runDeepCheck({ text: m.text }, (r) =>
      console.log(`  +${String(Date.now() - t0).padStart(5)}ms  [${r.status}] ${r.label}: ${r.detail}`)
    );
    const ms = Date.now() - t0;
    const leaks = m.secrets.filter((s) => bodies.some((b) => b.includes(s)));
    console.log(`  → ${v.mode} ${v.verdict}/${v.confidence} · ${v.trace.length} steps · ${ms}ms · ${bodies.length} requests`);
    console.log(`    reasons: ${JSON.stringify(v.reasons)}`);
    console.log(`    steps:   ${JSON.stringify(v.steps)}`);
    console.log(`    contact: ${v.officialContact ? v.officialContact.agency : "null"} · family: ${v.familyMessage}`);
    console.log(`    privacy: ${leaks.length ? "LEAKED " + leaks.join(", ") : "ok (no secrets in request bodies)"}`);

    const problems = [];
    if (leaks.length) problems.push("leak");
    if (v.mode !== "deep") problems.push("fell back to quick");
    if (ms > 15500) problems.push("too slow");
    if (m.expect === "scam" && v.verdict !== "scam") problems.push("expected scam");
    if (m.expect === "safe" && v.verdict === "scam") problems.push("safe came back as scam");
    if (v.verdict === "safe" && v.confidence === "high") problems.push("safe+high");
    if (m.id === "es-uscis-whatsapp" && v.trace.length < 4) problems.push("<4 steps");
    if (problems.length) failures++;
    console.log(`    ${problems.length ? "FAIL: " + problems.join(", ") : "PASS"}`);
    rows.push({ run, id: m.id, verdict: v.verdict, conf: v.confidence, steps: v.trace.length, ms, mode: v.mode, ok: !problems.length });
  }
}
console.log("\nSummary:");
console.table(rows);
console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures ? 1 : 0);
