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
  closeSendSheet();
  $("again").hidden = true;
  $("problem").hidden = !problemKey;
  if (problemKey) setText($("problem"), t(problemKey));
  setStatus("");
  updateCheckButton();
}

// While checking, only the small "thinking" lines show.
function showChecking(headingKey) {
  $("start-view").hidden = true;
  $("result-view").hidden = false;
  for (const id of ["meter-block", "answer", "details", "more", "again", "family-form", "send-sheet"]) $(id).hidden = true;
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
  setText($("talk-label"), t(on ? "stopTalking" : "cardTalk"));
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

// The (i) next to "Speaks your language" shows the languages the voice speaks (native names).
async function renderVoiceLanguages() {
  const { VOICE_LANGUAGES = [] } = await loadVoice();
  const names = VOICE_LANGUAGES.map((l) => (typeof l === "string" ? l : l.native || l.name || l.code)).filter(Boolean);
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

const familyMessage = () => translate(state.verdict?.familyMessage || "", lang());

// Opens mailto: / sms: links. target="_blank" so the link opens OUTSIDE our frame: in the floating
// panel we are an iframe inside the web page, and an sms:/mailto: link opened inside the iframe
// shows Chrome's "This content is blocked" page instead of opening Messages / the mail app.
function openLink(href) {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.click();
}

async function sendWhatsApp(fam) {
  chrome.tabs.create({ url: `https://wa.me/${fam.phone}?text=${encodeURIComponent(await familyMessage())}` });
}

async function sendEmail(fam) {
  const subject = await tr(t("familySubject"), lang());
  const body = await familyMessage();
  openLink(`mailto:${encodeURIComponent(fam.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
}

// iMessage: sms: link to a phone (+1 for US numbers) or an Apple ID email.
// For the QR, letters like Hindi/Chinese stay as they are (UTF-8) and only spaces/symbols are %-encoded:
// that keeps the code ~3x smaller, so it stays easy to scan. The Mac link is fully encoded.
const QR_MAX_BYTES = 480;
const qrBody = (t) => t.replace(/[%&#?+=\s\u0000-\u001f]/g, (ch) => encodeURIComponent(ch));
const bytes = (str) => new TextEncoder().encode(str).length;
function smsLink(fam, message) {
  const to = fam.phone ? `+${fam.phone}` : fam.email;
  const qr = (text) => `sms:${to}?&body=${qrBody(text)}`;
  let text = message;
  while (bytes(qr(text)) > QR_MAX_BYTES && text.length > 20) text = text.slice(0, Math.floor(text.length * 0.9)).trimEnd() + "…";
  return { full: `sms:${to}?&body=${encodeURIComponent(message)}`, qr: qr(text) };
}
const isMac = () => /mac/i.test(navigator.userAgentData?.platform || navigator.platform || "");

async function sendIMessage(fam) {
  const message = await familyMessage();
  const link = smsLink(fam, message);
  if (isMac()) {
    openLink(link.full); // Messages opens with the text filled in
    closeSendSheet();
    setStatus(t("openingMessages"), { flash: true });
    return;
  }
  // Windows etc.: scan the QR with an iPhone. Also copy the message so it can be pasted anywhere.
  try { await navigator.clipboard.writeText(message); } catch {}
  drawQr($("qr-box"), link.qr);
  $("send-choices").hidden = true;
  $("send-qr").hidden = false;
}

// QR as an SVG, drawn from the bundled qrcode-generator (window.qrcode). Made on this computer.
function drawQr(box, text) {
  box.replaceChildren();
  if (typeof window.qrcode !== "function") return;
  window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs["UTF-8"]; // Hindi / Chinese
  const qr = window.qrcode(0, "L"); // "L" holds the most text in the fewest squares
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const pad = 4;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${n + pad * 2} ${n + pad * 2}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code");
  svg.setAttribute("shape-rendering", "crispEdges");
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + pad} ${r + pad}h1v1h-1z`;
  const bg = document.createElementNS(NS, "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#fff");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000");
  svg.append(bg, path);
  box.append(svg);
}

// The "How should we send it?" sheet
let sendingTo = null;
function openSendSheet(fam) {
  sendingTo = fam;
  $("family-form").hidden = true;
  $("send-whatsapp").hidden = !fam.phone;
  $("send-email").hidden = !fam.email;
  $("send-choices").hidden = false;
  $("send-qr").hidden = true;
  $("send-sheet").hidden = false;
  (fam.phone ? $("send-whatsapp") : $("send-email")).focus();
}
function closeSendSheet() {
  $("send-sheet").hidden = true;
  $("qr-box").replaceChildren();
}
$("send-whatsapp").addEventListener("click", () => { sendWhatsApp(sendingTo); closeSendSheet(); });
$("send-email").addEventListener("click", () => { sendEmail(sendingTo); closeSendSheet(); });
$("send-imessage").addEventListener("click", () => sendIMessage(sendingTo));
$("send-cancel").addEventListener("click", closeSendSheet);
$("send-done").addEventListener("click", closeSendSheet);

$("family").addEventListener("click", async () => {
  const fam = await getFamily();
  if (fam) return openSendSheet(fam);
  openFamilyForm(); // first time: name + phone/email, then the sheet
});

function openFamilyForm(fam = null) {
  closeSendSheet();
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
  openSendSheet(fam);
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
  const report = ftcSummary();
  try { await navigator.clipboard.writeText(report); } catch {}
  // content/detect.js types this into the FTC form's "what happened" box (never submits it).
  try { await chrome.storage.local.set({ ftcDraft: { text: report, at: Date.now() } }); } catch {}
  setStatus(t("copiedPasteForm"), { flash: true });
  const ftc = contacts.find((c) => c.agency === "FTC");
  const url = ftc && officialUrl(ftc.url);
  if (url) chrome.tabs.create({ url: url.href });
});

// ---------- Start screen = launcher ----------

// "Check this page": background.js reads the page this panel sits on (or the active tab, in the side panel).
$("check-page").addEventListener("click", () => {
  showChecking("readingPage");
  chrome.runtime.sendMessage({ type: "KAVACH_READ_TAB", mode: "check" }).catch(() => showStart("cantReadPage"));
});

// "Check this message" only shows once something is pasted or uploaded.
function updateCheckButton() {
  $("check").hidden = !$("message").value.trim() && !state.imageDataUrl;
}
$("message").addEventListener("input", updateCheckButton);

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
    updateCheckButton();
  };
  reader.readAsDataURL(file);
}
function clearScreenshot() {
  state.imageDataUrl = null;
  $("screenshot").value = "";
  $("upload-label").hidden = false;
  $("file-info").hidden = true;
  $("image-note").hidden = true;
  updateCheckButton();
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

// "Check another message" → back to the launcher.
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

// Esc closes an open sheet (family form or "How should we send it?"). Returns true if one was open.
function closeOpenSheet() {
  if (!$("send-sheet").hidden) { closeSendSheet(); return true; }
  if (!$("family-form").hidden) { $("family-form").hidden = true; return true; }
  return false;
}

// ---------- Floating panel mode (inside float.js's frame on the page) ----------

const FLOAT = new URLSearchParams(location.search).has("float");

// Compact styles for short windows. In the floating panel, use the page window's height (sent by float.js).
function sizeClasses() {
  const h = Number(new URLSearchParams(location.search).get("vh")) || innerHeight;
  document.body.classList.toggle("short", h <= 760);
  document.body.classList.toggle("tiny", h <= 620);
  document.body.style.setProperty("--details-max", `${Math.max(240, h - 300)}px`); // "Show more" fits the window
}
sizeClasses();
if (!FLOAT) addEventListener("resize", sizeClasses);
function closeFloat() {
  stopTalking();
  window.parent.postMessage({ kavach: "close" }, "*"); // float.js checks it came from this frame
}
if (!FLOAT) addEventListener("keydown", (e) => { if (e.key === "Escape") closeOpenSheet(); });
if (FLOAT) {
  // --- Light that follows the mouse ---
  const glow = $("glow");
  let gx = 0, gy = 0, glowFrame = 0;
  addEventListener("pointermove", (e) => {
    gx = e.clientX; gy = e.clientY;
    document.body.classList.add("hovering");
    if (!glowFrame) glowFrame = requestAnimationFrame(() => {
      glowFrame = 0;
      glow.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
    });
  }, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => document.body.classList.remove("hovering"));

  // --- Drag the panel by its top bar (anywhere except the language picker and ✕) ---
  // Screen coordinates stay steady while the frame moves under the mouse; float.js moves the frame.
  const head = document.querySelector("header");
  let drag = null, dragFrame = 0;
  head.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button, select, a, input")) return;
    drag = { x: e.screenX, y: e.screenY, dx: 0, dy: 0 };
    head.setPointerCapture(e.pointerId);
    document.body.classList.add("dragging");
    // The page also follows the mouse (in case it leaves this frame on a fast move): both use screen coordinates.
    window.parent.postMessage({ kavach: "drag-start", sx: e.screenX, sy: e.screenY }, "*");
    e.preventDefault();
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.dx = e.screenX - drag.x;
    drag.dy = e.screenY - drag.y;
    if (!dragFrame) dragFrame = requestAnimationFrame(() => {
      dragFrame = 0;
      if (drag) window.parent.postMessage({ kavach: "drag-move", dx: drag.dx, dy: drag.dy }, "*");
    });
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove("dragging");
    window.parent.postMessage({ kavach: "drag-end" }, "*");
  };
  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", endDrag);
  addEventListener("message", (e) => {
    // The page saw the mouse button go up (outside this frame): stop here too.
    if (e.source === window.parent && e.data?.kavach === "drag-ended" && drag) {
      drag = null;
      document.body.classList.remove("dragging");
    }
  });

  document.documentElement.classList.add("float");
  document.body.classList.add("float");
  $("close").hidden = false;
  $("close").addEventListener("click", closeFloat);
  // Tell float.js how tall the content is, so the frame fits it (no empty space, no scrolling).
  const report = () => window.parent.postMessage({ kavach: "size", height: Math.ceil(document.body.scrollHeight) }, "*");
  new ResizeObserver(report).observe(document.body);
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (closeOpenSheet()) return; // Esc closes a sheet first
    closeFloat();
  });
}

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
