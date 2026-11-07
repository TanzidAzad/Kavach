// core/tools.test.js — Role 2 (Core Engine)
// Quick tests for core/tools.js. Run from the repo root:
//   node core/tools.test.js
// Prints PASS/FAIL for each case and a total at the end.

import {
  checkOfficialContact,
  validateCaseNumber,
  checkLookalikeDomain,
  findRedFlags,
  searchGuidance,
  checkDomainAge
} from "./tools.js";

let passed = 0;
let failed = 0;

async function expect(name, promise, wantStatus) {
  const r = await promise;
  const ok = r.status === wantStatus;
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  → ${r.status}: ${r.detail}`);
}

console.log("--- validateCaseNumber");
await expect("valid receipt", validateCaseNumber("EAC1234567890"), "pass");
await expect("valid with dashes", validateCaseNumber("eac-12-345-67890"), "pass");
await expect("too short", validateCaseNumber("ABC123"), "fail");
await expect("digits only", validateCaseNumber("1234567890123"), "fail");
await expect("missing", validateCaseNumber(""), "unknown");
await expect("none found", validateCaseNumber("none found"), "unknown");
await expect("placeholder not unmasked", validateCaseNumber("[RECEIPT_1]"), "unknown");

console.log("--- checkLookalikeDomain");
await expect("real uscis", checkLookalikeDomain("https://www.uscis.gov/scams"), "pass");
await expect("real subdomain", checkLookalikeDomain("my.uscis.gov"), "pass");
await expect("fake uscis", checkLookalikeDomain("http://uscis-help.com/pay"), "fail");
await expect("fake .gov.co", checkLookalikeDomain("uscis.gov.co"), "fail");
await expect("fake irs", checkLookalikeDomain("irs-refund.net"), "fail");
await expect("fake irs glued", checkLookalikeDomain("irsrefund.com"), "fail");
await expect("unicode lookalike", checkLookalikeDomain("http://uscіs.gov.example.com"), "fail");
await expect("normal site", checkLookalikeDomain("https://www.google.com"), "pass");
await expect("not irs (first)", checkLookalikeDomain("firstbank.com"), "pass");
await expect("no link", checkLookalikeDomain(""), "unknown");

console.log("--- checkOfficialContact");
await expect("USCIS on WhatsApp", checkOfficialContact({ claimedAgency: "USCIS", channel: "WhatsApp" }), "fail");
await expect("USCIS gift cards", checkOfficialContact({ claimedAgency: "uscis", paymentMethod: "gift card" }), "fail");
await expect("IRS bitcoin", checkOfficialContact({ claimedAgency: "IRS", paymentMethod: "bitcoin" }), "fail");
await expect("USCIS by mail", checkOfficialContact({ claimedAgency: "USCIS", channel: "mail" }), "pass");
await expect("email is not mail", checkOfficialContact({ claimedAgency: "IRS", channel: "email" }), "fail");
await expect("no agency", checkOfficialContact({ channel: "WhatsApp" }), "unknown");
await expect("unknown agency", checkOfficialContact({ claimedAgency: "NASA" }), "unknown");

console.log("--- findRedFlags");
await expect("english gift card", findRedFlags("Pay with a Gift Card today", "en"), "fail");
await expect("spanish", findRedFlags("Pague en tarjetas de regalo", "es"), "fail");
await expect("wrong lang guess", findRedFlags("Pague en tarjetas de regalo", "en"), "fail");
await expect("hindi", findRedFlags("गिफ्ट कार्ड से भुगतान करें", "hi"), "fail");
await expect("chinese", findRedFlags("请用礼品卡付款", "zh"), "fail");
await expect("english plural", findRedFlags("Buy two GIFT CARDS now", "en"), "fail");
await expect("no partial word", findRedFlags("We sell giftcardholders", "en"), "pass");
await expect("clean text",findRedFlags("Your case status was updated.", "en"), "pass");

console.log("--- searchGuidance");
await expect("uscis gift card", searchGuidance("uscis gift card payment"), "fail");
await expect("only 'uscis'", searchGuidance("uscis case status"), "unknown");
await expect("empty", searchGuidance(""), "unknown");

console.log("--- checkDomainAge (stretch)");
await expect("not built yet", checkDomainAge("uscis-help.com"), "unknown");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
