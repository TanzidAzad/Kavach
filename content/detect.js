// content/detect.js — Role 2 (Core Engine)
// Runs inside web pages (content script). Needs content/extract.js loaded first (same "js" list).
//
// On Gmail, Outlook web and WhatsApp Web:
//   When an email / chat is opened, read its text and run Quick Check LOCALLY (nothing is sent anywhere).
//   If it has 2+ warning signs (Quick Check says "scam"), show a small calm card in the bottom-right:
//     ✕ (close, top-left)  "This message has signs of a scam. Want me to check it?"  [Check it] [Talk to Kavach]
// On any other site:
//   If the site's own address imitates a real .gov site (checkLookalikeDomain), show the same card.
//
// Clicking a button sends: chrome.runtime.sendMessage({ type: "KAVACH_CHECK", text, url, mode: "check" | "talk" })
// The card shows at most once per message (per chat on WhatsApp, per site elsewhere).
// It sits in a closed Shadow DOM so the page's CSS can't break it.

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

  async function showCard({ kind, text, onDone }) {
    hideCard();
    const s = await strings();
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

  // Which "message" the card belongs to. WhatsApp: the open chat (new messages in the same
  // chat don't bring the card back). Email: subject + start of the body.
  function messageKey(text) {
    if (SITE === "whatsapp") {
      const name = document.querySelector("#main header")?.innerText?.split("\n")[0] || "";
      return "whatsapp|" + name;
    }
    return SITE + "|" + text.slice(0, 300);
  }

  const handled = new Set(); // messages the card was already shown for (or dismissed)
  let currentKey = null;
  let lastText = "";
  let running = false;
  let again = false;

  async function scan() {
    if (running) {
      again = true; // check again when the current one finishes
      return;
    }
    running = true;
    try {
      if (typeof extractPageText !== "function") return log("content/extract.js is not loaded");
      const { text, source } = extractPageText();
      if (source !== SITE) {
        // No email/chat open (e.g. the inbox list): remove a card left from the last message.
        if (currentKey) hideCard();
        currentKey = null;
        lastText = "";
        return;
      }
      const key = messageKey(text);
      if (key !== currentKey) {
        hideCard(); // the user opened something else
        currentKey = key;
      }
      if (text === lastText || text.length < MIN_CHARS || handled.has(key)) return;
      lastText = text;

      const { runQuickCheck } = await load("core/quickcheck.js");
      const verdict = await runQuickCheck(text);
      log("Quick Check:", verdict.verdict, verdict.confidence);
      if (key !== currentKey || handled.has(key)) return; // the user moved on while we checked
      if (verdict.verdict === "scam") {
        // 2+ warning signs. Mark it now so it shows only once, whatever the user clicks.
        handled.add(key);
        await showCard({ kind: "message", text });
      }
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

  // ---------- start ----------

  if (SITE) {
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("hashchange", schedule); // Gmail changes #inbox/… when you open an email
    schedule();
  } else {
    checkThisSite();
  }
})();
