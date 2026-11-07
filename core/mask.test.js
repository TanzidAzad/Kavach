// core/mask.test.js — Role 2 (Core Engine)
// Tests for core/mask.js. Run from the repo root:
//   node core/mask.test.js
// All numbers below are made up.

import { mask, unmask, unmaskArgs } from "./mask.js";

let passed = 0;
let failed = 0;
const check = (ok, line) => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${line}`);
};

function hides(name, text, secrets) {
  const { masked, map } = mask(text);
  const leaked = secrets.filter((s) => masked.includes(s));
  check(leaked.length === 0, `${name}: "${masked}"${leaked.length ? "  LEAKED: " + leaked : ""}`);
  return { masked, map };
}

console.log("--- hides personal details");
hides("receipt", "Your case EAC1234567890 was approved", ["EAC1234567890"]);
hides("receipt with dashes", "Receipt: EAC-12-345-67890", ["EAC-12-345-67890"]);
hides("bad case number after 'caso'", "Su caso ABC123 tiene un problema", ["ABC123"]);
hides("A-number", "A-Number: A123456789", ["123456789"]);
hides("A-number no prefix", "A-Number: 12345678", ["12345678"]);
hides("SSN dashes", "SSN 123-45-6789", ["123-45-6789", "6789"]);
hides("SSN no dashes", "Social Security number: 123456789", ["123456789"]);
hides("phone formats", "Call (214) 555-0123 or 214.555.0199 or +1 469 555 0100",
  ["555-0123", "555.0199", "555 0100"]);
hides("email", "Write to maria.lopez@gmail.com", ["maria.lopez@gmail.com"]);
hides("chinese case", "您的案件号 ABC12345 有问题", ["ABC12345"]);
hides("hindi case", "आपका केस नंबर XYZ987 रद्द", ["XYZ987"]);

console.log("--- leaves normal text alone");
const plain = "Pay $500 in gift cards today. Visit uscis-help.com. Your case status changed.";
check(mask(plain).masked === plain, "no personal details → text unchanged");

console.log("--- repeats and unmask");
const { masked, map } = mask("Call 214-555-0123 now. Again: 214-555-0123. Or 972-555-0188. Case EAC1234567890.");
check(masked === "Call [PHONE_1] now. Again: [PHONE_1]. Or [PHONE_2]. Case [RECEIPT_1].", `same value same label: "${masked}"`);
check(unmask("[RECEIPT_1]", map) === "EAC1234567890", "unmask one placeholder");
check(unmask("call [PHONE_2] today", map) === "call 972-555-0188 today", "unmask inside a sentence");
check(unmask("[PHONE_9]", map) === "[PHONE_9]", "unknown placeholder stays as is");
check(unmask(masked, map) === "Call 214-555-0123 now. Again: 214-555-0123. Or 972-555-0188. Case EAC1234567890.",
  "unmask whole text gives back the original");
const args = unmaskArgs({ caseNumber: "[RECEIPT_1]", list: ["[PHONE_1]"], n: 3 }, map);
check(args.caseNumber === "EAC1234567890" && args.list[0] === "214-555-0123" && args.n === 3, "unmaskArgs on tool arguments");
check(mask("").masked === "" && mask(null).masked === "", "empty input is safe");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
