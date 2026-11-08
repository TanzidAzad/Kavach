// Simulates content/detect.js on a fake Gmail page (no browser, no login) to test WHEN the card shows:
// every opened email is screened, the card comes back on reopen, ✕ hides it only while that email is open,
// identical scam text in two emails → two cards, safe email → no card, server down → local Quick Check.
// Run: node --no-warnings agent/test/screen_flow.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../../", import.meta.url);
const src = readFileSync(new URL("content/detect.js", ROOT), "utf8");

// ---- fake page ----
const page = { hash: "#inbox", text: "", source: "page" };
let server = "up"; // "up" | "down" | "slow"
let calls = 0;
const sent = []; // texts sent to the server (must be masked)
let card = null; // the card element on the page right now
const listeners = {};

function el(tag) {
  const e = {
    tag, style: {}, children: [], attrs: {}, handlers: {}, textContent: "",
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, f) { this.handlers[t] = f; },
    append(...kids) { for (const k of kids) { this.children.push(k); if (k && k.tag === "link") setTimeout(() => k.onload?.(), 0); } },
    attachShadow() { this.shadow = el("#shadow"); return this.shadow; },
    remove() { if (card === this) card = null; }
  };
  return e;
}
const body = el("body");
body.append = (box) => { card = box; };
const find = (node, pred) => {
  if (!node || typeof node !== "object") return null;
  if (pred(node)) return node;
  for (const k of [...(node.children || []), node.shadow].filter(Boolean)) { const f = find(k, pred); if (f) return f; }
  return null;
};
const clickClose = () => find(card, (n) => n.tag === "button" && n.textContent === "✕").handlers.click();
const clickCheck = () => find(card, (n) => n.tag === "button" && n.className === "primary").handlers.click();

const SCAM = "USCIS NOTICE\n\nYour case EAC2190012345 is suspended. Call 214-555-0199 today and pay the $450 fee with Google Play gift cards or ICE will arrest you.";
const SAFE = "Lunch Saturday?\n\nHi mom, I landed safe. Call you tonight. Love you!";

const ctx = {
  console: { debug() {}, log: console.log, warn: console.warn },
  setTimeout, clearTimeout, URL,
  navigator: { onLine: true },
  location: { hostname: "mail.google.com", protocol: "https:", get hash() { return page.hash; }, get href() { return "https://mail.google.com/mail/u/0/" + page.hash; } },
  document: { documentElement: el("html"), body, createElement: el, querySelector: () => null, querySelectorAll: () => [] },
  MutationObserver: class { observe() {} disconnect() {} },
  extractPageText: () => ({ text: page.text, source: page.source }),
  chrome: {
    runtime: {
      getURL: (p) => new URL(p, ROOT).href,
      sendMessage: async (msg) => {
        if (msg.type !== "KAVACH_SCREEN") return {};
        calls++;
        sent.push(msg.text);
        if (server === "down") return { error: "unreachable" };
        if (server === "slow") return new Promise(() => {});
        return /gift card|arrest/i.test(msg.text) ? { verdict: "scam", reason: "Pays by gift card." } : { verdict: "safe", reason: "Normal." };
      }
    },
    storage: { local: { get: async () => ({ lang: "en" }) } }
  }
};
ctx.window = { addEventListener: (t, f) => (listeners[t] = f) };
ctx.window.top = ctx.window;
vm.createContext(ctx);
new vm.Script(src, { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }).runInContext(ctx);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => wait(1100); // debounce 800 ms + checks
async function open(id, text) { page.hash = "#inbox/" + id; page.text = text; page.source = "gmail"; listeners.hashchange(); await settle(); }
async function backToInbox() { page.hash = "#inbox"; listeners.hashchange(); await settle(); } // old body stays (hidden) in Gmail

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); };

const A = "FMfcgzQXJWDsKmwlMjRrhNvvrXHBzAAA", B = "FMfcgzQXJWDsKmwlMjRrhNvvrXHBzBBB", C = "FMfcgzQXJWDsKmwlMjRrhNvvrXHBzCCC", D = "FMfcgzQXJWDsKmwlMjRrhNvvrXHBzDDD";

await open(A, SCAM);
check("1. open scam email → card", !!card, `server calls ${calls}`);
check("   text sent to server is masked", sent[0] && !/214-555-0199|EAC2190012345/.test(sent[0]) && /\[PHONE_1\]/.test(sent[0]));
clickClose(); await settle();
check("2. ✕ closes it and it stays closed while the email is open", !card);
await open(B, SAFE);
check("3. open a normal email → no card", !card);
await open(A, SCAM);
check("4. reopen the scam email → card again", !!card);
check("   reopen used the cache (no new server call)", calls === 2, `calls ${calls}`);
clickCheck(); await settle();
check("   'Check it' hides it while open", !card);
await backToInbox();
check("   inbox list → no card", !card);
await open(A, SCAM);
check("   reopen after 'Check it' → card again", !!card);
await open(C, SCAM);
check("5. same scam text in a second email → its own card", !!card && calls === 3, `calls ${calls}`);
// Gmail loads the body in pieces: same email, text grows by >20% → checked again
await open(D, "Hello\n\nShort note about your account for you.");
check("   short start of an email → no card", !card);
page.text += "\n\n" + "Your account will be closed. Pay with gift cards today or you will be arrested.";
listeners.popstate(); await settle();
check("   same email grows >20% → re-checked → card", !!card, `calls ${calls}`);

server = "down";
await open("FMfcgzQXJWDsKmwlMjRrhNvvrXHBzEEE", SCAM.replace("USCIS NOTICE", "IRS NOTICE"));
check("6. server down → card via local Quick Check", !!card);
server = "slow";
page.hash = "#inbox/FMfcgzQXJWDsKmwlMjRrhNvvrXHBzFFF"; page.text = SCAM + " Act now."; listeners.hashchange();
while (card) await wait(50); // the last email's card goes away when the check of this one starts
const t0 = Date.now();
while (!card && Date.now() - t0 < 9000) await wait(100);
const ms = Date.now() - t0;
check("   no answer in 6 s → card via local Quick Check", !!card && ms > 5000 && ms < 7500, `${ms}ms`);
server = "up";
ctx.navigator.onLine = false;
const before = calls;
await open("FMfcgzQXJWDsKmwlMjRrhNvvrXHBzGGG", SCAM + " Today.");
check("   offline → no server call, local card", !!card && calls === before);
ctx.navigator.onLine = true;
await open(B, SAFE);
check("   back to safe email → no card", !card);

console.log(`${fail ? "❌" : "✅"} screen flow: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
