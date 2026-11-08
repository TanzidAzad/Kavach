// background.js — Role 1 (UI). Service worker.
// Its only job: when something asks for a check, save what to check and open the side panel.
//
// Messages it understands:
//   { type: "KAVACH_CHECK", text, url, mode, imageDataUrl? }
//       From the card on a web page (content script) or from the toolbar popup.
//       Saves { text, url, mode, imageDataUrl, ts } to chrome.storage.session "pendingCheck"
//       and opens the side panel for that tab.
//   { type: "KAVACH_READ_TAB", tabId, windowId, mode }
//       From the popup's "Check this page" button. Reads the page with extractPageText()
//       (content/extract.js), then saves the pendingCheck. Done here, not in the popup,
//       because the popup closes as soon as the side panel opens.
//
// If Chrome refuses to open the side panel (it only allows it right after a click),
// we fall back to: a "!" badge on the Kavach icon, a notification, and the icon is
// switched so that one click on it opens the side panel straight away.

const MAX_TEXT = 20000;

// ---------- Opening the side panel ----------

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
      iconUrl: chrome.runtime.getURL("sidepanel/icon128.png"),
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

// ---------- Messages ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "KAVACH_CHECK") {
    const tabId = sender.tab?.id ?? msg.tabId;
    const windowId = sender.tab?.windowId ?? msg.windowId;
    const url = msg.url || sender.tab?.url || "";

    // 1) open first (keeps the click), 2) then save. The panel also listens for the save.
    const opening = msg.panelOpened ? Promise.resolve() : openPanel({ tabId, windowId });
    savePending({ ...msg, url });
    opening.then(
      () => sendResponse({ ok: true, opened: true }),
      (err) => {
        console.warn("[Kavach] side panel blocked:", err?.message || err);
        fallback(tabId);
        sendResponse({ ok: true, opened: false });
      }
    );
    return true; // we answer later
  }

  if (msg?.type === "KAVACH_READ_TAB") {
    chrome.runtime.sendMessage({ type: "KAVACH_READING" }).catch(() => {}); // panel shows "Reading the page…"
    readTab(msg.tabId)
      .then((text) => savePending({ text, url: msg.url, mode: msg.mode, problem: text ? null : "cantReadPage" }))
      .catch(() => savePending({ text: "", url: msg.url, mode: msg.mode, problem: "cantReadPage" }))
      .finally(() => sendResponse({ ok: true }));
    return true;
  }
});
