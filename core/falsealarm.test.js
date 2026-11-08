// core/falsealarm.test.js — run from the repo root: node core/falsealarm.test.js
// Real-looking SAFE emails and chats. The on-page card (content/detect.js) shows only when
// Quick Check says "scam" (2+ warning signs), so none of these may be "scam".
// The strict list must also not be "suspicious".
// Texts are modelled on real government / bank notices; names, numbers and links are made up.

import { runQuickCheck } from "./quickcheck.js";

let passed = 0;
let failed = 0;
const check = (ok, line) => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${line}`);
};

// Must come out "safe".
const strict = [
  ["USCIS case status email", `Case Status Update
This is an automated message from U.S. Citizenship and Immigration Services. Please do not reply to this email.
The status of your case, receipt number IOE0912345678, has been updated. To view your case status, sign in to your USCIS online account at https://my.uscis.gov.
Thank you,
U.S. Citizenship and Immigration Services`],
  ["USCIS biometrics reminder", `Reminder: Your biometrics appointment is scheduled for November 14, 2026 at 9:00 AM at the Dallas Application Support Center. Bring your appointment notice and a photo ID. For more information visit https://www.uscis.gov.`],
  ["IRS online account notice", `You have a new notice in your IRS Online Account. Sign in at https://www.irs.gov/account to view it.
The IRS does not initiate contact with taxpayers by email, text messages or social media channels to request personal or financial information.`],
  ["Bank statement email", `Your October statement is ready. Your checking account ending in 4421 had 12 transactions. Sign in to the app to view your statement. We will never ask for your password, PIN, or one-time code by email, text, or phone.`],
  ["2FA code SMS", "Your Google verification code is 482913. Don't share it with anyone."],
  ["Chat: lunch", "Hey! Are we still on for lunch tomorrow at 1? I can pick you up."],
  ["Chat: family", "Mom said dinner is at 7. Can you bring the rice cooker? Also the Wi-Fi password is on the fridge."],
  ["Chat (es)", "Hola mija, ¿ya llegaste a casa? Llámame cuando puedas. Te quiero."],
  ["Chat (hi)", "कल शाम को मंदिर चलेंगे? मम्मी ने खाना बनाया है।"],
  ["Chat (zh)", "明天下午三点开会，别忘了带笔记本电脑。"],
  ["Order shipped", "Your order #112-5523 has shipped and will arrive Tuesday. Track your package in your account."]
];

// May be "suspicious" (honest mentions of scams), but must NOT be "scam" — or the card would pop up.
const noCard = [
  ["IRS scam-warning newsletter", `IRS Tax Tip: Watch out for scams. The IRS will never call to demand immediate payment using gift cards, prepaid debit cards or wire transfers. The IRS does not threaten to bring in local police or immigration officers to have taxpayers arrested. Report scams at https://www.irs.gov.`],
  ["USCIS scam-warning page text", `Avoid scams. USCIS will never ask you to pay by gift card, Western Union, MoneyGram or PayPal. We do not accept payments over the phone or by email. Only pay fees as described at https://www.uscis.gov/fees.`],
  ["FTC consumer alert", `Scammers pretend to be from the government. They might say you owe taxes or that you will be deported. Never pay with gift cards, cryptocurrency, or a wire transfer to someone who contacts you out of the blue.`],
  ["Password reset email", "We received a request to reset your password. If this was you, click the link below. If not, you can ignore this email."]
];

console.log("--- must be safe");
for (const [name, text] of strict) {
  const v = await runQuickCheck(text);
  check(v.verdict === "safe", `${name}: ${v.verdict}/${v.confidence}  ${v.verdict !== "safe" ? JSON.stringify(v.reasons) : ""}`);
}
console.log("--- must not trigger the card (not 'scam')");
for (const [name, text] of noCard) {
  const v = await runQuickCheck(text);
  check(v.verdict !== "scam", `${name}: ${v.verdict}/${v.confidence}  ${v.verdict === "scam" ? JSON.stringify(v.reasons) : ""}`);
}

// Scams that copy a warning line must still be caught.
console.log("--- scams that copy a warning line are still caught");
const sneaky = [
  "USCIS never asks for gift cards. But your case is special. Pay $500 in Google Play cards today or you will be deported.",
  "USCIS never asks for gift cards, but your case is special: pay $500 in Google Play cards today or you will be deported.",
  "IRS: Do not ignore this. Pay with Bitcoin within 24 hours or you will be arrested."
];
for (const text of sneaky) {
  const v = await runQuickCheck(text);
  check(v.verdict === "scam", `${JSON.stringify(text.slice(0, 55))}: ${v.verdict}/${v.confidence}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
