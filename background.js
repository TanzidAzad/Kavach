// background.js — Role 1 (UI). Service worker.
// Its job: when something asks for a check, save what to check and show Kavach.
// Kavach shows as a FLOATING PANEL over the page (sidepanel/float.js → sidepanel.html?float=1).
// Chrome's side panel is only the backup, for pages we can't draw on (chrome://, Web Store, …).
//
// Messages it understands:
//   { type: "KAVACH_CHECK", text, url, mode, imageDataUrl?, tabId? }
//       From the card on a web page (content script) or from the toolbar popup.
//       Saves { text, url, mode, imageDataUrl, ts } to chrome.storage.session "pendingCheck",
//       then shows the floating panel in that tab. Answers { floated: true | false }.
//       (panelOpened: true = the popup already opened the side panel; just save.)
//   { type: "KAVACH_READ_TAB", tabId, url, mode }
//       From the popup's "Check this page" button. Reads the page with extractPageText()
//       (content/extract.js), saves the pendingCheck, shows the floating panel. Answers { floated }.
//   { type: "KAVACH_SCREEN", text }
//       From content/detect.js for every opened email/chat. text is ALREADY MASKED on the device.
//       POSTs it to our server's /api/screen (Nemotron, 6 s limit). Answers { verdict, reason } or { error }
//       (then detect.js uses Quick Check locally).
//
// If the floating panel can't be shown and Chrome also refuses the side panel, we fall back to:
// a "!" badge on the Kavach icon, a notification, and one click on the icon opens the side panel.

const MAX_TEXT = 20000;

// ---------- Floating panel ----------

// toggle: true = the Kavach icon was clicked → close the panel if it's already open (like Control Center).
async function showFloat(tabId, { toggle = false } = {}) {
  if (tabId == null) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: (t) => { window.__kavachToggle = t; }, args: [toggle] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["sidepanel/float.js"] });
    return true;
  } catch (err) {
    console.warn("[Kavach] can't float on this page:", err?.message || err);
    return false; // page we can't draw on
  }
}

// Kavach icon in the toolbar → floating launcher (Check this page / paste / upload).
// Pages we can't draw on (chrome://, Web Store, PDF viewer…) → side panel instead, opened right away in the click.
const CAN_FLOAT = /^(https?|file):/i;
chrome.action.onClicked.addListener((tab) => {
  if (tab?.id == null) return;
  if (!CAN_FLOAT.test(tab.url || "")) {
    openPanel({ tabId: tab.id, windowId: tab.windowId }).catch(() => {});
    return;
  }
  chrome.storage.session.remove("pendingCheck").catch(() => {}); // start fresh
  showFloat(tab.id, { toggle: true }).then((ok) => {
    if (!ok) openPanel({ tabId: tab.id, windowId: tab.windowId }).catch(() => fallback(tab.id));
  });
});

// ---------- Opening the side panel (backup) ----------

function openPanel({ tabId, windowId }) {
  // Must be called right away (no await before it), or Chrome forgets the user's click.
  try {
    if (tabId != null) return chrome.sidePanel.open({ tabId });
    if (windowId != null) return chrome.sidePanel.open({ windowId });
    return Promise.reject(new Error("no tab"));
  } catch (err) {
    return Promise.reject(err);
  }
}

function savePending(check) {
  const pendingCheck = {
    text: String(check.text ?? "").slice(0, MAX_TEXT),
    url: String(check.url ?? ""),
    mode: check.mode === "talk" ? "talk" : "check",
    imageDataUrl: typeof check.imageDataUrl === "string" ? check.imageDataUrl : null,
    problem: check.problem || null, // e.g. "cantReadPage" — the side panel explains it in plain words
    source: check.source === "page" ? "page" : "message", // "page" = read from the tab ("Check this page")
    ts: Date.now()
  };
  return chrome.storage.session.set({ pendingCheck });
}

// ---------- Fallback when Chrome blocks opening ----------

async function label(key, english) {
  try {
    const { lang } = await chrome.storage.local.get("lang");
    const url = chrome.runtime.getURL("data/ui_strings.json");
    const strings = await (await fetch(url)).json();
    return (lang && strings?.[lang]?.[key]) || strings?.[key] || english;
  } catch {
    return english;
  }
}

async function fallback(tabId) {
  try {
    // One click on the Kavach icon now opens the side panel (the panel switches this back).
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    if (tabId != null) {
      await chrome.action.setBadgeText({ tabId, text: "!" });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#D93025" });
    }
    chrome.notifications.create("kavach-open", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("sidepanel/brand/icon128.png"),
      title: "Kavach",
      message: await label("clickIconToSee", "Click the Kavach icon (top right) to see the check."),
      priority: 2
    });
  } catch (err) {
    console.warn("[Kavach] fallback failed", err);
  }
}

// Clicking the notification is a click, so Chrome may let us open the panel from it.
chrome.notifications.onClicked.addListener((id) => {
  if (id !== "kavach-open") return;
  chrome.notifications.clear(id);
  chrome.windows.getLastFocused().then((w) => chrome.sidePanel.open({ windowId: w.id })).catch(() => {});
});

// ---------- Reading the page ("Check this page") ----------

async function readTab(tabId) {
  try {
    // Role 2's reader. It defines extractPageText() on the page.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content/extract.js"] });
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (typeof extractPageText === "function" ? extractPageText() : null)
    });
    const out = res?.result;
    const text = typeof out === "string" ? out : out?.text;
    if (text && text.trim()) return text;
  } catch {
    // extract.js not there yet, or the page can't be read — try the simple way below.
  }
  // Simple reader: highlighted text if any, otherwise the visible text of the page.
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const picked = String(getSelection() || "").trim();
      return picked || (document.body?.innerText || "").trim().slice(0, 6000);
    }
  });
  return res?.result || "";
}

// ---------- Ping when the page card appears ----------
// Role 2's card sends { type: "KAVACH_CARD_SHOWN" }. The sound plays from a hidden offscreen page,
// because web pages often block sound until the user clicks.

const OFFSCREEN_URL = "sidepanel/offscreen.html";
const PING_GAP_MS = 5000; // never ping twice within 5 s
let lastPingAt = 0;
let creatingOffscreen = null;

async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_URL);
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (existing.length) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({ url: OFFSCREEN_URL, reasons: ["AUDIO_PLAYBACK"], justification: "Soft ping when Kavach shows a warning card" })
    .finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

async function playPing() {
  if (Date.now() - lastPingAt < PING_GAP_MS) return { played: false, skipped: true };
  lastPingAt = Date.now();
  try {
    await ensureOffscreen();
    return await chrome.runtime.sendMessage({ type: "KAVACH_PING", target: "offscreen" });
  } catch (err) {
    console.warn("[Kavach] ping failed", err?.message || err);
    return { played: false };
  }
}

// ---------- Screening opened emails/chats (KAVACH_SCREEN) ----------

const SCREEN_URL = "http://localhost:8787/api/screen";
const SCREEN_TIMEOUT_MS = 6000;

async function screen(text, pageUrl) {
  try {
    const r = await fetch(SCREEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: String(text ?? "").slice(0, 4000), pageUrl: String(pageUrl ?? "") }),
      signal: AbortSignal.timeout(SCREEN_TIMEOUT_MS)
    });
    const json = await r.json().catch(() => null);
    if (r.ok && json && typeof json.verdict === "string") return { verdict: json.verdict, reason: String(json.reason || "") };
    return { error: json?.error || "screen_unavailable" };
  } catch (err) {
    return { error: err?.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}

// ---------- Messages ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "KAVACH_CHECK") {
    // The popup names the tab it was opened on; the page card is in sender.tab.
    const tabId = msg.tabId ?? sender.tab?.id;
    const windowId = msg.windowId ?? sender.tab?.windowId;
    const url = msg.url || sender.tab?.url || "";

    if (msg.panelOpened) {
      savePending({ ...msg, url }).finally(() => sendResponse({ ok: true }));
      return true;
    }
    // Save first, so the panel finds the check as soon as it loads; then float it over the page.
    savePending({ ...msg, url })
      .then(() => showFloat(tabId))
      .then(async (floated) => {
        if (!floated) {
          try {
            await openPanel({ tabId, windowId });
          } catch (err) {
            console.warn("[Kavach] could not show the panel:", err?.message || err);
            fallback(tabId);
          }
        }
        sendResponse({ ok: true, floated });
      });
    return true; // we answer later
  }

  if (msg?.type === "KAVACH_SCREEN") {
    screen(msg.text, sender.tab?.url).then(sendResponse);
    return true;
  }

  if (msg?.type === "KAVACH_CARD_SHOWN") {
    playPing().then(sendResponse);
    return true;
  }

  if (msg?.type === "KAVACH_READ_TAB") {
    // From the floating panel: sender.tab is the page it sits on. From the side panel: the active tab.
    const target = msg.tabId != null
      ? Promise.resolve({ id: msg.tabId, url: msg.url })
      : sender.tab
        ? Promise.resolve(sender.tab)
        : chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => t || {});
    target
      .then((tab) =>
        readTab(tab.id)
          .then((text) => savePending({ text, url: tab.url, mode: msg.mode, source: "page", problem: text ? null : "cantReadPage" }))
          .catch(() => savePending({ text: "", url: tab.url, mode: msg.mode, source: "page", problem: "cantReadPage" }))
          .then(() => !!sender.tab) // the panel that asked picks the check up by itself
      )
      .then((floated) => sendResponse({ ok: true, floated }));
    return true;
  }
});
