// core/level.test.js — run from the repo root: node core/level.test.js
import { scamLevel } from "./level.js";

let passed = 0;
let failed = 0;
const check = (got, expected, name) => {
  const ok = got === expected;
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: expected=${expected} got=${got}`);
};

check(scamLevel({ verdict: "scam", confidence: "high" }), "highly_likely", "scam + high");
check(scamLevel({ verdict: "scam", confidence: "medium" }), "likely", "scam + medium");
check(scamLevel({ verdict: "scam", confidence: "unsure" }), "unsure", "scam + unsure");
check(scamLevel({ verdict: "suspicious", confidence: "medium" }), "unsure", "suspicious + medium");
check(scamLevel({ verdict: "suspicious", confidence: "high" }), "unsure", "suspicious + high");
check(scamLevel({ verdict: "safe", confidence: "unsure" }), "unlikely", "safe");
check(scamLevel({ verdict: "SCAM", confidence: "HIGH" }), "highly_likely", "upper case");
check(scamLevel("safe"), "unlikely", "plain string 'safe'");
check(scamLevel("scam"), "unsure", "plain string 'scam' (no confidence)");
check(scamLevel(null), "unsure", "null");
check(scamLevel(undefined), "unsure", "undefined");
check(scamLevel({}), "unsure", "empty object");
check(scamLevel({ verdict: "banana" }), "unsure", "unknown verdict word");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
