// agent/sanitize.js — Role 3 (Agent & Backend)
// Cleans model-written text (reasons, steps, familyMessage) so it never shows a link, phone
// number, case number, or placeholder — and still reads like a normal sentence.
//   "Do not share your [RECEIPT_1]"            → "Do not share the case number"
//   "Do not click a http://uscis-help.com link" → "Do not click the link"
//   "Call the number (469) 555-0187"           → "Call that phone number"
// The real official contact is shown separately, from data/official_contacts.json.

export const URL_RE =
  /\b(?:https?:\/\/|www\.)[^\s)]+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|gov|us|info|io|co|app|xyz|top|site|online|me|biz|mil)\b[^\s)]*/gi;
const PHONE_RE = /\(?\+?\d[\d\s().-]{6,}\d/g;
const PLACEHOLDER_RE = /\[[A-Z]+(?:_\d+)?\]/g;

// Words that can sit in front of the thing we replace ("your [RECEIPT_1]", "a http://… link").
const DET = "(?:\\b(?:the|a|an|your|this|that|their|my|our|his|her)\\s+)?";

// Replace `token` plus any article and nouns around it with one natural phrase.
function swap(s, tokenSrc, before, after, phrase, keep = () => true) {
  const re = new RegExp(`${DET}(?:\\b(?:${before})\\s+)?(${tokenSrc})(?:\\s+(?:${after})\\b)?`, "gi");
  return s.replace(re, (whole, token) => (keep(token) ? (typeof phrase === "function" ? phrase(token) : phrase) : whole));
}

const digitCount = (t) => (t.match(/\d/g) || []).length;
const isGov = (t) => /\.(?:gov|mil)\b/i.test(t);

export function cleanText(input) {
  let s = String(input ?? "").replace(/<think>[\s\S]*?<\/think>/g, " ");

  // placeholders from mask()
  s = swap(s, "\\[RECEIPT_\\d+\\]", "(?:case|receipt)(?:\\s+(?:number|no\\.?|#))?|number", "(?:case\\s+)?number", "the case number");
  s = swap(s, "\\[PHONE_\\d+\\]", "(?:phone\\s+)?number|phone", "(?:phone\\s+)?number", "that phone number");
  s = swap(s, "\\[EMAIL_\\d+\\]", "email(?:\\s+address)?|address", "email(?:\\s+address)?|address", "that email address");
  s = s.replace(PLACEHOLDER_RE, "that detail");

  // raw links and phone numbers the model wrote anyway
  s = swap(s, URL_RE.source, "website|site|link|domain|url|page", "website|site|link|domain|url|page",
    (t) => (isGov(t) ? "the official website" : "the link"));
  s = swap(s, PHONE_RE.source, "(?:phone\\s+)?number|phone", "(?:phone\\s+)?number", "that phone number",
    (t) => digitCount(t) >= 7);

  return s
    .replace(/\b(?:a|an|the|your|my|this)\s+(the|that)\b/gi, "$1") // "your the case number" → "the case number"
    .replace(/\bthe\s+(?:website|site)\s+link\b/gi, "the link") //    "the website link" → "the link"
    .replace(/\b(?:the\s+)?official\s+the official website\b/gi, "the official website")
    .replace(/\b(?:the\s+)?official\s+the official website\b/gi, "the official website")
    .replace(/\b(the link|the official website|that phone number|the case number|that email address)(?:\s*(?:,|\/|or|and)\s*\1)+/gi, "$1")
    .replace(/\b(\w+)(?:\s+\1\b)+/gi, "$1") // doubled words
    .replace(/\(\s*(?:the link|the official website|that phone number|the case number|that email address|that detail)?\s*\)/gi, "")
    .replace(/\s*\([^)]*$/, "") // a "(" left open → drop the aside
    .replace(/\s+([,.;:!?])(?=\s|$)/g, "$1") // "word ." → "word." but keep "a .gov website"
    .replace(/([.!?])[.!?]+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

export function cleanList(list, max) {
  if (!Array.isArray(list)) list = typeof list === "string" ? [list] : [];
  const out = [];
  for (const item of list) {
    let s = cleanText(item);
    if (/\bignore\b/i.test(s)) s = "Do not reply. Verify through the official channel";
    if (s.length > 2 && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out.slice(0, max);
}

// ---------- tests used by the harness ----------

export const hasUrl = (s) => new RegExp(URL_RE.source, "i").test(String(s));
export const hasPhone = (s) => (String(s).match(PHONE_RE) || []).some((t) => digitCount(t) >= 7);
export const hasPlaceholder = (s) => /\[[^\]]*\]|[{}<>]|\bTODO\b|\bXXX\b|\b(?:name|agency|number)\s*here\b/i.test(String(s));
export const hasDoubledWord = (s) => /\b(\w+)\s+\1\b/i.test(String(s));

export function sentences(s) {
  return String(s).match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) || [];
}

// Written FROM the user TO a family member: "I got a message…", not "You received a message…".
export function isFirstPerson(s) {
  const first = sentences(s)[0] || "";
  if (/^\s*(?:you|your|this message|the message|kavach)\b/i.test(first)) return false;
  return /\b(?:I|I'm|I've|me|my)\b/.test(first);
}

// ---------- family message ----------

const LOOKS = {
  scam: "Kavach says it looks like a scam.",
  suspicious: "Kavach says it looks suspicious.",
  safe: "Kavach did not find warning signs, but I want to be sure."
};

// Safe fallback, built only from the verdict and data we trust (never from model free text).
export function familyTemplate({ verdict, agency, payment, threat }) {
  const from = agency ? ` that says it's from ${agency}` : "";
  const asks = [payment && `asks me to pay with ${payment}`, threat && `says ${threat}`].filter(Boolean);
  const first = `I got a message${from}${asks.length ? (from ? " and " : " that ") + asks.join(", and ") : ""}.`;
  return `${first} ${LOOKS[verdict] || LOOKS.suspicious} Can you help me check it before I do anything?`;
}

// Use the model's family message only if it is first person, ≤3 sentences, and had nothing to scrub.
export function pickFamilyMessage(raw, facts) {
  const original = String(raw ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const ok =
    original.length >= 20 &&
    !hasUrl(original) &&
    !hasPhone(original) &&
    !hasPlaceholder(original) &&
    !/\b[A-Z]{3}\d{10}\b/.test(original) &&
    isFirstPerson(original) &&
    sentences(original).length <= 3;
  const cleaned = ok ? cleanText(original) : "";
  return ok && !hasDoubledWord(cleaned) ? cleaned : familyTemplate(facts);
}
