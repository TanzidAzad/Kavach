// core/quickcheck.js — Role 2 (Core Engine)
// Contract: PRD section 8.2 (Verdict) and 8.4 (runQuickCheck).
// SKELETON STUB: runs the stub tools and returns a fixed mock Verdict.
// Real version: detect language, extract details with regex, run tools, score.

import {
  checkOfficialContact,
  validateCaseNumber,
  checkLookalikeDomain,
  findRedFlags
} from "./tools.js";

export async function runQuickCheck(text) {
  const trace = [
    await checkOfficialContact({ claimedAgency: "USCIS", channel: "WhatsApp", paymentMethod: "gift card" }),
    await validateCaseNumber("ABC123"),
    await checkLookalikeDomain(""),
    await findRedFlags(text, "en")
  ];

  return {
    verdict: "scam",
    confidence: "high",
    reasons: [
      "USCIS does not contact people on WhatsApp",
      "The case number is not a valid format",
      "It asks for payment with gift cards"
    ],
    steps: [
      "Do not pay or call the number in the message",
      "Check your case only on the official USCIS website"
    ],
    // Real version: copy this entry from data/official_contacts.json. Never invent it.
    officialContact: null,
    trace,
    mode: "quick",
    familyMessage:
      "I got a message that says it's from USCIS. Kavach says it looks like a scam. Can you help me check it before I do anything?"
  };
}
