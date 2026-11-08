// popup/popup.js — Role 1 (UI)
// The one-screen popup (PRD section 5). Talks to the engine only through PRD 8.4:
//   runQuickCheck(text) and runDeepCheck({ text, imageDataUrl }, onStep).
//
// Translation: every piece of text on screen is stored in English in a `data-en`
// attribute and drawn through translate() for the chosen language. Changing the
// language just redraws everything. Web links are kept out of translation so the
// translator can never change them.

import { runQuickCheck } from "../core/quickcheck.js";
import { runDeepCheck } from "../agent/agent.js";
import { translate, prepareTranslation } from "../core/translate.js";
import { loadData } from "../core/data.js";

const $ = (id) => document.getElementById(id);
const LANGS = ["en", "es", "hi", "zh"];

// English labels. data/ui_strings.json (Role 4) overrides these when it loads.
const DEFAULT_STRINGS = {
  appName: "Kavach",
  pasteMessage: "Paste a message…",
  uploadScreenshot: "Upload screenshot",
  screenshotAdded: "Screenshot added",
  screenshotNote: "Screenshots are sent as an image so the text can be read.",
  check: "Check",
  checking: "Checking…",
  emptyInput: "Paste a message or upload a screenshot first.",
  newCheck: "← New check",
  scam: "SCAM",
  suspicious: "SUSPICIOUS",
  safe: "LOOKS SAFE",
  confidence: "Confidence",
  high: "High",
  medium: "Medium",
  unsure: "Unsure",
  why: "Why:",
  whatToDo: "What to do:",
  officialContact: "Official contact:",
  call: "Call",
  website: "Website",
  reportToFtc: "Report it to the FTC",
  askFamily: "Ask family",
  copied: "Copied ✓",
  copyFailed: "Could not copy.",
  deepCheck: "Deep check →",
  offline: "offline",
  deepCheckNeedsInternet: "Deep check needs internet",
  errorGeneric: "Something went wrong. Please try again."
};
let strings = { ...DEFAULT_STRINGS };
const t = (key) => strings[key] ?? DEFAULT_STRINGS[key] ?? key;

const state = {
  verdict: null,      // last Verdict shown
  busy: false,        // a check is running
  run: 0,             // id of the latest check; older results are ignored
  imageDataUrl: null, // chosen screenshot
  statusTimer: null
};
let contacts = []; // data/official_contacts.json

const lang = () => $("lang").value;

// ---------- Translation + drawing ----------

// Official links only: https and a .gov address. Anything else stays plain text.
const URL_RE = /(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]])/g;
function officialUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol === "https:" && /(^|\.)[a-z0-9-]+\.gov$/i.test(u.hostname)) return u;
  } catch {}
  return null;
}

function makeLink(url, labelNode) {
  const a = document.createElement("a");
  a.href = url.href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.append(labelNode ?? (url.hostname.replace(/^www\./, "") + url.pathname.replace(/\/$/, "")));
  return a;
}

// Translates text but keeps web links untouched. Returns DOM nodes.
async function translateToNodes(english, L) {
  const parts = String(english ?? "").split(URL_RE); // odd indexes are links
  const done = await Promise.all(parts.map((p, i) => (i % 2 ? p : translate(p.trim(), L))));
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
async function paint(el) {
  const english = el.dataset.en ?? "";
  const L = lang();
  const nodes = await translateToNodes(english, L);
  if (el.dataset.en !== english || lang() !== L) return;
  el.replaceChildren(...nodes);
}

function setText(el, english) {
  el.dataset.en = english ?? "";
  return paint(el);
}

async function paintPlaceholder() {
  const L = lang();
  const text = await translate(t("pasteMessage"), L);
  if (lang() === L) $("message").placeholder = text;
}

function repaintAll() {
  paintPlaceholder();
  return Promise.all([...document.querySelectorAll("[data-en]")].map(paint));
}

const span = (english) => {
  const s = document.createElement("span");
  setText(s, english);
  return s;
};

// ---------- Status line (bottom right) ----------

const baseStatus = () => (navigator.onLine ? "" : `${t("offline")} ○`);

function setStatus(english, { flash = false } = {}) {
  clearTimeout(state.statusTimer);
  setText($("status"), english);
  if (flash) state.statusTimer = setTimeout(() => setText($("status"), baseStatus()), 2000);
}

// ---------- Views ----------

function updateButtons() {
  const v = state.verdict;
  $("ask-family").hidden = !v;
  $("deep-check").hidden = !navigator.onLine || !v || v.mode === "deep";
  for (const id of ["check", "deep-check", "ask-family"]) $(id).disabled = state.busy;
}

function showInputView() {
  $("input-view").hidden = false;
  $("result-view").hidden = true;
  $("new-check").hidden = true;
}

function showResultView() {
  $("input-view").hidden = true;
  $("result-view").hidden = false;
  $("new-check").hidden = false;
}

function fillList(listEl, items) {
  listEl.replaceChildren();
  for (const item of (items || []).slice(0, 3)) {
    const li = document.createElement("li");
    setText(li, item);
    listEl.append(li);
  }
}

function renderVerdict(v) {
  state.verdict = v;
  showResultView();

  const line = $("verdict-line");
  line.hidden = false;
  line.className = `verdict ${v.verdict}`;
  setText($("verdict-label"), t(v.verdict));
  setText($("conf-label"), t("confidence"));
  setText($("conf-value"), t(v.confidence));

  $("checklist-block").hidden = true;
  $("reasons-block").hidden = false;
  fillList($("reasons"), v.reasons);

  $("steps-block").hidden = false;
  fillList($("steps"), v.steps);
  renderContact(v);
  updateButtons();
}

// Official contact line. Values come ONLY from data/official_contacts.json.
function renderContact(v) {
  const el = $("contact");
  el.replaceChildren();

  const agency = v.officialContact?.agency;
  const entry = contacts.find((c) => c.agency === agency) || (contacts.length ? null : v.officialContact);
  const url = entry?.url && officialUrl(entry.url);
  const phone = typeof entry?.phone === "string" && /^[\d\s().+-]{7,}$/.test(entry.phone) ? entry.phone.trim() : null;

  if (entry && (url || phone)) {
    const row = document.createElement("span");
    row.append(span(t("officialContact")), ` ${entry.agency}`);
    if (phone) {
      const a = document.createElement("a");
      a.href = `tel:${phone.replace(/[^\d+]/g, "")}`;
      a.append(span(t("call")), ` ${phone}`);
      row.append(" · ", a);
    }
    if (url) row.append(" · ", makeLink(url, span(t("website"))));
    el.append(row);
  }

  // FTC report link for anything that isn't "looks safe".
  const ftc = contacts.find((c) => c.agency === "FTC");
  const ftcUrl = ftc && officialUrl(ftc.url);
  if (v.verdict !== "safe" && ftcUrl && agency !== "FTC") {
    if (el.childNodes.length) el.append(document.createElement("br"));
    el.append(makeLink(ftcUrl, span(t("reportToFtc"))));
  }

  el.hidden = !el.childNodes.length;
}

function addChecklistLine(step) {
  // The line is added right away (keeps the order); its text is translated after.
  const li = document.createElement("li");
  const mark = document.createElement("span");
  mark.className = `mark ${step.status}`;
  mark.textContent = step.status === "fail" ? "✗" : step.status === "pass" ? "✓" : "…";
  li.append(mark, span(step.label), " — ", span(step.detail));
  $("checklist").append(li);
}

// ---------- Checks ----------

function setBusy(busy) {
  state.busy = busy;
  setText($("check"), t(busy ? "checking" : "check"));
  updateButtons();
}

async function startQuickCheck(text) {
  const run = ++state.run;
  setBusy(true);
  try {
    const v = await runQuickCheck(text);
    if (run !== state.run) return;
    renderVerdict(v);
    setStatus(baseStatus());
  } catch {
    if (run === state.run) setStatus(t("errorGeneric"));
  } finally {
    if (run === state.run) setBusy(false);
  }
}

async function startDeepCheck() {
  const text = $("message").value.trim();
  const imageDataUrl = state.imageDataUrl;
  if (!text && !imageDataUrl) return setStatus(t("emptyInput"));

  if (!navigator.onLine) {
    // No internet: show the offline Quick Check if there is text, and say why.
    if (text) await startQuickCheck(text);
    return setStatus(t("deepCheckNeedsInternet"));
  }

  const run = ++state.run;
  const previous = state.verdict;
  setBusy(true);
  showResultView();
  setStatus(baseStatus());

  // The reasons area is replaced by the live checklist (PRD section 5).
  $("verdict-line").hidden = !previous;
  $("steps-block").hidden = !previous;
  $("reasons-block").hidden = true;
  $("checklist-block").hidden = false;
  $("checklist").replaceChildren();

  try {
    const v = await runDeepCheck({ text, imageDataUrl }, (step) => {
      if (run === state.run && step) addChecklistLine(step);
    });
    if (run !== state.run) return;
    renderVerdict(v);
    // The engine falls back to Quick Check when the server can't be reached.
    if (v.mode !== "deep") setStatus(t("deepCheckNeedsInternet"));
  } catch {
    if (run !== state.run) return;
    if (previous) renderVerdict(previous);
    else showInputView();
    setStatus(t("errorGeneric"));
  } finally {
    if (run === state.run) setBusy(false);
  }
}

$("check").addEventListener("click", () => {
  const text = $("message").value.trim();
  if (state.imageDataUrl) return startDeepCheck();
  if (!text) return setStatus(t("emptyInput"));
  startQuickCheck(text);
});

$("message").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !state.busy) $("check").click();
});

$("deep-check").addEventListener("click", () => startDeepCheck());

$("new-check").addEventListener("click", () => {
  state.run++; // ignore any check still running
  state.verdict = null;
  $("message").value = "";
  clearScreenshot();
  setBusy(false);
  showInputView();
  setStatus(baseStatus());
  $("message").focus();
});

// ---------- Ask family ----------

$("ask-family").addEventListener("click", async () => {
  if (!state.verdict) return;
  try {
    const message = await translate(state.verdict.familyMessage, lang());
    await navigator.clipboard.writeText(message);
    setStatus(t("copied"), { flash: true });
  } catch {
    setStatus(t("copyFailed"), { flash: true });
  }
});

// ---------- Screenshot ----------

function setScreenshot(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.imageDataUrl = reader.result;
    $("upload-label").hidden = true;
    $("file-info").hidden = false;
    $("file-info").title = file.name || "";
    $("image-note").hidden = false;
    setStatus(baseStatus());
  };
  reader.readAsDataURL(file);
}

function clearScreenshot() {
  state.imageDataUrl = null;
  $("screenshot").value = "";
  $("upload-label").hidden = false;
  $("file-info").hidden = true;
  $("image-note").hidden = true;
}

$("screenshot").addEventListener("change", (e) => setScreenshot(e.target.files && e.target.files[0]));
$("remove-file").addEventListener("click", clearScreenshot);

// Pasting an image (e.g. Cmd+V after a screenshot) works like uploading it.
$("message").addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) {
    e.preventDefault();
    setScreenshot(item.getAsFile());
  }
});

// ---------- Language ----------

$("lang").addEventListener("change", () => {
  const L = lang();
  // Must start right after the user's selection — Chrome only allows the download then.
  prepareTranslation(L)
    .then((status) => {
      // While the language downloads, the popup shows English; redraw a few times so it switches when ready.
      if (status === "downloading") [3000, 8000, 15000, 30000].forEach((ms) => setTimeout(repaintAll, ms));
    })
    .catch(() => {});
  try {
    chrome.storage.local.set({ lang: L });
  } catch {}
  document.documentElement.lang = L;
  repaintAll();
});

// ---------- Online / offline ----------

function updateOnline() {
  updateButtons();
  setStatus(baseStatus());
}
window.addEventListener("online", updateOnline);
window.addEventListener("offline", updateOnline);

// ---------- Start ----------

async function init() {
  let saved = "en";
  try {
    const r = await chrome.storage.local.get("lang");
    if (LANGS.includes(r.lang)) saved = r.lang;
  } catch {}
  $("lang").value = saved;
  document.documentElement.lang = saved;

  try {
    strings = { ...DEFAULT_STRINGS, ...(await loadData("ui_strings.json")) };
  } catch {}
  try {
    contacts = await loadData("official_contacts.json");
  } catch {}

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.dataset.en = t(el.dataset.i18n);
  });
  updateOnline();
  repaintAll();
}

init();
