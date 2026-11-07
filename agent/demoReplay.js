// agent/demoReplay.js — Role 3 (Agent & Backend)
// Replays a saved Deep Check run with realistic timing, for when the API is down on stage.
// SKELETON STUB: replays a tiny hardcoded run. Real version: load a recorded run from JSON.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RECORDED_RUN = {
  trace: [
    { tool: "check_official_contact", status: "fail", label: "Sender channel", detail: "USCIS does not contact people on WhatsApp" },
    { tool: "validate_case_number", status: "fail", label: "Case number", detail: "Invalid format (needs 3 letters + 10 digits)" }
  ],
  verdict: {
    verdict: "scam",
    confidence: "high",
    reasons: ["USCIS does not contact people on WhatsApp", "The case number is not a valid format"],
    steps: ["Do not pay or call the number in the message"],
    officialContact: null,
    mode: "deep",
    familyMessage: "I got a message that says it's from USCIS. Kavach says it looks like a scam. Can you help me check it?"
  }
};

export async function replayDemo(onStep = () => {}) {
  for (const step of RECORDED_RUN.trace) {
    await sleep(600);
    onStep(step);
  }
  return { ...RECORDED_RUN.verdict, trace: RECORDED_RUN.trace };
}
