// popup/popup.js — Role 1 (UI). Toolbar popup = launcher only.
// Each button saves a check and opens the side panel, where the answer is shown.
// The side panel must be opened right inside the click (Chrome rule), so we never await before it.

import { initI18n, t, setText, repaintAll, savedLang, LANGS } from "../sidepanel/i18n.js";
import { prepareTranslation } from "../core/translate.js";

const $ = (id) => document.getElementById(id);
const lang = () => $("lang").value;
let tab = null;            // the tab the user is looking at
let imageDataUrl = null;   // chosen screenshot

function openPanel() {
  // Sync call inside the click. Prefer the tab; fall back to the window.
  try {
    return chrome.sidePanel.open(tab?.id != null ? { tabId: tab.id } : { windowId: tab?.windowId });
  } catch (err) {
    return Promise.reject(err);
  }
}

function sendCheck(check) {
  return chrome.runtime.sendMessage({ type: "KAVACH_CHECK", panelOpened: true, tabId: tab?.id, url: tab?.url || "", ...check });
}

const done = () => setTimeout(() => window.close(), 150);
const failed = () => setText($("status"), t("errorGeneric"));

// Big button: read this page (background.js does the reading, so it survives the popup closing).
$("check-page").addEventListener("click", () => {
  const opening = openPanel();
  chrome.runtime
    .sendMessage({ type: "KAVACH_READ_TAB", tabId: tab?.id, url: tab?.url || "", mode: "check" })
    .catch(() => {});
  opening.then(done, failed);
});

// Pasted text and/or a screenshot.
$("check-message").addEventListener("click", () => {
  const text = $("message").value.trim();
  if (!text && !imageDataUrl) return setText($("status"), t("emptyInput"));
  const opening = openPanel();
  sendCheck({ text, imageDataUrl, mode: "check", url: "" }).catch(() => {});
  opening.then(done, failed);
});

function updateCheckButton() {
  $("check-message").hidden = !$("message").value.trim() && !imageDataUrl;
}
$("message").addEventListener("input", updateCheckButton);
$("message").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("check-message").click();
});

// ---------- Screenshot ----------

function setScreenshot(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => {
    imageDataUrl = reader.result;
    $("upload-label").hidden = true;
    $("file-info").hidden = false;
    $("image-note").hidden = false;
    updateCheckButton();
  };
  reader.readAsDataURL(file);
}
$("screenshot").addEventListener("change", (e) => setScreenshot(e.target.files?.[0]));
$("remove-file").addEventListener("click", () => {
  imageDataUrl = null;
  $("screenshot").value = "";
  $("upload-label").hidden = false;
  $("file-info").hidden = true;
  $("image-note").hidden = true;
  updateCheckButton();
});
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
  prepareTranslation(L).catch(() => {}); // starts the download; must be right after the choice
  try { chrome.storage.local.set({ lang: L }); } catch {}
  document.documentElement.lang = L;
  repaintAll();
});

// ---------- Start ----------

async function init() {
  const L = await savedLang();
  $("lang").value = LANGS.includes(L) ? L : "en";
  document.documentElement.lang = lang();
  await initI18n(lang);
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {}
  repaintAll();
}

init();
