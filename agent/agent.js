// agent/agent.js — Role 3 (Agent & Backend)
// Contract: PRD section 8.4 — runDeepCheck({ text, imageDataUrl }, onStep) → Promise<Verdict>
// onStep(toolResult) is called each time a tool finishes, so the popup can add a checklist line.
// SKELETON STUB: no network calls. Runs the stub tools with a short delay,
// calls onStep for each, then returns a fixed mock Verdict.
// Real version: VL model for images → mask() → Nemotron tool loop via the server → submit_verdict.

import {
  checkOfficialContact,
  validateCaseNumber,
  findRedFlags,
  searchGuidance
} from "../core/tools.js";
import { mask } from "../core/mask.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runDeepCheck({ text = "", imageDataUrl = null } = {}, onStep = () => {}) {
  const { masked } = mask(text);

  const steps = [
    () => checkOfficialContact({ claimedAgency: "USCIS", channel: "WhatsApp", paymentMethod: "gift card" }),
    () => validateCaseNumber("[RECEIPT_1]"),
    () => findRedFlags(masked, "en"),
    () => searchGuidance("uscis gift card")
  ];

  const trace = [];
  for (const run of steps) {
    await sleep(400);
    const result = await run();
    trace.push(result);
    onStep(result);
  }

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
    // Real version: replace with the entry from data/official_contacts.json. Never trust the model.
    officialContact: null,
    trace,
    mode: "deep",
    familyMessage:
      "I got a message that says it's from USCIS. Kavach says it looks like a scam. Can you help me check it before I do anything?"
  };
}
