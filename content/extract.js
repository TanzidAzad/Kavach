// content/extract.js — Role 2 (Core Engine)
// extractPageText() → { text, source }
//   source: "gmail" | "outlook" | "whatsapp" | "selection" | "page" | "none"
//
//   Gmail          → the open email's subject + body
//   Outlook web    → the open message's subject + body
//   WhatsApp Web   → the last ~10 messages in the open chat (messages from the other person)
//   anything else  → the user's selected text, else the page's main visible text
//   Text is cut to 4000 characters.
//
// SELF-CONTAINED on purpose: everything is inside the one function, so it can be
// injected into a tab with chrome.scripting.executeScript. Two ways (popup / background):
//
//   // 1. pass the function itself (popup.html must load this file with a <script> tag first)
//   const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: extractPageText });
//
//   // 2. inject the file, then call it
//   await chrome.scripting.executeScript({ target: { tabId }, files: ["content/extract.js"] });
//   const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => extractPageText() });
//
// content/detect.js also calls it (list extract.js BEFORE detect.js in the manifest).
// Plain script, not a module: no import/export.

// hostForTest: only used by content/extract.test.html to pretend to be Gmail etc.
function extractPageText(hostForTest) {
  const MAX = 4000;
  const host = String((typeof hostForTest === "string" && hostForTest) || location.hostname || "").toLowerCase();

  // Only count elements the user can actually see (Gmail keeps old emails hidden in the page).
  const visible = (el) => !!el && el.getClientRects().length > 0;
  const textOf = (el) => (el ? String(el.innerText || el.textContent || "") : "");
  const lastVisible = (selector, root) => {
    const all = [...(root || document).querySelectorAll(selector)].filter(visible);
    return all[all.length - 1] || null;
  };
  const tidy = (s) =>
    String(s || "")
      .replace(/ /g, " ")
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX);
  const done = (text, source) => ({ text: tidy(text), source: text && tidy(text) ? source : "none" });
  const join = (subject, body) => [subject, body].map((s) => String(s || "").trim()).filter(Boolean).join("\n\n");

  try {
    // ---- Gmail ----
    if (host === "mail.google.com") {
      const subjectEl = lastVisible("h2.hP") || lastVisible("[role='main'] h2[data-thread-perm-id]");
      const bodyEl = lastVisible("div.a3s.aiL") || lastVisible("div.a3s");
      if (bodyEl) return done(join(textOf(subjectEl), textOf(bodyEl)), "gmail");
    }

    // ---- Outlook on the web ----
    if (/(^|\.)outlook\.(live|office|office365)\.com$/.test(host)) {
      const pane =
        document.querySelector("#ReadingPaneContainerId") ||
        document.querySelector("[data-app-section='ConversationContainer']") ||
        document.querySelector("[role='main']") ||
        document;
      const bodyEl =
        lastVisible("[aria-label='Message body']", pane) ||
        lastVisible("[role='document']", pane);
      const subjectEl =
        lastVisible("[role='heading'][aria-level='2']", pane) ||
        lastVisible("[role='heading']", pane);
      if (bodyEl) return done(join(textOf(subjectEl), textOf(bodyEl)), "outlook");
    }

    // ---- WhatsApp Web ----
    if (host === "web.whatsapp.com") {
      const chat = document.querySelector("#main");
      if (chat) {
        // Each message bubble has a "copyable-text" box with data-pre-plain-text="[10:32, 11/8/2026] Name: ".
        let bubbles = [...chat.querySelectorAll("[data-pre-plain-text]")];
        if (bubbles.length === 0) bubbles = [...chat.querySelectorAll(".message-in, .message-out")];
        const messages = bubbles
          .map((el) => ({
            incoming: !!el.closest(".message-in"),
            text: textOf(el.querySelector(".selectable-text") || el).trim()
          }))
          .filter((m) => m.text);
        // Prefer what the OTHER person wrote: the user's own replies cause false alarms.
        const incoming = messages.filter((m) => m.incoming);
        const picked = (incoming.length ? incoming : messages).slice(-10);
        if (picked.length) return done(picked.map((m) => m.text).join("\n"), "whatsapp");
      }
    }

    // ---- Selected text ----
    const selection = String(window.getSelection ? window.getSelection() : "").trim();
    if (selection) return done(selection, "selection");

    // ---- Main visible text ----
    const candidates = [...document.querySelectorAll("main, [role='main'], article")].filter(visible);
    let best = null;
    for (const el of candidates) {
      if (!best || textOf(el).length > textOf(best).length) best = el;
    }
    const pageText = textOf(best).trim() ? textOf(best) : textOf(document.body);
    return done(pageText, "page");
  } catch (err) {
    return { text: "", source: "none" };
  }
}
