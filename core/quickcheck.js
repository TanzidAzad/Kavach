// core/quickcheck.js — Role 2 (Core Engine)
// Contract: PRD section 8.2 (Verdict) and 8.4 (runQuickCheck).
// runQuickCheck(text) → Promise<Verdict>
// Fully offline: rules + bundled data only. Nothing leaves the device.
//
// Steps: detect language → pull details out of the text → run tools → score → build Verdict.

import {
  checkOfficialContact,
  validateCaseNumber,
  checkLookalikeDomain,
  findRedFlags,
  searchGuidance,
  matchRedFlags
} from "./tools.js";
import { checkSensitiveInfo, findSensitiveRequests } from "./sensitive.js";
import { loadData } from "./data.js";

const SUPPORTED_LANGS = ["en", "es", "hi", "zh"];

// ---------- 1. Language detection ----------

let detectorPromise = null;

// Chrome's on-device Language Detector API. Only used if it's already downloaded,
// so we never wait on (or need) the internet.
async function chromeDetect(text) {
  if (typeof LanguageDetector === "undefined") return null;
  if (!detectorPromise) {
    detectorPromise = LanguageDetector.availability().then((a) =>
      a === "available" ? LanguageDetector.create() : null
    );
  }
  const detector = await detectorPromise;
  if (!detector) return null;
  const [top] = await detector.detect(text);
  const code = top?.detectedLanguage?.split("-")[0];
  return SUPPORTED_LANGS.includes(code) && top.confidence > 0.5 ? code : null;
}

// Backup when Chrome's detector isn't available (and in Node tests).
export function guessLanguage(text) {
  const t = String(text ?? "");
  if (/[ऀ-ॿ]/.test(t)) return "hi"; // Devanagari letters
  if (/[一-鿿]/.test(t)) return "zh"; // Chinese characters
  const spanishWords = t.toLowerCase().match(/\b(su|usted|el|la|los|las|de|que|por|para|pague|caso|hoy|será)\b/g) || [];
  if (/[ñ¿¡]/i.test(t) || spanishWords.length >= 2) return "es";
  return "en";
}

export async function detectLanguage(text) {
  try {
    const code = await chromeDetect(text);
    if (code) return code;
  } catch {
    // fall through to the guess
  }
  return guessLanguage(text);
}

// ---------- 2. Pulling details out of the message ----------

// Web links, with or without http:// ("uscis-help.com/pay"). Skips email addresses.
const URL_RE =
  /(?<![@\w.-])(?:https?:\/\/[^\s<>"'，。]+|www\.[^\s<>"'，。]+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|info|gov|us|co|xyz|top|online|site|io|me|cn|in|mx|biz|app|link|click|live|vip|shop)(?![a-z0-9-])(?:\/[^\s<>"'，。]*)?)/gi;

// A correctly formatted USCIS receipt anywhere in the text (EAC1234567890 or EAC-12-345-67890).
const RECEIPT_RE = /\b[A-Z]{3}[-\s]?\d{2}[-\s]?\d{3}[-\s]?\d{5}\b/i;
// "case ABC123", "caso: ABC123", "receipt number #XYZ99", "案件号 ABC123", "केस नंबर ABC123"
const CASE_WORD_RE =
  /(?:case|caso|receipt|recibo|expediente|केस|मामला|案件|案号|申请号|回执)\s*(?:number|no\.?|n[úu]mero|nº|#|号码|号|नंबर|संख्या)?\s*(?:is|es|:|：|#|-)?\s*([A-Z0-9][A-Z0-9-]{2,})/i;

// Agency names in English, Spanish, Hindi and Chinese.
const AGENCY_PATTERNS = {
  USCIS: /uscis|citizenship and immigration|immigration (?:department|office)|servicios? de ciudadan[ií]a|departamento de inmigraci[oó]n|oficina de inmigraci[oó]n|यूएससीआईएस|इमिग्रेशन विभाग|移民局/i,
  // "ICE" in capitals, or lowercase "ice" only near enforcement words (so "ice cream" isn't ICE).
  ICE: [
    /\bICE\b|immigration and customs enforcement|inmigraci[oó]n y control de aduanas|आईसीई|移民海关执法局/,
    /\bice\b(?=\s+(?:agents?|officers?|enforcement|officials?)\b|[^.!?\n]{0,60}\b(?:arrest|deport|detain|detention|bail|warrant|jail|custody))/i
  ],
  IRS: /\bIRS\b|internal revenue service|servicio de impuestos internos|आईआरएस|国税局/i,
  FTC: /\bFTC\b|federal trade commission|comisi[oó]n federal de comercio|联邦贸易委员会/i,
  SSA: /\bSSA\b|social security|seguro social|सामाजिक सुरक्षा|सोशल सिक्योरिटी|社会安全|社会保障/i,
  // Visa lottery scams pretend to be the State Department.
  "State Department": /state department|department of state|departamento de estado|\bDV-?20\d\d\b|visa lottery|loter[ií]a de visas|वीज़ा लॉटरी|绿卡抽签/i
};

// Messaging apps that real agencies don't use to contact people.
// We deliberately do NOT flag text/email, since agencies do send some updates that way.
const CHANNEL_PATTERNS = {
  WhatsApp: /whats\s?app|वॉट्सऐप|व्हाट्सएप/i,
  Telegram: /telegram|टेलीग्राम|电报/i,
  WeChat: /wechat|微信/i,
  Signal: /\bsignal app\b/i,
  "Facebook Messenger": /facebook|messenger/i,
  Instagram: /instagram/i
};

// Payment types agencies never ask for. The key is the English name shown in reasons
// (e.g. "USCIS never asks for payment by Zelle").
const PAYMENT_PATTERNS = {
  "gift cards": /gift\s?cards?|itunes|google play|tarjetas? (?:de regalo|google play|itunes)|गिफ्ट कार्ड|礼品卡|购物卡/i,
  cryptocurrency: /bitcoin|crypto|cripto|比特币|加密货币|बिटकॉइन|क्रिप्टो/i,
  "Western Union": /western union|वेस्टर्न यूनियन|西联/i,
  MoneyGram: /moneygram|मनीग्राम|速汇金/i,
  "wire transfer": /wire transfer|transferencia|电汇|转账|वायर ट्रांसफर/i,
  Zelle: /zelle/i,
  Venmo: /venmo/i,
  PayPal: /paypal/i,
  "Cash App": /cash\s?app/i
};

// Any payment word, used so reasons mention payment only once.
const ANY_PAYMENT_RE = new RegExp(
  Object.values(PAYMENT_PATTERNS).map((re) => re.source).join("|") + "|payment app|cryptocurrency",
  "i"
);

// Returns the name whose pattern appears earliest in the text, or null.
// A pattern can be one regex or a list of regexes.
function firstMatch(patterns, text) {
  let best = null;
  let bestIndex = Infinity;
  for (const [name, value] of Object.entries(patterns)) {
    for (const re of [].concat(value)) {
      const m = re.exec(text);
      if (m && m.index < bestIndex) {
        best = name;
        bestIndex = m.index;
      }
    }
  }
  return best;
}

export function extractDetails(text) {
  const t = String(text ?? "");

  const urls = [...new Set((t.match(URL_RE) || []).map((u) => u.replace(/[.,;:!?)\]]+$/, "")))].slice(0, 3);

  let caseNumber = null;
  const receipt = t.match(RECEIPT_RE);
  if (receipt) {
    caseNumber = receipt[0];
  } else {
    const m = t.match(CASE_WORD_RE);
    if (m && /\d/.test(m[1])) caseNumber = m[1]; // must contain a digit, so "case status" isn't a case number
  }

  return {
    urls,
    caseNumber,
    agency: firstMatch(AGENCY_PATTERNS, t),
    channel: firstMatch(CHANNEL_PATTERNS, t),
    paymentMethod: firstMatch(PAYMENT_PATTERNS, t)
  };
}

// ---------- 3 + 4. Run tools, score, build the Verdict ----------

// Order reasons are shown in (strongest evidence first).
const REASON_ORDER = [
  "check_sensitive_info",
  "check_official_contact",
  "check_lookalike_domain",
  "validate_case_number",
  "find_red_flags"
];

// Only show a phone number if it's a real one (data may still say "TODO").
const looksLikePhone = (p) => typeof p === "string" && /\d{3}/.test(p) && !/todo/i.test(p);

function buildSteps(verdict, contact, asksPrivate) {
  if (verdict === "safe") {
    return contact
      ? [`To be sure, check with ${contact.agency} directly at ${contact.url}`]
      : ["If anything feels wrong, ask someone you trust before you act"];
  }
  const steps = asksPrivate
    ? ["Do not send your card, bank, or login details, and do not click any links"]
    : ["Do not pay, reply, or click any links in the message"];
  if (contact) {
    steps.push(`Check with ${contact.agency} yourself at ${contact.url}`);
  } else if (asksPrivate) {
    steps.push("If you are worried, call your bank using the number on the back of your card");
  } else {
    steps.push("Contact the agency yourself using its official website, not the message");
  }
  steps.push("Ask someone you trust before you do anything");
  return steps.slice(0, 3);
}

function buildFamilyMessage(verdict, agency) {
  const from = agency ? `a message that says it's from ${agency}` : "a message";
  if (verdict === "scam") {
    return `I got ${from}. Kavach says it looks like a scam. Can you help me check it before I do anything?`;
  }
  if (verdict === "suspicious") {
    return `I got ${from}. Kavach says it might be a scam. Can you help me check it before I do anything?`;
  }
  return `I got ${from}. Kavach did not find scam signs, but can you help me make sure it's real?`;
}

export async function runQuickCheck(text) {
  const input = String(text ?? "").trim();
  const lang = await detectLanguage(input);
  const d = extractDetails(input);

  // Run the tools. Order here = order shown in the trace.
  const trace = [];
  if (d.agency || d.channel || d.paymentMethod) {
    trace.push(await checkOfficialContact({
      claimedAgency: d.agency,
      channel: d.channel,
      paymentMethod: d.paymentMethod
    }));
  }
  trace.push(await validateCaseNumber(d.caseNumber));
  if (d.urls.length === 0) {
    trace.push(await checkLookalikeDomain(""));
  } else {
    for (const url of d.urls) trace.push(await checkLookalikeDomain(url));
  }
  trace.push(await findRedFlags(input, lang));
  // Asking for card / bank / SSN / codes. Each KIND asked for is one warning sign.
  trace.push(await checkSensitiveInfo(input));
  const sensitiveSigns = findSensitiveRequests(input).length;

  // Guidance query: agency + payment + matched red-flag phrases.
  const flags = await matchRedFlags(input, lang).catch(() => []);
  const query = [d.agency, d.paymentMethod, ...flags.map((f) => f.phrase)].filter(Boolean).join(" ");
  const guidance = await searchGuidance(query);
  trace.push(guidance);

  // Score: count DIFFERENT warning signs.
  //  - each tool that failed counts once (3 bad links = 1 sign)
  //  - for red-flag phrases, each different reason counts (threat + deadline + bitcoin = 3 signs)
  //  - guidance doesn't count — it only repeats what the other tools found
  const failedTools = new Set(
    trace
      .filter((r) => r.status === "fail" && !["search_guidance", "find_red_flags", "check_sensitive_info"].includes(r.tool))
      .map((r) => r.tool)
  );
  const redFlagFailed = trace.some((r) => r.tool === "find_red_flags" && r.status === "fail");
  const redFlagSigns = redFlagFailed ? Math.max(1, new Set(flags.map((f) => f.reason)).size) : 0;
  // Asking for 1 private detail → at least suspicious; 2+ (e.g. card number + CVC) → scam, even with no agency.
  const fails = failedTools.size + redFlagSigns + sensitiveSigns;
  const verdict = fails >= 2 ? "scam" : fails === 1 ? "suspicious" : "safe";
  const confidence = fails >= 2 ? "high" : fails === 1 ? "medium" : "unsure"; // never "safe/high"

  // Reasons: failed tool details, strongest first, then official guidance if there's room.
  let reasons = [];
  if (verdict === "safe") {
    reasons = input
      ? ["We did not find common scam signs", "New scams can look normal, so stay careful"]
      : ["There was no message to check"];
  } else {
    const failed = trace
      .filter((r) => r.status === "fail" && r.tool !== "search_guidance")
      .sort((a, b) => REASON_ORDER.indexOf(a.tool) - REASON_ORDER.indexOf(b.tool));
    // Candidate reasons, strongest first. For red flags, list each phrase's reason
    // separately, so if the first one repeats another reason we can use the next one.
    const candidates = [];
    for (const r of failed) {
      if (r.tool === "find_red_flags" && flags.length) candidates.push(...flags.map((f) => f.reason));
      else candidates.push(r.detail);
    }
    if (guidance.status === "fail") candidates.push(guidance.detail);

    // Mention payment only once ("gift cards" in reason 1 and 3 reads as repetition).
    let paymentMentioned = false;
    for (const reason of candidates) {
      if (reasons.length === 3) break;
      if (reasons.includes(reason)) continue;
      const aboutPayment = ANY_PAYMENT_RE.test(reason);
      if (aboutPayment && paymentMentioned) continue;
      if (aboutPayment) paymentMentioned = true;
      reasons.push(reason);
    }
  }

  // Official contact: ONLY copied from data/official_contacts.json, never invented.
  let officialContact = null;
  if (d.agency) {
    const contacts = await loadData("official_contacts.json").catch(() => []);
    const entry = contacts.find((c) => c.agency === d.agency);
    if (entry) {
      officialContact = {
        agency: entry.agency,
        url: entry.url,
        phone: looksLikePhone(entry.phone) ? entry.phone : null
      };
    }
  }

  return {
    verdict,
    confidence,
    reasons,
    steps: buildSteps(verdict, officialContact, sensitiveSigns > 0),
    officialContact,
    trace,
    mode: "quick",
    familyMessage: buildFamilyMessage(verdict, d.agency)
  };
}
