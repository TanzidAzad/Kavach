// agent/toolSchemas.js — Role 3 (Agent & Backend)
// OpenAI-style function schemas for the tools in PRD 8.3, plus submit_verdict
// (args match the Verdict shape in 8.2 minus trace, mode, and officialContact —
// the model only names the agency; the real contact is looked up from data/).
//
// Parameters match the REAL signatures in core/tools.js:
//   checkOfficialContact({ claimedAgency, channel, paymentMethod })  ← one object
//   validateCaseNumber(caseNumber)                                   ← one string
//   checkLookalikeDomain(url)                                        ← one string
//   findRedFlags(text, lang)                                         ← two strings
//   searchGuidance(query)                                            ← one string
// TOOL_RUNNERS adapts the model's JSON args object to those signatures.

import {
  checkOfficialContact,
  validateCaseNumber,
  checkLookalikeDomain,
  findRedFlags,
  searchGuidance
} from "../core/tools.js";
import { loadData } from "../core/data.js";

const PLACEHOLDER_NOTE =
  " Placeholders like [RECEIPT_1], [PHONE_1], [EMAIL_1] are real values hidden for privacy: pass them exactly as written.";

const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } }
});

const str = (description, extra = {}) => ({ type: "string", description, ...extra });

// Tool name → function that runs the core tool with the (already unmasked) args object.
// ctx = { text } — the original message, kept locally by agent.js.
// Models sometimes fill optional fields with "unknown"/"none" — treat those as empty.
const given = (v) => {
  const s = String(v ?? "").trim();
  return /^(unknown|none|n\/a|na|null|not specified|not mentioned|unspecified|-)?$/i.test(s) ? "" : s;
};

export const TOOL_RUNNERS = {
  check_official_contact: (a) =>
    checkOfficialContact({
      claimedAgency: given(a.claimedAgency),
      channel: given(a.channel),
      paymentMethod: given(a.paymentMethod)
    }),
  validate_case_number: (a) => validateCaseNumber(a.caseNumber ?? ""),
  // A real link has a dot ("uscis-help.com"). Names like "myUSCIS" are not links.
  check_lookalike_domain: (a) => checkLookalikeDomain(String(a.url ?? "").includes(".") ? a.url : ""),
  // The model doesn't need to copy the message: ctx.text is the full original (unmasked) text,
  // so the scan never misses words the model shortened or paraphrased.
  find_red_flags: (a, ctx = {}) => findRedFlags(ctx.text || a.text || "", a.lang || "en"),
  search_guidance: (a) => searchGuidance(a.query ?? "")
};

const INVESTIGATION_TOOLS = [
  fn(
    "check_official_contact",
    "Use when the message claims to come from a government agency (USCIS, IRS, ICE, Social Security, police, etc.). " +
      "Checks if that agency really contacts people through this channel and accepts this payment method.",
    {
      claimedAgency: str("Agency the message claims to be from, short English name, e.g. \"USCIS\", \"IRS\"."),
      channel: str(
        "How the message says it was sent or asks you to reply, e.g. \"WhatsApp\", \"phone call\", \"email\". Only if the message itself names it; otherwise leave empty. Do not guess."
      ),
      paymentMethod: str(
        "Payment the message asks for, short English, e.g. \"gift card\", \"crypto\", \"wire transfer\", \"Zelle\". Empty if none."
      )
    },
    ["claimedAgency"]
  ),
  fn(
    "validate_case_number",
    "Use when the message mentions a case or receipt number. Checks it has the real USCIS format (3 letters + 10 digits)." +
      PLACEHOLDER_NOTE,
    { caseNumber: str("The case/receipt number exactly as it appears, e.g. \"[RECEIPT_1]\".") },
    ["caseNumber"]
  ),
  fn(
    "check_lookalike_domain",
    "Use once for EACH website link or domain written in the message (something with a dot, like \"example.com\"). Checks if it imitates a real government (.gov) website. Not for account names like \"myUSCIS\".",
    { url: str("The link or domain exactly as written, e.g. \"uscis-help.com\".") },
    ["url"]
  ),
  fn(
    "find_red_flags",
    "Use on every message. Scans the whole message for known scam phrases (gift cards, deportation threats, urgency). " +
      "The message is passed in automatically; you only give its language.",
    { lang: str("Language code of the message.", { enum: ["en", "es", "hi", "zh", "other"] }) },
    ["lang"]
  ),
  fn(
    "search_guidance",
    "Use to find official government advice about this kind of message. Query with short English keywords " +
      "naming the agency and what is asked for, e.g. \"uscis gift card payment\".",
    { query: str("Short English keywords, e.g. \"irs gift card payment\".") },
    ["query"]
  )
];

function submitVerdictSchema(agencies) {
  return fn(
    "submit_verdict",
    "Call this ONCE at the end, after your checks, to give the final answer. This is the only way to finish.",
    {
      verdict: str("scam = clear scam; suspicious = some warning signs; safe = no warning signs found.", {
        enum: ["scam", "suspicious", "safe"]
      }),
      confidence: str("How sure you are. Never use high with safe.", { enum: ["high", "medium", "unsure"] }),
      reasons: {
        type: "array",
        maxItems: 3,
        items: { type: "string" },
        description: "Up to 3 short reasons in simple English, one sentence each. No phone numbers, no links."
      },
      steps: {
        type: "array",
        maxItems: 3,
        items: { type: "string" },
        description:
          "Up to 3 short next steps in simple English, e.g. \"Do not pay anything\", \"Verify through the official channel\". No phone numbers, no links."
      },
      officialAgency: str("The agency the message claims to be from, if it is in this list; otherwise \"none\".", {
        enum: [...agencies, "none"]
      }),
      familyMessage: str(
        "A short message in simple English the person can send to a family member to ask for help, describing the message and the verdict. No phone numbers, no links."
      )
    },
    ["verdict", "confidence", "reasons", "steps", "officialAgency", "familyMessage"]
  );
}

let schemasPromise = null;

// Returns all tool schemas (investigation tools + submit_verdict).
// Async because the officialAgency enum comes from data/official_contacts.json.
export function getToolSchemas() {
  if (!schemasPromise) {
    schemasPromise = loadData("official_contacts.json")
      .then((contacts) => contacts.map((c) => c.agency).filter(Boolean))
      .catch(() => [])
      .then((agencies) => [...INVESTIGATION_TOOLS, submitVerdictSchema(agencies)]);
  }
  return schemasPromise;
}
