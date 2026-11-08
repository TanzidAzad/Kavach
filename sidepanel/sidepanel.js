// sidepanel/sidepanel.js — Role 1 (UI). The one calm screen in Chrome's side panel.
// Flow: read "pendingCheck" (saved by background.js or the popup) → run Deep Check
// (it falls back to Quick Check by itself) → live checklist → meter + ≤3 reasons + ≤3 steps
// → official contact (from data only) → voice / family / FTC when it looks like a scam.

import { runQuickCheck } from "../core/quickcheck.js";
import { runDeepCheck } from "../agent/agent.js";
import { translate, prepareTranslation } from "../core/translate.js";
import { loadData } from "../core/data.js";
import { scamLevel, loadVoice, ready as contractsReady } from "./contracts.js";
import {
  LANGS, initI18n, t, tr, setText, span, repaintAll, officialUrl, makeLink, downloadingMessage, savedLang
} from "./i18n.js";

const $ = (id) => document.getElementById(id);
const lang = () => $("lang").value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LINE_GAP_MS = 300;
const FRESH_MS = 10 * 60 * 1000; // a pendingCheck older than this is ignored

const state = {
  run: 0,             // id of the latest check; older results are ignored
  verdict: null,
  level: null,
  input: null,        // { text, imageDataUrl, url, mode }
  imageDataUrl: null, // screenshot chosen on the start screen
  speaking: false,
  statusTimer: null
};
let contacts = [];

// ---------- Status line ----------

function setStatus(english, { flash = false } = {}) {
  clearTimeout(state.statusTimer);
  setText($("status"), english || "");
  if (flash) state.statusTimer = setTimeout(() => setText($("status"), ""), 3000);
}

// ---------- Views ----------

function showStart(problemKey = null) {
  state.run++; // ignore anything still running
  stopTalking();
  $("start-view").hidden = false;
  $("result-view").hidden = true;
  $("family-form").hidden = true;
  $("again").hidden = true;
  $("problem").hidden = !problemKey;
  if (problemKey) setText($("problem"), t(problemKey));
  setStatus("");
  $("message").focus();
}

// While checking, only the small "thinking" lines show.
function showChecking(headingKey) {
  $("start-view").hidden = true;
  $("result-view").hidden = false;
  for (const id of ["meter-block", "answer", "details", "more", "again", "family-form"]) $(id).hidden = true;
  $("thinking").hidden = false;
  setText($("thinking-label"), t(headingKey));
  $("checklist").replaceChildren();
  $("thinking-slot").append($("checklist"));
  setStatus("");
}

// "Show more" swaps the answer area for: why + what Kavach checked. The page itself never scrolls.
function showDetails(open) {
  $("details").hidden = !open;
  $("answer").hidden = open;
  $("more").setAttribute("aria-expanded", String(open));
  $("more").replaceChildren(span(t(open ? "showLess" : "showMore")), open ? " ▴" : " ▾");
}
$("more").addEventListener("click", () => showDetails($("details").hidden));

// ---------- Checklist (lines appear one by one, ~300 ms apart) ----------

let lineQueue = Promise.resolve();
let lastLineAt = 0;

function queueLine(step, run) {
  lineQueue = lineQueue.then(async () => {
    if (run !== state.run) return;
    await wait(Math.max(0, lastLineAt + LINE_GAP_MS - Date.now()));
    if (run !== state.run) return;
    addLine(step);
    lastLineAt = Date.now();
  });
  return lineQueue;
}

function addLine(step) {
  const li = document.createElement("li");
  const mark = document.createElement("span");
  mark.className = `mark ${step.status}`;
  mark.textContent = step.status === "fail" ? "✗" : step.status === "pass" ? "✓" : "?";
  const label = span(step.label || "");
  label.className = "label";
  li.append(mark, label);
  if (step.detail) {
    const detail = span(step.detail);
    detail.className = "detail";
    li.append(" — ", detail);
  }
  $("checklist").append(li);
}

// ---------- Running a check ----------

async function runCheck(input) {
  const text = String(input.text || "").trim();
  const imageDataUrl = input.imageDataUrl || null;
  if (!text && !imageDataUrl) return showStart(input.problem || "emptyInput");

  stopTalking();
  const run = ++state.run;
  state.input = { ...input, text, imageDataUrl };
  state.verdict = null;
  showChecking("checking");
  lineQueue = Promise.resolve();
  lastLineAt = 0;

  let v;
  try {
    v = navigator.onLine
      ? await runDeepCheck({ text, imageDataUrl }, (step) => step && queueLine(step, run)) // never throws, ≤15 s
      : await runQuickCheck(text);
  } catch {
    v = null;
  }
  if (run !== state.run) return;
  if (!v && text) {
    try { v = await runQuickCheck(text); } catch {}
  }
  if (!v) return showStart("errorGeneric");

  // Quick Check doesn't call onStep: show its trace as the checklist instead.
  await lineQueue;
  if (run !== state.run) return;
  if (!$("checklist").children.length) for (const step of v.trace || []) queueLine(step, run);
  await lineQueue;
  await wait(LINE_GAP_MS);
  if (run !== state.run) return;

  renderVerdict(v);
  if (v.mode !== "deep") setStatus(t("quickOnly"));
  if (input.mode === "talk" && ["likely", "highly_likely"].includes(state.level)) talk();
}

// ---------- Result ----------

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
  state.level = scamLevel(v);

  $("thinking").hidden = true;
  $("details-slot").append($("checklist")); // the checks now live under "Show more"
  $("meter-block").className = `lvl-${state.level}`;
  $("meter-block").hidden = false;
  setText($("level-label"), t(state.level));
  tr(t(state.level)).then((label) => $("meter").setAttribute("aria-label", label));

  fillList($("reasons"), v.reasons);
  $("reasons-block").hidden = !(v.reasons || []).length;
  fillList($("steps"), v.steps);
  renderContact(v);
  showDetails(false);
  $("more").hidden = !(v.reasons || []).length && !$("checklist").children.length;

  const worried = state.level === "likely" || state.level === "highly_likely";
  $("help-block").hidden = !worried;
  if (worried) renderFamilyRow();

  $("again").hidden = false;
}

// Official contact. Values come ONLY from data/official_contacts.json.
function renderContact(v) {
  const el = $("contact");
  el.replaceChildren();
  const agency = v.officialContact?.agency;
  const entry = agency && contacts.find((c) => c.agency === agency);
  const url = entry?.url && officialUrl(entry.url);
  const phone = typeof entry?.phone === "string" && /^[\d\s().+-]{7,}$/.test(entry.phone) ? entry.phone.trim() : null;

  if (entry && (url || phone)) {
    el.append(span(t("officialContact")), ` ${entry.agency}`);
    if (phone) {
      const a = document.createElement("a");
      a.href = `tel:${phone.replace(/[^\d+]/g, "")}`;
      a.className = "phone";
      a.append(span(t("call")), ` ${phone}`);
      el.append(document.createElement("br"), a);
    }
    if (url) el.append(phone ? " · " : document.createElement("br"), makeLink(url, span(t("website"))));
  }
  el.hidden = !el.childNodes.length;
}

// ---------- Voice ----------

async function speakableSummary(voice) {
  const v = state.verdict;
  const L = lang();
  // Role 3's calm script ("Take a breath. You have time…"), translated; else our own summary.
  if (typeof voice?.fallbackText === "function") {
    try {
      const english = await voice.fallbackText(v);
      if (english) return await tr(english, L);
    } catch {}
  }
  const parts = [t(state.level), ...(v.reasons || []).slice(0, 3), ...(v.steps || []).slice(0, 3)];
  const said = await Promise.all(parts.map((p) => tr(String(p).replace(/https?:\/\/\S+/g, ""), L)));
  return said.join(". ");
}

function setTalking(on) {
  state.speaking = on;
  setText($("talk-label"), t(on ? "stopTalking" : "talkToKavach"));
}

async function talk() {
  if (!state.verdict) return;
  if (state.speaking) return stopTalking();
  const voice = await loadVoice();
  setTalking(true);
  const run = state.run;
  try {
    await voice.startVoice({ verdict: state.verdict, level: state.level, lang: lang(), text: state.input?.text || "" });
  } catch {
    // Live voice didn't work: read the answer and the steps aloud instead.
    try {
      if (run === state.run && state.speaking) await voice.speakFallback(await speakableSummary(voice), lang());
    } catch {}
  }
  if (run === state.run) setTalking(false);
}

function stopTalking() {
  if (!state.speaking) return;
  loadVoice().then((v) => v.stopVoice?.()).catch(() => {});
  try { speechSynthesis.cancel(); } catch {}
  setTalking(false);
}

async function renderVoiceLanguages() {
  const { VOICE_LANGUAGES = [] } = await loadVoice();
  const names = VOICE_LANGUAGES.map((l) => (typeof l === "string" ? l : l.name || l.label || l.code)).filter(Boolean);
  $("voice-langs").textContent = names.join(" · ");
}

$("talk").addEventListener("click", talk);
$("lang-info").addEventListener("click", async () => {
  const open = $("voice-langs").hidden;
  if (open) await renderVoiceLanguages();
  $("voice-langs").hidden = !open;
  $("lang-info").setAttribute("aria-expanded", String(open));
});

// ---------- Tell family ----------

async function getFamily() {
  try {
    return (await chrome.storage.local.get("familyContact")).familyContact || null;
  } catch {
    return null;
  }
}

function parseReach(raw) {
  const s = String(raw || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { email: s };
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length >= 7 && /^[\d\s().+-]+$/.test(s)) return { phone: digits.length === 10 ? "1" + digits : digits };
  return null;
}

async function renderFamilyRow() {
  const fam = await getFamily();
  $("family-change-row").hidden = !fam;
  if (fam) $("family-who").textContent = fam.name || fam.email || fam.phone;
}

async function sendToFamily(fam) {
  const L = lang();
  const message = await translate(state.verdict?.familyMessage || "", L);
  if (fam.phone) {
    chrome.tabs.create({ url: `https://wa.me/${fam.phone}?text=${encodeURIComponent(message)}` });
  } else if (fam.email) {
    const subject = await tr(t("familySubject"), L);
    const a = document.createElement("a");
    a.href = `mailto:${encodeURIComponent(fam.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
    a.click();
  }
}

$("family").addEventListener("click", async () => {
  const fam = await getFamily();
  if (fam) return sendToFamily(fam);
  openFamilyForm();
});

function openFamilyForm(fam = null) {
  $("family-name").value = fam?.name || "";
  $("family-reach").value = fam?.email || (fam?.phone ? "+" + fam.phone : "");
  $("family-form").hidden = false;
  $("family-name").focus();
}

$("family-change").addEventListener("click", async () => openFamilyForm(await getFamily()));
$("family-cancel").addEventListener("click", () => { $("family-form").hidden = true; });

$("family-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const reach = parseReach($("family-reach").value);
  if (!reach) return setStatus(t("familyInvalid"), { flash: true });
  const fam = { name: $("family-name").value.trim(), ...reach };
  try { await chrome.storage.local.set({ familyContact: fam }); } catch {}
  $("family-form").hidden = true;
  renderFamilyRow();
  sendToFamily(fam);
});

// ---------- Report to FTC ----------

function ftcSummary() {
  const v = state.verdict;
  const trace = v.trace || [];
  const asked =
    trace.find((s) => s.status === "fail" && /payment|pay|money|gift|wire|crypto/i.test(`${s.label} ${s.detail}`))?.detail ||
    (v.reasons || [])[0] ||
    "Not clear";
  const text = (state.input?.text || "").replace(/\s+/g, " ").slice(0, 500);
  return [
    "Scam report (checked with Kavach)",
    `Claimed to be from: ${v.officialContact?.agency || "Not clear"}`,
    `What they asked for: ${asked}`,
    `Result: ${t(state.level)}`,
    state.input?.url ? `Where I saw it: ${state.input.url}` : "",
    text ? `The message: "${text}"` : ""
  ].filter(Boolean).join("\n");
}

$("ftc").addEventListener("click", async () => {
  if (!state.verdict) return;
  try { await navigator.clipboard.writeText(ftcSummary()); } catch {}
  setStatus(t("copiedPasteForm"), { flash: true });
  const ftc = contacts.find((c) => c.agency === "FTC");
  const url = ftc && officialUrl(ftc.url);
  if (url) chrome.tabs.create({ url: url.href });
});

// ---------- Start screen ----------

$("check").addEventListener("click", () => {
  const text = $("message").value.trim();
  if (!text && !state.imageDataUrl) return setStatus(t("emptyInput"), { flash: true });
  runCheck({ text, imageDataUrl: state.imageDataUrl, mode: "check" });
});
$("message").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("check").click();
});

function setScreenshot(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.imageDataUrl = reader.result;
    $("upload-label").hidden = true;
    $("file-info").hidden = false;
    $("image-note").hidden = false;
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
$("screenshot").addEventListener("change", (e) => setScreenshot(e.target.files?.[0]));
$("remove-file").addEventListener("click", clearScreenshot);
$("message").addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) {
    e.preventDefault();
    setScreenshot(item.getAsFile());
  }
});

$("again").addEventListener("click", () => {
  $("message").value = "";
  clearScreenshot();
  showStart();
});

// ---------- Language ----------

function applyLang(L) {
  $("lang").value = L;
  document.documentElement.lang = L;
  repaintAll();
}

$("lang").addEventListener("change", () => {
  const L = lang();
  // Must start right after the user's choice: Chrome only allows the download then.
  prepareTranslation(L)
    .then((status) => {
      if (status !== "downloading") return;
      $("status").textContent = downloadingMessage(L);
      const poll = async () => {
        if (lang() !== L) return;
        if ((await prepareTranslation(L).catch(() => "unavailable")) === "downloading") return setTimeout(poll, 3000);
        setStatus("");
        repaintAll();
      };
      setTimeout(poll, 3000);
    })
    .catch(() => {});
  try { chrome.storage.local.set({ lang: L }); } catch {}
  applyLang(L);
});

// ---------- Incoming checks ----------

async function takePending() {
  try {
    const { pendingCheck } = await chrome.storage.session.get("pendingCheck");
    if (!pendingCheck) return null;
    await chrome.storage.session.remove("pendingCheck"); // run each one once
    return Date.now() - (pendingCheck.ts || 0) < FRESH_MS ? pendingCheck : null;
  } catch {
    return null;
  }
}

async function handlePending() {
  const p = await takePending();
  if (!p) return false;
  // The panel is showing now: undo the "click the icon" fallback, if it was used.
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
  chrome.action.setBadgeText({ text: "" }).catch(() => {});
  chrome.tabs.query({ active: true, currentWindow: true })
    .then(([tab]) => tab && chrome.action.setBadgeText({ tabId: tab.id, text: "" }))
    .catch(() => {});
  if (p.problem) {
    showStart(p.problem);
    return true;
  }
  runCheck(p);
  return true;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.pendingCheck?.newValue) handlePending();
  if (area === "local" && changes.lang?.newValue && changes.lang.newValue !== lang() && LANGS.includes(changes.lang.newValue)) {
    applyLang(changes.lang.newValue);
  }
});

// "Reading the page…" while the popup's "Check this page" is still reading.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "KAVACH_READING") showChecking("readingPage");
});

// ---------- Start ----------

async function init() {
  const L = await savedLang();
  await initI18n(lang);
  try { contacts = await loadData("official_contacts.json"); } catch {}
  await contractsReady;
  loadVoice(); // load early so the Talk click starts audio right away (Chrome needs it inside the click)
  applyLang(L);
  if (!(await handlePending())) showStart();
}

init();
