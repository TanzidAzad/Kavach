// content/detect.js — Role 2 (Core Engine)
// Runs inside web pages (content script). Needs content/extract.js loaded first (same "js" list).
//
// On Gmail, Outlook web and WhatsApp Web:
//   EVERY time an email / chat is opened, read its text, hide personal details ON THE DEVICE (core/mask.js),
//   and ask our server to screen it with Nemotron (background.js → POST /api/screen, { type: "KAVACH_SCREEN" }).
//   If Nemotron says "scam" or "suspicious", show a small calm card in the bottom-right:
//     ✕ (close, top-left)  "This message has signs of a scam. Want me to check it?"  [Check it] [Talk to Kavach]
//   No answer in 6 s / server down / offline → Quick Check runs locally instead (card on 1+ warning signs).
//   The card comes back every time the message is opened again. ✕ / Check it / Talk hide it only while
//   that same message stays open. Results are remembered per message for this page session, so reopening
//   shows the card instantly. Gmail loads long emails in pieces: if the text grows by >20%, we check again.
// On any other site:
//   If the site's own address imitates a real .gov site (checkLookalikeDomain), show the same card.
//
// Clicking a button sends: chrome.runtime.sendMessage({ type: "KAVACH_CHECK", text, url, mode: "check" | "talk" })
// It sits in a closed Shadow DOM so the page's CSS can't break it.

// ---------- which message is open (top-level so agent/test/screen_keys.test.mjs can test them) ----------

// Gmail: the thread id is the last part of the address after "#":
//   #inbox/FMfcgzQXJWDsKmwlMjRrhNvvrXHBzBJX · #search/rent+due/FMfcg… · #label/Work/FMfcg… · #all/18c3f…
// Not an id: #inbox (the list), #inbox/p2 (page 2), #search/some+words (search results).
function kavachGmailThreadId(hash) {
  const parts = String(hash || "").replace(/^#/, "").split("?")[0].split("/").filter(Boolean);
  if (parts.length < 2) return null;
  // These folders have one extra part (the search words / label name) before the id.
  const minParts = /^(search|label|category|advanced-search|apps)$/i.test(parts[0]) ? 3 : 2;
  if (parts.length < minParts) return null;
  const last = decodeURIComponent(parts[parts.length - 1]);
  if (/^p\d+$/i.test(last)) return null;
  return /^[A-Za-z0-9_-]{16,}$/.test(last) ? last : null;
}

// Gmail list views: #inbox, #inbox/p2, #search/words, #label/Work, #category/social.
function kavachGmailIsList(hash) {
  const parts = String(hash || "").replace(/^#/, "").split("?")[0].split("/").filter(Boolean);
  if (parts.length <= 1) return true;
  if (/^p\d+$/i.test(parts[parts.length - 1])) return true;
  return parts.length === 2 && /^(search|label|category|advanced-search|apps)$/i.test(parts[0]);
}

// Outlook web: …/mail/0/inbox/id/AQQkADAw… or ?ItemID=… (message or conversation id).
function kavachOutlookId(href) {
  try {
    const u = new URL(String(href || ""));
    const q = u.searchParams.get("ItemID") || u.searchParams.get("itemid") || u.searchParams.get("ConversationId");
    if (q) return q;
    const m = u.pathname.match(/\/id\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

// Small, fast text hash (FNV-1a) — only used to tell messages apart, never sent anywhere.
function kavachHash(str) {
  let h = 0x811c9dc5;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

(() => {
  if (window.top !== window || window.__kavachDetect) return; // top page only, run once
  window.__kavachDetect = true;

  const host = location.hostname.toLowerCase();
  const SITE =
    host === "mail.google.com" ? "gmail"
    : /(^|\.)outlook\.(live|office|office365)\.com$/.test(host) ? "outlook"
    : host === "web.whatsapp.com" ? "whatsapp"
    : null;

  const DEBOUNCE_MS = 800;
  const MIN_CHARS = 20;
  const log = (...a) => console.debug("[Kavach]", ...a); // developers only

  // ---------- loading our own code from the extension (works offline) ----------

  const url = (path) => chrome.runtime.getURL(path);
  const modules = {};
  const load = (path) => (modules[path] ||= import(url(path)));

  // ---------- card text in the user's language ----------

  // English text. Hand-written translations come from data/ui_strings.json (same keys, per language);
  // if a key is missing there, Chrome's on-device translator is used; if that isn't ready, English.
  const EN = {
    cardMessage: "This message has signs of a scam. Want me to check it?",
    cardWebsite: "This website may be pretending to be a government site. Want me to check it?",
    cardCheckIt: "Check it",
    cardTalk: "Talk to Kavach",
    cardClose: "Close" // read aloud by screen readers for the ✕ button
  };

  async function strings() {
    let lang = "en";
    try {
      lang = (await chrome.storage.local.get("lang")).lang || "en";
    } catch {}
    if (lang === "en") return EN;
    let handWritten = {};
    try {
      const { loadData } = await load("core/data.js");
      handWritten = (await loadData("ui_strings.json"))[lang] || {};
    } catch {}
    let translate = async (t) => t;
    try {
      translate = (await load("core/translate.js")).translate;
    } catch {}
    const out = {};
    for (const [key, english] of Object.entries(EN)) {
      out[key] = handWritten[key] || (await translate(english, lang).catch(() => english)) || english;
    }
    return out;
  }

  // ---------- the card ----------

  let cardHost = null;

  function hideCard() {
    if (cardHost) cardHost.remove();
    cardHost = null;
  }

  async function showCard({ kind, text, onDone, stillValid }) {
    hideCard();
    const s = await strings();
    if (stillValid && !stillValid()) return; // the user moved on while the text loaded
    hideCard(); // another card may have appeared meanwhile
    const box = document.createElement("div");
    box.style.display = "none"; // shown once our CSS has loaded, so it never flashes unstyled
    const root = box.attachShadow({ mode: "closed" });

    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = url("content/detect.css");
    css.onload = () => (box.style.display = "");
    root.append(css);

    const card = document.createElement("div");
    card.className = "card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Kavach");

    const button = (label, cls, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener("click", onClick);
      return b;
    };

    // ✕ in the top-left: closes the card; it won't come back for this message / site.
    const close = button("✕", "close", () => {
      hideCard();
      onDone?.();
    });
    close.setAttribute("aria-label", s.cardClose);
    close.title = s.cardClose;

    const head = document.createElement("div");
    head.className = "head";
    // Shield logo (Role 1's file, web-accessible in the manifest). If it can't load, just the name shows.
    const logo = document.createElement("img");
    logo.className = "logo";
    logo.src = url("sidepanel/brand/mark-dark.png");
    logo.alt = "";
    logo.addEventListener("error", () => logo.remove());
    head.append(close, logo, "Kavach");

    // ---- Drag the card by its header (anywhere except the ✕). Paste right after `head.append(close, logo, "Kavach");`
    // Moves the shadow host with the CSS "translate" property and stays inside the window.
    // While dragging, it listens on the whole page so a fast mouse move can't "lose" the card.
    let drag = null;
    const onMove = (e) => {
      if (!drag) return;
      const r = card.getBoundingClientRect();
      const [cx = 0, cy = 0] = (box.style.translate || "0px 0px").split(" ").map(parseFloat);
      const homeLeft = r.left - cx, homeTop = r.top - cy; // where it sits with no drag
      const x = Math.min(Math.max(drag.x0 + e.clientX - drag.sx, 8 - homeLeft), innerWidth - 8 - r.width - homeLeft);
      const y = Math.min(Math.max(drag.y0 + e.clientY - drag.sy, 8 - homeTop), innerHeight - 8 - r.height - homeTop);
      box.style.translate = `${x}px ${y}px`;
      e.preventDefault();
    };
    const onUp = () => {
      drag = null;
      card.classList.remove("dragging");
      removeEventListener("pointermove", onMove, true);
      removeEventListener("pointerup", onUp, true);
      removeEventListener("pointercancel", onUp, true);
    };
    head.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      const [x0 = 0, y0 = 0] = (box.style.translate || "0px 0px").split(" ").map(parseFloat);
      drag = { sx: e.clientX, sy: e.clientY, x0, y0 };
      card.classList.add("dragging");
      addEventListener("pointermove", onMove, true);
      addEventListener("pointerup", onUp, true);
      addEventListener("pointercancel", onUp, true);
      e.preventDefault();
    });

    const msg = document.createElement("p");
    msg.className = "msg";
    msg.textContent = kind === "website" ? s.cardWebsite : s.cardMessage;

    const send = (mode) => {
      try {
        chrome.runtime
          .sendMessage({ type: "KAVACH_CHECK", text, url: location.href, mode })
          .catch((err) => log("no one is listening for KAVACH_CHECK yet", err?.message));
      } catch (err) {
        log("extension was reloaded — refresh this tab", err?.message);
      }
      hideCard();
      onDone?.();
    };

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(
      button(s.cardCheckIt, "primary", () => send("check")),
      button(s.cardTalk, "", () => send("talk"))
    );
    card.append(head, msg, actions);
    root.append(card);
    (document.body || document.documentElement).append(box);
    cardHost = box;
    // Role 1's background plays a soft ping. try: sendMessage throws if the extension was reloaded.
    try {
      chrome.runtime.sendMessage({ type: "KAVACH_CARD_SHOWN" }).catch(() => {});
    } catch {}
  }

  // ---------- Gmail / Outlook / WhatsApp: watch for opened messages ----------

  const SCREEN_TIMEOUT_MS = 6000;
  const GROWTH_RECHECK = 1.2; // same message, text grew by >20% (Gmail loading the rest) → check again
  const FLAGGED = new Set(["scam", "suspicious"]);

  // Which message is open. Gmail: thread id from the address. Outlook: message id from the address,
  // else subject + start of the body. WhatsApp: chat name + hash of the last 3 messages
  // (a new message in the chat counts as a new thing to check).
  function messageKey(text) {
    if (SITE === "gmail") {
      const id = kavachGmailThreadId(location.hash);
      if (id) return "gmail|" + id;
    } else if (SITE === "outlook") {
      const id = kavachOutlookId(location.href);
      if (id) return "outlook|" + id;
    } else if (SITE === "whatsapp") {
      const name = document.querySelector("#main header")?.innerText?.split("\n")[0] || "";
      const bubbles = [...document.querySelectorAll("#main [data-pre-plain-text]")].slice(-3);
      const last3 = bubbles.length
        ? bubbles.map((el) => (el.querySelector(".selectable-text") || el).innerText || "").join("\n")
        : text.slice(-300);
      return "whatsapp|" + name + "|" + kavachHash(last3);
    }
    return SITE + "|text|" + kavachHash(text.slice(0, 300));
  }

  // Results for this page session: key → { verdict, reason, len, via, flagged }.
  // flagged sticks: once a message was flagged, a later re-check never takes the warning away.
  const results = new Map();
  let currentKey = null; // the message open right now
  let dismissed = false; // the card was closed / used for the message open right now
  let cardKey = null; // which message the card on screen belongs to
  let running = false;
  let again = false;

  function leaveMessage() {
    // A local-only guess (server was down) gets another try with Nemotron when it's opened again.
    const old = results.get(currentKey);
    if (old?.via === "local") old.retry = true;
    // Forget "shown / dismissed": opening it again brings the card back.
    hideCard();
    cardKey = null;
    currentKey = null;
    dismissed = false;
  }

  // Nemotron via our server (masked text only). Any problem → Quick Check on the device.
  async function screenMessage(text) {
    if (navigator.onLine !== false) {
      try {
        const { mask } = await load("core/mask.js");
        const { masked } = mask(text);
        const reply = await Promise.race([
          chrome.runtime.sendMessage({ type: "KAVACH_SCREEN", text: masked.slice(0, 4000), pageUrl: location.href }),
          new Promise((resolve) => setTimeout(() => resolve(null), SCREEN_TIMEOUT_MS))
        ]);
        if (reply && (FLAGGED.has(reply.verdict) || reply.verdict === "safe")) {
          return { verdict: reply.verdict, reason: reply.reason || "", via: "nemotron" };
        }
        log("Nemotron screen unavailable:", reply?.error || "no answer in 6 s", "→ Quick Check");
      } catch (err) {
        log("Nemotron screen failed → Quick Check", err?.message);
      }
    }
    const { runQuickCheck } = await load("core/quickcheck.js");
    const v = await runQuickCheck(text);
    return { verdict: v.verdict, reason: "", via: "local" };
  }

  function showFor(key, text) {
    if (cardKey === key || dismissed || key !== currentKey) return;
    cardKey = key;
    showCard({
      kind: "message",
      text,
      stillValid: () => key === currentKey && !dismissed && cardKey === key,
      onDone: () => {
        if (key === currentKey) dismissed = true; // hidden until the user leaves this message
        cardKey = null;
      }
    }).catch((err) => log("could not show the card", err?.message));
  }

  async function scan() {
    if (running) {
      again = true; // check again when the current one finishes
      return;
    }
    running = true;
    try {
      if (typeof extractPageText !== "function") return log("content/extract.js is not loaded");
      const { text, source } = extractPageText();
      // Gmail list views (#inbox, #inbox/p2, #search/words, #label/Work): no email is open, even if
      // the last one is still hidden in the page.
      const gmailList = SITE === "gmail" && !kavachGmailThreadId(location.hash) && kavachGmailIsList(location.hash);
      if (source !== SITE || gmailList) {
        // No email/chat open (e.g. the inbox list): forget the last message.
        if (currentKey) leaveMessage();
        return;
      }
      const key = messageKey(text);
      if (key !== currentKey) {
        leaveMessage(); // the user opened something else
        currentKey = key;
      }
      if (text.length < MIN_CHARS || dismissed) return;

      const known = results.get(key);
      // Known and not much new text (and not a local-only guess while we're online) → no new call.
      const fresh = known && text.length <= known.len * GROWTH_RECHECK && !(known.via === "local" && known.retry);
      if (!fresh) {
        const r = await screenMessage(text);
        const flagged = FLAGGED.has(r.verdict) || !!known?.flagged;
        // A local guess is retried with Nemotron the next time this message is opened.
        results.set(key, { ...r, len: text.length, flagged, retry: false });
        log(r.via === "nemotron" ? "Nemotron:" : "Quick Check:", r.verdict, r.reason);
      }
      const res = results.get(key);
      if (key !== currentKey || dismissed) return; // the user moved on while we checked
      if (res.flagged) showFor(key, text);
    } catch (err) {
      log("could not check this message", err?.message);
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  }

  // Wait DEBOUNCE_MS after the first change, then check once. (Not "wait until the page is quiet":
  // WhatsApp changes the page almost constantly, so that would never happen.)
  let timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      scan();
    }, DEBOUNCE_MS);
  }

  // ---------- any other site: lookalike government address ----------

  // Cheap first filter so most sites never load our code at all.
  const MAYBE_GOV = /uscis|irs|ice|ftc|ssa|dhs|fbi|gov|socialsecurity|homeland/;

  async function checkThisSite() {
    if (!/^https?:$/.test(location.protocol) || !MAYBE_GOV.test(host)) return;
    try {
      const { checkLookalikeDomain } = await load("core/tools.js");
      const r = await checkLookalikeDomain(location.hostname);
      log("website check:", r.status, r.detail);
      if (r.status !== "fail") return;
      const key = "kavach-site-dismissed";
      try {
        if (sessionStorage.getItem(key)) return; // card already closed / used on this site
      } catch {}
      const pageText = typeof extractPageText === "function" ? extractPageText().text : "";
      await showCard({
        kind: "website",
        text: `${location.href}\n\n${pageText}`.slice(0, 4000),
        onDone: () => {
          try {
            sessionStorage.setItem(key, "1");
          } catch {}
        }
      });
    } catch (err) {
      log("could not check this website", err?.message);
    }
  }

  // ---------- reportfraud.ftc.gov: fill in the "what happened" box ----------

  // The side panel's "Report to FTC" button saves the report text as chrome.storage.local "ftcDraft"
  // ({ text, at }) and opens reportfraud.ftc.gov. The FTC form has several steps; when its
  // "what happened" box (textarea formControlName="comments") appears, we type the report in ONCE,
  // only if the box is empty, and delete the draft. We never press Continue / Submit — the user does.
  const FTC_DRAFT_MAX_AGE_MS = 30 * 60 * 1000;
  const FTC_MAX_CHARS = 3500; // the box's own maxlength

  async function fillFtcReport() {
    let draft;
    try {
      draft = (await chrome.storage.local.get("ftcDraft")).ftcDraft;
    } catch {
      return;
    }
    if (!draft?.text) return;
    if (Date.now() - (draft.at || 0) > FTC_DRAFT_MAX_AGE_MS) {
      chrome.storage.local.remove("ftcDraft").catch(() => {});
      return;
    }

    const tryFill = () => {
      const box = document.querySelector('textarea[formcontrolname="comments"], textarea[aria-labelledby="commentsLabel"]');
      if (!box) return false;
      if (!box.value.trim()) {
        box.value = draft.text.slice(0, FTC_MAX_CHARS);
        box.dispatchEvent(new Event("input", { bubbles: true })); // Angular reads the value on "input"
        box.dispatchEvent(new Event("change", { bubbles: true }));
        box.scrollIntoView({ block: "center", behavior: "smooth" });
        log("FTC report filled in — waiting for the user to submit");
      }
      chrome.storage.local.remove("ftcDraft").catch(() => {});
      return true;
    };

    if (tryFill()) return;
    const observer = new MutationObserver(() => tryFill() && stop());
    const timer = setTimeout(() => stop(), FTC_DRAFT_MAX_AGE_MS);
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
    };
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ---------- start ----------

  // The page the user is ON is a real .gov / .mil (or official) website → never screen it, never show the
  // card. (Its pages are full of scam words: reportfraud.ftc.gov would look like a scam.) Pasted messages
  // that only MENTION a .gov site are not affected: this looks at location.hostname only.
  async function start() {
    try {
      const { checkGovSite } = await load("core/govsite.js");
      const site = await checkGovSite(location.href);
      if (site.verified) {
        log("real government website, no auto-check:", site.host);
        if (host === "reportfraud.ftc.gov") fillFtcReport();
        return;
      }
    } catch (err) {
      log("government-site check failed", err?.message);
      if (/\.(gov|mil)\.?$/.test(host)) { // still never flag a .gov / .mil page
        if (host === "reportfraud.ftc.gov") fillFtcReport();
        return;
      }
    }
    begin();
  }

  function begin() {
    if (SITE) {
      new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
      // Gmail changes #inbox/… when you open an email; Back/Forward fires popstate.
      window.addEventListener("hashchange", schedule);
      window.addEventListener("popstate", schedule);
      schedule();
    } else if (host === "reportfraud.ftc.gov") {
      fillFtcReport();
    } else {
      checkThisSite();
    }
  }

  start();
})();
