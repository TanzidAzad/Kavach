// agent/toolSchemas.js — Role 3 (Agent & Backend)
// OpenAI-style function schemas for the tools in PRD 8.3, plus submit_verdict
// (args match the Verdict shape in 8.2 minus trace and mode).
// SKELETON: minimal schemas — refine descriptions and params.

const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: { type: "object", properties, required }
  }
});

export const TOOL_SCHEMAS = [
  fn(
    "check_official_contact",
    "Check whether the claimed agency really contacts people this way and accepts this payment method.",
    {
      claimedAgency: { type: "string" },
      channel: { type: "string" },
      paymentMethod: { type: "string" }
    }
  ),
  fn("validate_case_number", "Check if a USCIS receipt number has a valid format.", { caseNumber: { type: "string" } }, ["caseNumber"]),
  fn("check_lookalike_domain", "Check if a link imitates a real government website.", { url: { type: "string" } }, ["url"]),
  fn("find_red_flags", "Find known scam phrases in the message.", { text: { type: "string" }, lang: { type: "string" } }, ["text"]),
  fn("search_guidance", "Search official scam guidance.", { query: { type: "string" } }, ["query"]),
  fn(
    "submit_verdict",
    "Submit the final verdict. Do not write phone numbers or URLs.",
    {
      verdict: { type: "string", enum: ["scam", "suspicious", "safe"] },
      confidence: { type: "string", enum: ["high", "medium", "unsure"] },
      reasons: { type: "array", items: { type: "string" }, maxItems: 3 },
      steps: { type: "array", items: { type: "string" }, maxItems: 3 },
      officialContact: { type: ["object", "null"] },
      familyMessage: { type: "string" }
    },
    ["verdict", "confidence", "reasons", "steps", "familyMessage"]
  )
];
