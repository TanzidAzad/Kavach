// core/sensitive.test.js — run from the repo root: node core/sensitive.test.js
// Tests the "asks for private details" rule, alone and inside runQuickCheck.
// All names, numbers and links are made up.

import { findSensitiveRequests, checkSensitiveInfo } from "./sensitive.js";
import { runQuickCheck } from "./quickcheck.js";

let passed = 0;
let failed = 0;
const check = (ok, line) => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${line}`);
};
const kinds = (t) => findSensitiveRequests(t).map((k) => k.id).sort().join(",");

console.log("--- asks for private details (must be found)");
const asks = [
  ["I need your cvc and credit card number", "card_number,cvc"],
  ["Please send me the 6-digit code we just sent to your phone", "otp"],
  ["Reply with your Social Security number to keep your benefits", "ssn"],
  ["To receive the refund, provide your bank account number and routing number", "bank"],
  ["Confirm your online banking login and password here", "password"],
  ["What is your card PIN?", "pin"],
  ["Send us:\n- card number\n- expiry date\n- CVV", "card_number,cvc,expiry"],
  ["Envíe el número de su tarjeta y el código de seguridad de la tarjeta", "card_number,cvc"],
  ["Necesito su número de seguro social y su contraseña", "password,ssn"],
  ["Dígame el código de verificación que le llegó", "otp"],
  ["अपना कार्ड नंबर और सीवीवी भेजें", "card_number,cvc"],
  ["कृपया ओटीपी बताएं", "otp"],
  ["请提供您的银行卡号和安全码", "card_number,cvc"],
  ["请把验证码发给我", "otp"],
  ["请告诉我您的社会安全号和网银密码", "password,ssn"]
];
for (const [text, expected] of asks) {
  const got = kinds(text);
  check(got === expected, `${JSON.stringify(text.slice(0, 50))} → ${got || "(none)"} (expected ${expected})`);
}

console.log("--- mentions but does NOT ask (must stay empty)");
const notAsks = [
  "Your verification code is 482913. Don't share it with anyone.",
  "482913 is your Google verification code.",
  "Enter verification code 551204 to sign in.",
  "We will never ask for your password, PIN, or one-time code by email or text.",
  "The IRS does not initiate contact with taxpayers by email to request personal or financial information.",
  "Your card ending in 4421 was charged $23.50 at Target.",
  "Your account number: 0098-2231. Your statement is ready.",
  "USCIS will never ask you to send your Social Security number by text message.",
  "Nunca compartimos ni pedimos su contraseña o su NIP.",
  "您的验证码是382910，请勿泄露给任何人。",
  "हम कभी भी आपका ओटीपी या पासवर्ड नहीं मांगते।",
  "Please bring your Green Card and passport. Enter your Green Card number on Form I-90.",
  "Your passport expiration date is coming up. Renew it soon.",
  "Can you pin the message about the party?",
  "Hey, did you get the gift card I sent for your birthday?"
];
for (const text of notAsks) {
  const got = kinds(text);
  check(got === "", `${JSON.stringify(text.slice(0, 60))} → ${got || "(none)"}`);
}

console.log("--- tool result shape (PRD 8.1)");
const r = await checkSensitiveInfo("I need your cvc and credit card number");
check(r.tool === "check_sensitive_info" && r.status === "fail" && r.label && r.detail, `fail result: ${r.detail}`);
check(Object.keys(r).every((k) => ["tool", "status", "label", "detail", "source"].includes(k)), "no extra fields");
const p = await checkSensitiveInfo("See you at 6");
check(p.status === "pass", "pass result when nothing is asked");
const one = await checkSensitiveInfo("Send me your SSN");
check(/never ask for this in a message$/.test(one.detail), `singular wording: ${one.detail}`);

console.log("--- inside runQuickCheck");
const quick = [
  // the reported bug: was "safe"
  ["I need your cvc and credit card number", "scam", "high"],
  ["Hi grandma, I lost my phone. Please send me the code you just got by text", "suspicious", "medium"],
  ["Your package is on hold. Confirm your card number to pay the $1.99 fee.", ["suspicious", "scam"]],
  ["Necesito el número de su tarjeta y la fecha de vencimiento", "scam", "high"],
  ["请提供您的银行卡号和密码", "scam", "high"]
];
for (const [text, expected, conf] of quick) {
  const v = await runQuickCheck(text);
  const ok = [].concat(expected).includes(v.verdict) && (!conf || v.confidence === conf);
  check(ok, `${JSON.stringify(text.slice(0, 50))} → ${v.verdict}/${v.confidence}`);
}
const bug = await runQuickCheck("I need your cvc and credit card number");
check(bug.steps.length <= 3 && /card, bank, or login/.test(bug.steps[0]), `first step warns about details: ${bug.steps[0]}`);
check(!bug.steps.join(" ").match(/\d{3}[-.\s]\d{3}/), "no phone number invented in steps");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
