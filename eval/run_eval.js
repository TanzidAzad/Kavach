// eval/run_eval.js — Role 4 (Data, Demo & Pitch)
// Runs Quick Check on every message in data/demo_messages.json and prints accuracy.
// SKELETON: works against the stub engine, so the numbers are meaningless for now.
// Usage (from the repo root): node eval/run_eval.js

import { readFile } from "node:fs/promises";
import { runQuickCheck } from "../core/quickcheck.js";

const url = new URL("../data/demo_messages.json", import.meta.url);
const messages = JSON.parse(await readFile(url, "utf8"));

let correct = 0;
for (const m of messages) {
  const result = await runQuickCheck(m.text);
  const ok = result.verdict === m.expected;
  if (ok) correct++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${m.id}  expected=${m.expected}  got=${result.verdict}`);
}
console.log(`\n${correct}/${messages.length} correct`);
