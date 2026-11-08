// eval/run_eval.js — Role 4 (Data, Demo & Pitch)
// Measures how well Quick Check sorts messages into scam / suspicious / safe.
//
// Usage (from the repo root):   node eval/run_eval.js
// Writes the numbers to eval/results.md and prints a summary.
//
// Test set: eval/test_messages.json — 40 messages we wrote ourselves (no T-Mobile set).
// They are deliberately NOT the 8 demo messages, and many scams avoid the exact
// phrases in data/red_flags.json, so a good score can't come from memorising our own list.
//
// Baseline: "phrase match only" — counts red_flags.json phrases in the message
// (2+ → scam, 1 → suspicious, 0 → safe). Quick Check should beat it.
// Deep Check is not measured (it needs the browser + Nemotron API).

import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const readJson = async (p) => JSON.parse(await readFile(new URL(p, root), "utf8"));

const testSet = await readJson("eval/test_messages.json");
const redFlags = await readJson("data/red_flags.json");

const VERDICTS = ["scam", "suspicious", "safe"];
const LANGS = ["en", "es", "hi", "zh"];

// ---------- the two "engines" we compare ----------

function phraseBaseline(m) {
  const text = m.text.toLowerCase();
  const hits = (redFlags[m.lang] || []).filter((f) => text.includes(f.phrase.toLowerCase())).length;
  return { verdict: hits >= 2 ? "scam" : hits === 1 ? "suspicious" : "safe", confidence: "unsure" };
}

let runQuickCheck = null;
let quickCheckLoadError = null;
try {
  ({ runQuickCheck } = await import("../core/quickcheck.js"));
} catch (err) {
  quickCheckLoadError = err.message;
}

async function quickCheck(m) {
  if (!runQuickCheck) return { error: "Quick Check could not be loaded" };
  try {
    const v = await runQuickCheck(m.text);
    return { verdict: v.verdict, confidence: v.confidence };
  } catch (err) {
    return { error: err.message };
  }
}

// ---------- scoring ----------

function score(rows) {
  const n = rows.length;
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "–");
  const correct = rows.filter((r) => r.got === r.m.expected).length;
  const scams = rows.filter((r) => r.m.expected === "scam");
  const caught = scams.filter((r) => r.got === "scam" || r.got === "suspicious").length;
  const safes = rows.filter((r) => r.m.expected === "safe");
  const falseAlarms = safes.filter((r) => r.got === "scam").length;
  const errors = rows.filter((r) => r.got === "error").length;
  const safeHigh = rows.filter((r) => r.got === "safe" && r.confidence === "high").length;

  const confusion = {};
  for (const e of VERDICTS) {
    confusion[e] = {};
    for (const g of [...VERDICTS, "error"]) confusion[e][g] = rows.filter((r) => r.m.expected === e && r.got === g).length;
  }
  const byLang = {};
  for (const l of LANGS) {
    const lr = rows.filter((r) => r.m.lang === l);
    byLang[l] = `${lr.filter((r) => r.got === r.m.expected).length}/${lr.length}`;
  }
  return {
    accuracy: `${correct}/${n} (${pct(correct, n)})`,
    caught: `${caught}/${scams.length} (${pct(caught, scams.length)})`,
    falseAlarms: `${falseAlarms}/${safes.length} (${pct(falseAlarms, safes.length)})`,
    errors,
    safeHigh,
    confusion,
    byLang,
    allSame: new Set(rows.map((r) => r.got)).size === 1
  };
}

async function evaluate(engine) {
  const rows = [];
  for (const m of testSet) {
    const out = await engine(m);
    rows.push({ m, got: out.error ? "error" : out.verdict, confidence: out.confidence, error: out.error });
  }
  return rows;
}

const quickRows = await evaluate(quickCheck);
const baseRows = await evaluate(async (m) => phraseBaseline(m));
const quick = score(quickRows);
const base = score(baseRows);

// ---------- report ----------

let commit = "unknown";
try {
  commit = execSync("git rev-parse --short HEAD", { cwd: new URL(".", root) }).toString().trim();
} catch {}

const counts = Object.fromEntries(VERDICTS.map((v) => [v, testSet.filter((m) => m.expected === v).length]));
const warnings = [];
if (quickCheckLoadError) warnings.push(`Quick Check could not be loaded in Node: ${quickCheckLoadError}`);
if (quick.allSame) warnings.push(`Quick Check gave the same answer ("${quickRows[0].got}") for every message — it is probably still the placeholder stub, so its numbers mean nothing yet.`);
if (quick.errors) warnings.push(`${quick.errors} message(s) crashed Quick Check.`);
if (quick.safeHigh) warnings.push(`${quick.safeHigh} result(s) said "safe" with high confidence — PRD rule 3 forbids this.`);

const confusionTable = (s) =>
  [
    "| Expected ↓ / Got → | scam | suspicious | safe | error |",
    "|---|---|---|---|---|",
    ...VERDICTS.map((e) => `| ${e} | ${s.confusion[e].scam} | ${s.confusion[e].suspicious} | ${s.confusion[e].safe} | ${s.confusion[e].error} |`)
  ].join("\n");

const misses = quickRows
  .filter((r) => r.got !== r.m.expected)
  .map((r) => `| ${r.m.id} | ${r.m.expected} | ${r.got}${r.error ? ` (${r.error})` : ""} | ${r.m.notes} |`);

const md = `# Kavach — Quick Check accuracy

_Generated by \`node eval/run_eval.js\` on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC, commit \`${commit}\`._

## What was measured (read this before quoting numbers)
- **Test set:** ${testSet.length} short messages we wrote ourselves (${counts.scam} scam, ${counts.suspicious} suspicious, ${counts.safe} safe; 10 each in English, Spanish, Hindi, Chinese). Not real-world data, and **no T-Mobile data set was used**.
- The Hindi and Chinese messages have not yet been checked by native speakers.
- Separate from the 8 demo messages. Many scams avoid the exact words in our red-flag list on purpose.
- **Only Quick Check (offline) is measured.** Deep Check needs the browser and the Nemotron API, so it is not in these numbers.
- **Baseline** = "phrase match only": count red-flag phrases (2+ → scam, 1 → suspicious, 0 → safe).
${warnings.length ? "\n## ⚠ Warnings\n" + warnings.map((w) => `- ${w}`).join("\n") + "\n" : ""}
## Results

| | Quick Check | Baseline (phrases only) |
|---|---|---|
| Exactly right | ${quick.accuracy} | ${base.accuracy} |
| Scams caught (flagged scam or suspicious) | ${quick.caught} | ${base.caught} |
| False alarms (safe message called scam) | ${quick.falseAlarms} | ${base.falseAlarms} |
| "Safe" with high confidence (must be 0) | ${quick.safeHigh} | – |
| Crashes | ${quick.errors} | – |

**Exactly right, by language**

| | en | es | hi | zh |
|---|---|---|---|---|
| Quick Check | ${quick.byLang.en} | ${quick.byLang.es} | ${quick.byLang.hi} | ${quick.byLang.zh} |
| Baseline | ${base.byLang.en} | ${base.byLang.es} | ${base.byLang.hi} | ${base.byLang.zh} |

**Quick Check — expected vs. got**

${confusionTable(quick)}

**Baseline — expected vs. got**

${confusionTable(base)}

## Quick Check misses
${misses.length ? "| Message | Expected | Got | What it tests |\n|---|---|---|---|\n" + misses.join("\n") : "None."}
`;

await writeFile(new URL("eval/results.md", root), md);

console.log(`Quick Check  right: ${quick.accuracy}  scams caught: ${quick.caught}  false alarms: ${quick.falseAlarms}`);
console.log(`Baseline     right: ${base.accuracy}  scams caught: ${base.caught}  false alarms: ${base.falseAlarms}`);
for (const w of warnings) console.log("WARNING: " + w);
console.log("Wrote eval/results.md");
