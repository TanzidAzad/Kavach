// sidepanel/i18n.js — Role 1 (UI). Shared by the side panel and the toolbar popup.
// Every piece of text on screen is kept in English in a `data-en` attribute and drawn
// through translate() in the chosen language. Labels found in data/ui_strings.json for that
// language are used as-is (hand-written); anything else goes through Chrome's on-device translator.
// Web links are kept out of translation so the translator can never change them.

import { translate } from "../core/translate.js";
import { loadData } from "../core/data.js";

export const LANGS = ["en", "es", "hi", "zh"];
export const LANG_NAMES = { en: "English", es: "Español", hi: "हिन्दी", zh: "中文" };

// English labels. data/ui_strings.json (Role 4) overrides these when it has them.
export const DEFAULT_STRINGS = {
  appName: "Kavach",
  language: "Language",

  // Popup (launcher)
  checkThisPage: "Check this page",
  pasteMessage: "Paste a message…",
  checkMessage: "Check this message",
  uploadScreenshot: "Upload screenshot",
  screenshotAdded: "Screenshot added",
  screenshotNote: "Screenshots are sent as an image so the text can be read.",

  // Side panel
  check: "Check",
  readingPage: "Reading the page…",
  checking: "Checking…",
  whatWeChecked: "What Kavach checked",
  showMore: "Show more",
  showLess: "Show less",
  isItScam: "Is this a scam?",
  highly_likely: "Highly likely scam",
  likely: "Likely scam",
  unsure: "Unsure",
  unlikely: "Unlikely",
  why: "Why",
  whatToDo: "What to do",
  officialContact: "Official contact:",
  call: "Call",
  website: "Website",
  cardTalk: "Talk to Kavach", // same words as Role 2's card, so the hand translations are shared
  speaksYourLanguage: "Speaks your language",
  stopTalking: "Stop",
  tellFamily: "Tell family",
  reportToFtc: "Report to FTC",
  copiedPasteForm: "Copied — paste it into the form",
  familyName: "Their name",
  familyReach: "Their phone or email",
  familyAsk: "Who should we send it to?",
  save: "Save",
  cancel: "Cancel",
  changeContact: "Change contact",
  familyInvalid: "Please type a phone number or an email.",
  familySubject: "Is this message a scam?",
  chooseHowToSend: "How should we send it?",
  whatsapp: "WhatsApp",
  imessage: "iMessage",
  email: "Email",
  openingMessages: "Opening Messages…",
  scanWithIphone: "Scan with your iPhone camera to send",
  copiedCanPaste: "Copied — you can paste it too",
  done: "Done",
  checkAnother: "Check another message",
  quickOnly: "Quick check, done on this computer only.",
  cantReadPage: "Kavach can't read this page. Please paste the message here.",
  emptyInput: "Paste a message or upload a screenshot first.",
  errorGeneric: "Something went wrong. Please try again.",
  downloadingLanguage: "Downloading {lang}… (first time only)",
  offline: "offline",
  clickIconToSee: "Click the Kavach icon (top right) to see the check."
};

let strings = { ...DEFAULT_STRINGS };
let getLang = () => "en";

export async function initI18n(langGetter) {
  getLang = langGetter;
  try {
    strings = { ...DEFAULT_STRINGS, ...(await loadData("ui_strings.json")) };
  } catch {}
}

export const t = (key) => (typeof strings[key] === "string" ? strings[key] : DEFAULT_STRINGS[key] ?? key);

// Hand-written label for this English text in language L, if ui_strings.json has one.
function handLabel(english, L) {
  const own = strings[L];
  if (L === "en" || !own || typeof own !== "object") return null;
  const key = Object.keys(DEFAULT_STRINGS).find((k) => t(k) === english);
  return (key && typeof own[key] === "string" && own[key]) || null;
}

export const tr = (text, L = getLang()) => {
  const own = handLabel(text, L);
  return own != null ? Promise.resolve(own) : translate(text, L);
};

// Official links only: https and a .gov address. Anything else stays plain text.
export const URL_RE = /(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]])/g;
export function officialUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol === "https:" && /(^|\.)[a-z0-9-]+\.gov$/i.test(u.hostname)) return u;
  } catch {}
  return null;
}

export function makeLink(url, labelNode) {
  const a = document.createElement("a");
  a.href = url.href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.append(labelNode ?? url.hostname.replace(/^www\./, "") + url.pathname.replace(/\/$/, ""));
  return a;
}

// Translates text but keeps web links untouched. Returns DOM nodes.
async function translateToNodes(english, L) {
  const parts = String(english ?? "").split(URL_RE); // odd indexes are links
  const done = await Promise.all(parts.map((p, i) => (i % 2 ? p : tr(p.trim(), L))));
  const nodes = [];
  done.forEach((part, i) => {
    if (i % 2) {
      const url = officialUrl(part);
      if (nodes.length) nodes.push(" ");
      nodes.push(url ? makeLink(url) : part);
    } else if (part) {
      const needsSpace = nodes.length && !/^[.,;:!?。，、！？]/.test(part);
      nodes.push(needsSpace ? " " + part : part);
    }
  });
  return nodes;
}

// Draws one element in the current language (skipped if something newer was drawn meanwhile).
export async function paint(el) {
  const english = el.dataset.en ?? "";
  const L = getLang();
  const nodes = await translateToNodes(english, L);
  if (el.dataset.en !== english || getLang() !== L) return;
  el.replaceChildren(...nodes);
}

export function setText(el, english) {
  el.dataset.en = english ?? "";
  return paint(el);
}

export function span(english) {
  const s = document.createElement("span");
  setText(s, english);
  return s;
}

// Fills every [data-i18n] label, [data-i18n-placeholder] placeholder, then draws all text.
export async function repaintAll(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.dataset.en = t(el.dataset.i18n);
  });
  const L = getLang();
  await Promise.all([
    ...[...root.querySelectorAll("[data-i18n-placeholder]")].map(async (el) => {
      const text = await tr(t(el.dataset.i18nPlaceholder), L);
      if (getLang() === L) el.placeholder = text;
    }),
    ...[...root.querySelectorAll("[data-en]")].map(paint)
  ]);
}

// Language download message, from ui_strings.json in that language when we have it.
export function downloadingMessage(L) {
  const own = strings[L]?.downloadingLanguage;
  return own ? own.replace("{lang}", LANG_NAMES[L]) : t("downloadingLanguage").replace("{lang}", LANG_NAMES[L] || L);
}

// Saved language (shared by popup and side panel).
export async function savedLang() {
  try {
    const r = await chrome.storage.local.get("lang");
    if (LANGS.includes(r.lang)) return r.lang;
  } catch {}
  return "en";
}
