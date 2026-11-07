// core/tools.js — Role 2 (Core Engine)
// Contract: PRD section 8.1 (ToolResult) and 8.3 (function names). Do not rename.
//
// Every tool returns a Promise<ToolResult>, so callers should `await` them:
//   { tool, status: "fail" | "pass" | "unknown", label, detail, source? }
//   "fail" means a red flag was found.
// Everything here works offline (data comes from the bundled data/ folder),
// except checkDomainAge, which is a stretch goal.
// A tool never throws: if something goes wrong it returns status "unknown".

import { loadData } from "./data.js";

// ---------- small helpers ----------

// Lowercase, remove accents (será → sera), collapse spaces.
// Only Latin accents are removed, so Hindi and Chinese text is untouched.
export function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function result(tool, status, label, detail, source) {
  const r = { tool, status, label, detail };
  if (source) r.source = source;
  return r;
}

// Runs a tool body; if it crashes, return "unknown" instead of breaking the whole check.
async function safely(tool, label, body) {
  try {
    return await body();
  } catch {
    return result(tool, "unknown", label, "Could not run this check");
  }
}

// ---------- checkOfficialContact ----------

// Different words people use for the same thing → the word used in official_contacts.json.
const PAYMENT_ALIASES = {
  "gift card": "gift card",
  "itunes card": "gift card",
  "google play card": "gift card",
  "amazon card": "gift card",
  "tarjeta de regalo": "gift card",
  "bitcoin": "crypto",
  "cryptocurrency": "crypto",
  "crypto": "crypto",
  "wire transfer": "wire transfer",
  "western union": "wire transfer",
  "moneygram": "wire transfer"
};

const CHANNEL_ALIASES = {
  "letter": "mail",
  "postal mail": "mail",
  "us mail": "mail",
  "myuscis": "myuscis account",
  "uscis account": "myuscis account",
  "online account": "myuscis account"
};

// No U.S. government agency accepts these, so we can flag them even for agencies
// that are not in official_contacts.json yet.
const GENERIC_NEVER = ["gift cards", "crypto", "wire transfer"];

const singular = (word) => normalize(word).replace(/s$/, "");

function paymentMatches(paymentMethod, forbidden) {
  const pm = singular(PAYMENT_ALIASES[normalize(paymentMethod)] ?? paymentMethod);
  const item = singular(forbidden);
  return pm === item || pm.includes(item) || item.includes(pm);
}

export async function checkOfficialContact({ claimedAgency, channel, paymentMethod } = {}) {
  const TOOL = "check_official_contact";
  return safely(TOOL, "Official contact", async () => {
    if (!claimedAgency) {
      return result(TOOL, "unknown", "Official contact", "The message does not say which agency sent it");
    }
    const contacts = await loadData("official_contacts.json");
    const entry = contacts.find((c) => normalize(c.agency) === normalize(claimedAgency));
    if (!entry) {
      // We don't have this agency's details, but no U.S. agency takes these payments.
      const generic = paymentMethod ? GENERIC_NEVER.find((item) => paymentMatches(paymentMethod, item)) : null;
      if (generic) {
        return result(TOOL, "fail", "Payment method", `Government agencies never ask for payment by ${generic}`);
      }
      return result(TOOL, "unknown", "Official contact", `We have no official contact details for ${claimedAgency}`);
    }

    const badPayment = paymentMethod
      ? (entry.neverAsksFor || []).find((item) => paymentMatches(paymentMethod, item))
      : null;

    let badChannel = false;
    if (channel) {
      const ch = CHANNEL_ALIASES[normalize(channel)] ?? normalize(channel);
      badChannel = !(entry.channels || []).some((c) => normalize(c) === ch);
    }

    const agency = entry.agency;
    if (badChannel && badPayment) {
      return result(TOOL, "fail", "Sender channel",
        `${agency} does not contact people through ${channel} or ask for ${badPayment}`, entry.source);
    }
    if (badPayment) {
      return result(TOOL, "fail", "Payment method", `${agency} never asks for payment by ${badPayment}`, entry.source);
    }
    if (badChannel) {
      return result(TOOL, "fail", "Sender channel", `${agency} does not contact people through ${channel}`, entry.source);
    }
    if (channel) {
      return result(TOOL, "pass", "Sender channel", `${channel} is a real way ${agency} contacts people`, entry.source);
    }
    return result(TOOL, "unknown", "Official contact", `Could not tell how this message was sent`, entry.source);
  });
}

// ---------- validateCaseNumber ----------

// USCIS receipt number: 3 letters + 10 digits, e.g. EAC1234567890.
const RECEIPT_RE = /^[A-Z]{3}\d{10}$/;
const NOTHING_RE = /^(|none|none found|n\/a|na|null|undefined|missing|not found)$/i;
const PLACEHOLDER_RE = /^\[[A-Z_]+_\d+\]$/; // e.g. [RECEIPT_1] that was not unmasked

export async function validateCaseNumber(caseNumber) {
  const TOOL = "validate_case_number";
  const LABEL = "Case number";
  return safely(TOOL, LABEL, async () => {
    const raw = String(caseNumber ?? "").trim();
    if (NOTHING_RE.test(raw)) {
      return result(TOOL, "unknown", LABEL, "No case number found in the message");
    }
    if (PLACEHOLDER_RE.test(raw)) {
      return result(TOOL, "unknown", LABEL, "Could not read the case number");
    }
    const cleaned = raw.toUpperCase().replace(/[\s-]/g, ""); // "EAC-12-345-67890" → "EAC1234567890"
    if (RECEIPT_RE.test(cleaned)) {
      return result(TOOL, "pass", LABEL,
        "The case number looks like a real USCIS format, but that alone does not prove it is real",
        "https://egov.uscis.gov/");
    }
    return result(TOOL, "fail", LABEL, "The case number is not a real USCIS format", "https://egov.uscis.gov/");
  });
}

// ---------- checkLookalikeDomain ----------

// Names scammers put in fake website addresses.
// Long names: flag if they appear anywhere in the address.
const LONG_BRANDS = ["uscis", "socialsecurity", "homelandsecurity", "irsgov"];
// Short names: only flag as a whole word ("irs-refund.com"), so "first.com" or "iceberg.com" are fine.
const SHORT_BRANDS = ["irs", "ice", "ftc", "ssa", "dhs", "fbi", "gov"];
// Words scammers glue onto short names ("irsrefund.com", "ssaonline.net").
const SCAM_SUFFIXES = ["gov", "us", "usa", "online", "help", "refund", "tax", "pay", "payment",
  "support", "service", "services", "portal", "official", "case", "status", "verify"];

function getHostname(input) {
  let s = String(input ?? "").trim();
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "http://" + s;
  try {
    return new URL(s).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

function looksLikeShortBrand(word) {
  return SHORT_BRANDS.some((b) => {
    if (word === b) return true;
    return SCAM_SUFFIXES.some((x) => x !== b && (word === b + x || word === x + b));
  });
}

export async function checkLookalikeDomain(url) {
  const TOOL = "check_lookalike_domain";
  const LABEL = "Website link";
  return safely(TOOL, LABEL, async () => {
    const host = getHostname(url);
    if (!host) {
      return result(TOOL, "unknown", LABEL, "No website link found in the message");
    }
    // Only the U.S. government can register .gov addresses, so these are real.
    if (host.endsWith(".gov") || host.endsWith(".mil")) {
      return result(TOOL, "pass", LABEL, `${host} is a real U.S. government website`);
    }
    // Non-English letters that can imitate real ones (e.g. Cyrillic "і" in "uscіs").
    if (host.split(".").some((part) => part.startsWith("xn--"))) {
      return result(TOOL, "fail", LABEL, `${host} uses unusual letters that can imitate a real website`);
    }
    const words = host.split(/[.\-_]/).filter(Boolean);
    const fake = LONG_BRANDS.some((b) => host.includes(b)) || words.some(looksLikeShortBrand);
    if (fake) {
      return result(TOOL, "fail", LABEL,
        `${host} pretends to be a government website, but real ones end in .gov`);
    }
    return result(TOOL, "pass", LABEL, "The link does not pretend to be a government website");
  });
}

// ---------- findRedFlags ----------

// Turns a phrase into a matcher that also accepts plurals of each word
// ("tarjeta de regalo" also matches "tarjetas de regalo", "gift card" → "gift cards").
// Non-Latin phrases (Hindi, Chinese) are matched exactly.
function phraseMatcher(phrase) {
  const p = normalize(phrase);
  if (!/^[a-z0-9 '’-]+$/.test(p)) return (text) => text.includes(p);
  const words = p.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:e?s)?");
  const re = new RegExp(`(?:^|[^a-z0-9])${words.join("\\s+")}(?![a-z0-9])`);
  return (text) => re.test(text);
}

// Returns every red-flag phrase found in the text: [{ phrase, reason, lang }].
// Checks the given language first, then all others (scammers mix languages,
// and language detection can be wrong). Used by quickcheck.js for reasons.
export async function matchRedFlags(text, lang = "en") {
  const flags = await loadData("red_flags.json");
  const haystack = normalize(text);
  const langs = [lang, ...Object.keys(flags).filter((l) => l !== lang)];
  const found = [];
  const seenReasons = new Set();
  for (const l of langs) {
    for (const { phrase, reason } of flags[l] || []) {
      if (phrase && !seenReasons.has(reason) && phraseMatcher(phrase)(haystack)) {
        seenReasons.add(reason);
        found.push({ phrase, reason, lang: l });
      }
    }
  }
  return found;
}

export async function findRedFlags(text, lang = "en") {
  const TOOL = "find_red_flags";
  const LABEL = "Warning signs";
  return safely(TOOL, LABEL, async () => {
    const found = await matchRedFlags(text, lang);
    if (found.length === 0) {
      return result(TOOL, "pass", LABEL, "No common scam phrases found");
    }
    const more = found.length > 1 ? ` (and ${found.length - 1} more warning signs)` : "";
    return result(TOOL, "fail", LABEL, found[0].reason + more);
  });
}

// ---------- searchGuidance ----------

// Keyword search over data/guidance.json. Needs at least 2 matching keywords,
// so "uscis" alone does not pull up unrelated advice.
export async function searchGuidance(query) {
  const TOOL = "search_guidance";
  const LABEL = "Official guidance";
  return safely(TOOL, LABEL, async () => {
    const q = normalize(query);
    if (!q) {
      return result(TOOL, "unknown", LABEL, "No official guidance found for this message");
    }
    const guidance = await loadData("guidance.json");
    let best = null;
    let bestScore = 0;
    for (const g of guidance) {
      const score = (g.keywords || []).filter((k) => q.includes(normalize(k))).length;
      if (score > bestScore) {
        best = g;
        bestScore = score;
      }
    }
    if (!best || bestScore < 2) {
      return result(TOOL, "unknown", LABEL, "No official guidance found for this message");
    }
    return result(TOOL, "fail", LABEL, best.text, best.source);
  });
}

// ---------- checkDomainAge (STRETCH — needs internet) ----------

export async function checkDomainAge(url) {
  return result("check_domain_age", "unknown", "Website age", "Website age check is not available yet");
}
