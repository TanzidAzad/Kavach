// agent/test/sanitize.test.mjs — unit tests for agent/sanitize.js (no server needed).
// Run: node agent/test/sanitize.test.mjs
import { cleanText, cleanList, pickFamilyMessage, isFirstPerson, hasDoubledWord } from "../sanitize.js";

const CLEAN = [
  // the exact broken strings we saw on screen
  ["Do not share your the case number with anyone", "Do not share the case number with anyone"],
  ["Do not click a the website link", "Do not click the link"],
  // the model inputs that produced them
  ["Do not share your [RECEIPT_1] with anyone", "Do not share the case number with anyone"],
  ["Do not click a http://uscis-gov-help.com link", "Do not click the link"],
  ["Do not click a uscis-gov-help.com link.", "Do not click the link."],
  ["The case number [RECEIPT_1] is fake", "The case number is fake"],
  ["Do not call [PHONE_1] or 214-555-0143", "Do not call that phone number"],
  ["Call the number (469) 555-0187 now", "Call that phone number now"],
  ["Do not call the phone number [PHONE_1].", "Do not call that phone number."],
  ["Check your case at my.uscis.gov", "Check your case at the official website"],
  ["Go to the official site uscis.gov", "Go to the official website"],
  ["Do not do do this", "Do not do this"],
  ["Email [EMAIL_1] is not official", "That email address is not official"],
  ["USCIS does not use WhatsApp", "USCIS does not use WhatsApp"],
  ["Pay $500 by May 14", "Pay $500 by May 14"],
  ["The link pretends to be a .gov website", "The link pretends to be a .gov website"],
  ["Verify through the official USCIS website (uscis.gov)", "Verify through the official USCIS website"],
  ["Do not reply to [PHONE_1] .", "Do not reply to that phone number."]
];

const FAMILY = [
  // [raw model text, should keep it?]
  ["I got a message that says it's from USCIS. It asks me to pay with gift cards. Can you help me check it?", true],
  ["You received a scam message from USCIS. Do not pay.", false], // not first person
  ["I got a message about case [RECEIPT_1]. Can you help?", false], // placeholder
  ["I got a message from 214-555-0143. Can you help?", false], // phone
  ["I got a message. It is bad. It wants money. Kavach says scam. Help?", false], // >3 sentences
  ["", false]
];

let fails = 0;
const check = (ok, msg) => {
  if (!ok) {
    fails++;
    console.log("  FAIL " + msg);
  }
};

for (const [input, want] of CLEAN) {
  const got = cleanText(input);
  check(got === want, `cleanText(${JSON.stringify(input)}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
check(cleanList(["Ignore this message", "Do not pay", "do not pay"], 3).length === 2, "cleanList dedupe/ignore");
check(cleanList(["Ignore this message"], 3)[0].startsWith("Do not reply"), "cleanList ignore rule");

const facts = { verdict: "scam", agency: "USCIS", payment: "gift cards", threat: "I'll be deported" };
for (const [raw, keep] of FAMILY) {
  const got = pickFamilyMessage(raw, facts);
  check(keep ? got === raw : got !== raw, `family keep=${keep}: ${JSON.stringify(raw)} → ${JSON.stringify(got)}`);
  check(isFirstPerson(got) && !hasDoubledWord(got) && !/\[|\d{3}/.test(got), `family output bad: ${got}`);
}
console.log("  template: " + pickFamilyMessage("", facts));

export const sanitizeFailures = fails;
console.log(fails ? `sanitizer: ${fails} FAILED` : `sanitizer: all ${CLEAN.length + FAMILY.length * 2 + 2} checks passed`);
if (import.meta.url === `file://${process.argv[1]}`) process.exit(fails ? 1 : 0);
