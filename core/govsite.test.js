// core/govsite.test.js — run from the repo root: node core/govsite.test.js
// Real government pages the user is ON are never flagged; scam messages that link to fake sites still are.
import { checkGovSite, govSiteVerdict, isGovHost } from "./govsite.js";
import { runQuickCheck } from "./quickcheck.js";
import { scamLevel } from "./level.js";

let passed = 0;
let failed = 0;
const check = (ok, name, info = "") => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + info}`);
};

// The real FTC report form: its own text is full of scam words.
const FTC_PAGE =
  "ReportFraud.ftc.gov — Report fraud. Did someone contact you pretending to be from the government, IRS or " +
  "USCIS? Did they ask you to pay with gift cards, wire transfer or crypto? Did they threaten arrest or " +
  "deportation? Tell us what happened. Scammers may ask for your Social Security number or bank account.";

// 1. The page the user is on → verified → the panel/screen short-circuits to "unlikely".
for (const url of [
  "https://reportfraud.ftc.gov/form/main",
  "https://www.uscis.gov/scams-fraud-and-misconduct/avoid-scams/common-scams",
  "https://www.irs.gov/help/tax-scams",
  "https://www.army.mil/",
  "uscis.gov"
]) {
  const site = await checkGovSite(url);
  const level = scamLevel(govSiteVerdict(site));
  check(site.verified && level === "unlikely", `${url} → not flagged`, JSON.stringify({ site, level }));
}
const ftc = await checkGovSite("https://reportfraud.ftc.gov/form/main");
check(ftc.reason === "This is a real U.S. government website (ends in .gov).", "reason says ends in .gov", ftc.reason);
check(govSiteVerdict(ftc).verdict === "safe", "verdict is safe");

// Without the guard the FTC page text really would be flagged — that's the bug this fixes.
const raw = await runQuickCheck(FTC_PAGE);
console.log(`info  FTC page text through Quick Check alone: ${raw.verdict}/${raw.confidence} (guard skips this)`);

// 2. Lookalikes are NOT verified.
for (const url of [
  "https://uscis-help.top/verify",
  "https://irs.gov.refund-center.com",
  "https://uscis.gov-case.info",
  "https://xn--usis-n5a.gov",  // punycode lookalike (not a real .gov registration)
  "https://mail.google.com/mail/u/0/#inbox/abc",
  "file:///C:/irs.gov",
  ""
]) {
  check(!(await checkGovSite(url)).verified, `${url || "(empty)"} → not verified`);
}
check(isGovHost("ssa.gov") && !isGovHost("ssa.gov.top") && !isGovHost("gov"), "isGovHost basics");

// 3. A scam email (read on Gmail, or pasted) that links to uscis-help.top → still flagged.
const SCAM =
  "USCIS ALERT: Your green card case has a problem. Verify now at https://uscis-help.top/verify or you will be " +
  "deported. Pay the $500 fee with Google Play gift cards today. Call 202-555-0147.";
const gmail = await checkGovSite("https://mail.google.com/mail/u/0/#inbox/FMfcg");
const v = await runQuickCheck(SCAM);
check(!gmail.verified && v.verdict !== "safe" && scamLevel(v) !== "unlikely",
  "scam email linking to uscis-help.top → still flagged", `${v.verdict}/${v.confidence}`);

// 4. A pasted message that merely MENTIONS irs.gov is checked as usual (the guard is for the page address only).
const MENTIONS = "This is the IRS. Ignore irs.gov, pay your tax debt today with Apple gift cards or you will be arrested.";
const m = await runQuickCheck(MENTIONS);
check(m.verdict !== "safe", "pasted message mentioning irs.gov → still checked and flagged", `${m.verdict}/${m.confidence}`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
