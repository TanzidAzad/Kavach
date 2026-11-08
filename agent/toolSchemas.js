// agent/toolSchemas.js — Role 3 (Agent & Backend)
// OpenAI-style function schemas for the tools in PRD 8.3, plus submit_verdict
// (args match the Verdict shape in 8.2 minus trace, mode, and officialContact —
// the model only names the agency; the real contact is looked up from data/).
//
// Parameters match the REAL signatures in core/tools.js:
//   checkOfficialContact({ claimedAgency, channel, paymentMethod })  ← one object (channel/payment from fixed enums)
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

// Fixed choices for check_official_contact (the model picks one; it never writes free text here).
// Each maps to the words core/tools.js + data/official_contacts.json understand.
export const CHANNELS = {
  whatsapp: "WhatsApp",
  sms: "text message",
  email: "email",
  phone_call: "phone call",
  mail: "mail",
  online_account: "online account", // core alias → "myUSCIS account"
  social_media: "social media",
  unknown: ""
};
export const PAYMENTS = {
  gift_card: "gift cards",
  crypto: "cryptocurrency",
  wire_transfer: "wire transfer",
  payment_app: "a payment app",
  cash: "cash",
  other_fee: "", // e.g. a "processing fee" on a website — no payment-method check (none of the above was named)
  none: "",
  unknown: ""
};
// Nicer wording in the checklist line: "through phone call" → "by phone call".
const CHANNEL_PHRASE = {
  "WhatsApp": "on WhatsApp",
  "text message": "by text message",
  "email": "by email",
  "phone call": "by phone call",
  "mail": "by mail",
  "social media": "on social media"
};

const pick = (table, v) => table[String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? "";

function polish(r, channel) {
  if (!r || typeof r.detail !== "string") return r;
  let d = r.detail;
  if (channel && CHANNEL_PHRASE[channel]) d = d.replace(`through ${channel}`, CHANNEL_PHRASE[channel]);
  d = d.replace(/payment by a payment app/, "payment by payment apps");
  return { ...r, detail: d.charAt(0).toUpperCase() + d.slice(1) };
}

// Runs check_official_contact. When the message has both a channel and a payment, run them as
// two checks so the checklist shows two clear lines ("Sender channel", "Payment method").
// Returns a ToolResult, an array of them, or null (= not relevant, don't show it).
async function officialContact(a) {
  const claimedAgency = String(a.claimedAgency ?? "").replace(/[^\p{L}\s.&-]/gu, "").trim().slice(0, 40);
  if (!given(claimedAgency)) return null;
  const channel = pick(CHANNELS, a.channel);
  const paymentMethod = pick(PAYMENTS, a.paymentMethod);
  if (!channel && !paymentMethod) return checkOfficialContact({ claimedAgency });
  if (!channel || !paymentMethod) {
    return polish(await checkOfficialContact({ claimedAgency, channel, paymentMethod }), channel);
  }
  const [c, p] = await Promise.all([
    checkOfficialContact({ claimedAgency, channel }),
    checkOfficialContact({ claimedAgency, paymentMethod })
  ]);
  // Agency not in our data: the channel line only says "no details" — the payment line is enough.
  if (c.status === "unknown" && p.status !== "unknown") return polish(p);
  if (c.detail === p.detail) return polish(p);
  return [polish(c, channel), polish(p)];
}

export const TOOL_RUNNERS = {
  check_official_contact: officialContact,
  validate_case_number: (a) => validateCaseNumber(a.caseNumber ?? ""),
  // A real link has a dot ("uscis-help.com"). Names like "myUSCIS" are not links.
  check_lookalike_domain: (a) => checkLookalikeDomain(String(a.url ?? "").includes(".") ? a.url : ""),
  // The model doesn't need to copy the message: ctx.text is the full original (unmasked) text,
  // so the scan never misses words the model shortened or paraphrased.
  find_red_flags: (a, ctx = {}) => findRedFlags(ctx.text || a.text || "", a.lang || "en"),
  search_guidance: async (a, ctx = {}) => {
    const r = await searchGuidance(a.query ?? "");
    // Guidance about a specific payment method only makes sense if the message names that method
    // (core matched "USCIS payment" to the gift-card entry for a "processing fee" scam).
    return r && ctx.text && offTopicPayment(r.detail, ctx.text) ? null : r;
  }
};

// Payment words in the guidance text → the same method in the message (en / es / hi / zh).
const PAYMENT_WORDS = [
  [/gift ?card/i, /gift ?card|tarjetas? de regalo|google play|itunes|apple card|steam|गिफ्ट|गिफ़्ट|礼品卡|禮品卡/i],
  [/crypto|bitcoin/i, /crypto|bitcoin|btc|usdt|cripto|बिटकॉइन|क्रिप्टो|比特币|加密货币/i],
  [/wire transfer/i, /wire|transferencia|western union|moneygram|वायर|电汇|汇款/i]
];
// Asking for money at all (a fee, a payment, a dollar amount) — en / es / hi / zh.
export const MONEY_RE = /\bfees?\b|\bpay(ing|ment)?\b|\$\s?\d|cuota|tarifa|\bpag(o|ue|ar)\b|शुल्क|भुगतान|फीस|费|支付|付款|缴纳|美元/i;
function offTopicPayment(detail, text) {
  if (/\bpay|\bfee/i.test(String(detail || "")) && !MONEY_RE.test(text)) return true; // payment advice, no money asked
  return PAYMENT_WORDS.some(([inDetail, inText]) => inDetail.test(String(detail || "")) && !inText.test(text));
}

const INVESTIGATION_TOOLS = [
  fn(
    "check_official_contact",
    "Use when the message claims to come from a government agency (USCIS, IRS, ICE, Social Security, police, etc.). " +
      "Checks if that agency really contacts people this way and accepts this payment method.",
    {
      claimedAgency: str("Agency the message claims to be from, short English name, e.g. \"USCIS\", \"IRS\", \"ICE\"."),
      channel: str(
        "How the message was sent or asks you to reply. Pick \"unknown\" unless the message itself says it (e.g. mentions WhatsApp).",
        { enum: Object.keys(CHANNELS) }
      ),
      paymentMethod: str(
        "HOW the message asks to be paid. Pick gift_card / crypto / wire_transfer / payment_app / cash ONLY if the message " +
          "names that method. A fee or payment with no method named (e.g. \"pay the processing fee on this site\") → \"other_fee\". " +
          "\"none\" if it asks for no payment.", {
        enum: Object.keys(PAYMENTS)
      })
    },
    ["claimedAgency", "channel", "paymentMethod"]
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
      confidence: str("How sure you are. safe → always unsure. scam → high if 2+ checks failed (e.g. look-alike link + fee demand), else medium; never unsure.", { enum: ["high", "medium", "unsure"] }),
      reasons: {
        type: "array",
        maxItems: 3,
        items: { type: "string" },
        description:
          "Up to 3 short reasons in simple English, one sentence each, e.g. \"USCIS does not contact people on WhatsApp\". " +
          "Never include links, phone numbers, case numbers, or placeholders like [PHONE_1] — say \"the link\", \"that phone number\", \"the case number\"."
      },
      steps: {
        type: "array",
        maxItems: 3,
        items: { type: "string" },
        description:
          "Up to 3 short next steps in simple English, e.g. \"Do not pay anything\", \"Do not call that phone number\", \"Verify through the official channel\". " +
          "Never include links, phone numbers, case numbers, or placeholders."
      },
      officialAgency: str("The agency the message claims to be from, if it is in this list; otherwise \"none\".", {
        enum: [...agencies, "none"]
      }),
      familyMessage: str(
        "Written BY the person who got the message, TO a family member, in first person. EXACTLY 3 short sentences: " +
          "(1) \"I got a message that says it's from <agency> …\" plus what it asks for or threatens, (2) what Kavach found, (3) ask for help. Example: " +
          "\"I got a message that says it's from USCIS asking me to pay with gift cards or I'll be deported. Kavach says it looks like a scam. Can you help me check it before I do anything?\" " +
          "No amounts, dates, phone numbers, links, case numbers, or placeholders like [PHONE_1]."
      )
    },
    ["verdict", "confidence", "reasons", "steps", "officialAgency", "familyMessage"]
  );
}

let schemasPromise = null;

// Returns the tool schemas for this message (investigation tools + submit_verdict).
// Tools that can't apply are left out: validate_case_number only if mask() found a case/receipt
// number, check_lookalike_domain only if the message has a link.
// Async because the officialAgency enum comes from data/official_contacts.json.
export async function getToolSchemas({ hasCaseNumber = true, hasLink = true } = {}) {
  if (!schemasPromise) {
    schemasPromise = loadData("official_contacts.json")
      .then((contacts) => contacts.map((c) => c.agency).filter(Boolean))
      .catch(() => [])
      .then((agencies) => [...INVESTIGATION_TOOLS, submitVerdictSchema(agencies)]);
  }
  const all = await schemasPromise;
  return all.filter((t) => {
    const n = t.function.name;
    if (n === "validate_case_number") return hasCaseNumber;
    if (n === "check_lookalike_domain") return hasLink;
    return true;
  });
}
