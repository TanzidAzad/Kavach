// core/quickcheck.test.js — Role 2 (Core Engine)
// Tests runQuickCheck on sample messages in all 4 languages. Run from the repo root:
//   node core/quickcheck.test.js
// Also runs every message in data/demo_messages.json (Role 4's file).

import { readFile } from "node:fs/promises";
import { runQuickCheck, extractDetails, guessLanguage } from "./quickcheck.js";

let passed = 0;
let failed = 0;
const check = (ok, line) => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${line}`);
};

// Our own samples (made-up numbers and links).
const samples = [
  { name: "es USCIS WhatsApp gift cards", expected: "scam",
    text: "USCIS: Su caso ABC123 tiene un problema. Pague $500 en tarjetas de regalo hoy o será deportado. Responda por WhatsApp." },
  { name: "en IRS gift card", expected: "scam",
    text: "This is the IRS. You owe back taxes. Pay today with Google Play gift cards or you will be arrested." },
  { name: "en lookalike link + case number", expected: "scam",
    text: "USCIS notice: your case EAC12345 is on hold. Verify now at uscis-verify.com/login" },
  { name: "zh lookalike link", expected: "scam",
    text: "美国移民局通知：您的申请有问题。请访问 uscis-gov.top 并用礼品卡付款。" },
  // "scam" with Role 4's full data. With the old placeholder data it's only "suspicious".
  { name: "hi ICE threat crypto", expected: ["scam", "suspicious"],
    text: "आईसीई: आपको देश से निकाला जाएगा। अभी बिटकॉइन में भुगतान करें।" },
  { name: "en only a weird link", expected: "suspicious",
    text: "Your package is waiting. Track it here: irs-refund.net" },
  { name: "en real USCIS update", expected: "safe",
    text: "Your case status has been updated. Sign in to your USCIS online account to see the details." },
  { name: "en real link with valid receipt", expected: "safe",
    text: "Check case EAC1234567890 at https://egov.uscis.gov/casestatus" },
  { name: "en normal chat", expected: "safe",
    text: "Hey, are we still meeting for lunch tomorrow at 1?" }
];

console.log("--- sample messages");
for (const s of samples) {
  const v = await runQuickCheck(s.text);
  const ok = Array.isArray(s.expected) ? s.expected.includes(v.verdict) : v.verdict === s.expected;
  check(ok, `${s.name}: expected=${s.expected} got=${v.verdict}/${v.confidence}`);
  console.log(`        reasons: ${JSON.stringify(v.reasons)}`);
}

console.log("--- data/demo_messages.json");
const demo = JSON.parse(await readFile(new URL("../data/demo_messages.json", import.meta.url), "utf8"));
for (const m of demo) {
  const v = await runQuickCheck(m.text);
  check(v.verdict === m.expected, `${m.id}: expected=${m.expected} got=${v.verdict}`);
}

console.log("--- details & rules");
const d = extractDetails("Visit uscis-help.com/pay, email me at bob@uscis.gov. Caso: XYZ-99.");
check(d.urls.length === 1 && d.urls[0] === "uscis-help.com/pay", `link found, email skipped: ${JSON.stringify(d.urls)}`);
check(d.caseNumber === "XYZ-99", `case number found: ${d.caseNumber}`);
check(extractDetails("Your case status changed").caseNumber === null, "'case status' is not a case number");
check(guessLanguage("Pague hoy por favor") === "es", "guess Spanish");
check(guessLanguage("请付款") === "zh", "guess Chinese");
check(guessLanguage("भुगतान करें") === "hi", "guess Hindi");

const scam = await runQuickCheck(samples[0].text);
check(scam.reasons.length <= 3 && scam.steps.length <= 3, "max 3 reasons and 3 steps");
check(scam.mode === "quick", "mode is quick");
check(scam.officialContact?.agency === "USCIS", "official contact comes from data file");
const phone = scam.officialContact?.phone;
check(phone === null || (/\d{3}/.test(phone) && !/todo/i.test(phone)), `phone is real or hidden, never "TODO" (${phone})`);
const lottery = await runQuickCheck("Congratulations! You were selected in the DV-2027 lottery. Send $850 by Western Union.");
check(lottery.verdict !== "safe", `visa lottery + Western Union is flagged (${lottery.verdict})`);
for (const s of samples.slice(0, 4)) {
  const v = await runQuickCheck(s.text);
  const giftCardReasons = v.reasons.filter((r) => /gift card/i.test(r)).length;
  check(giftCardReasons <= 1, `${s.name}: gift cards mentioned at most once (${giftCardReasons})`);
}
check(scam.reasons.includes("The case number is not a real USCIS format"), "case number reason is plain language");
const safe = await runQuickCheck("hello");
check(safe.verdict === "safe" && safe.confidence === "unsure", "safe is never 'high' confidence");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
