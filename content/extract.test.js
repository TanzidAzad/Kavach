// content/extract.test.js — run from the repo root: node content/extract.test.js
// Checks that extractPageText is truly self-contained (safe for chrome.scripting.executeScript):
// we rebuild it from its source text with ONLY fake browser globals and run it.
// The real-DOM tests (Gmail / Outlook / WhatsApp markup) are in content/extract.test.html.

import { readFile } from "node:fs/promises";

let passed = 0;
let failed = 0;
const check = (ok, line) => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${line}`);
};

const source = await readFile(new URL("./extract.js", import.meta.url), "utf8");
check(!/^\s*(import|export)\b/m.test(source), "no import/export (plain script)");

// Pull out just the function, the way executeScript({ func }) serializes it.
const start = source.indexOf("function extractPageText");
const fnSource = source.slice(start);

// Minimal fake page: no Gmail, no selection, a <main> with text.
function fakeEnv({ hostname, selection = "", mainText = "", bodyText = "" }) {
  const mk = (text) => ({ innerText: text, getClientRects: () => [1], querySelector: () => null, querySelectorAll: () => [] });
  const main = mk(mainText);
  const document = {
    body: mk(bodyText),
    querySelector: () => null,
    querySelectorAll: (sel) => (sel.startsWith("main") && mainText ? [main] : [])
  };
  return { location: { hostname }, document, window: { getSelection: () => selection } };
}
function run(env) {
  // Only these names exist — any other global the function relies on would throw and fail the test.
  const fn = new Function("location", "document", "window", `${fnSource}\nreturn extractPageText();`);
  return fn(env.location, env.document, env.window);
}

const a = run(fakeEnv({ hostname: "example.com", selection: "  Pay with gift cards now  ", mainText: "Main page" }));
check(a.source === "selection" && a.text === "Pay with gift cards now", `selection wins on other sites: ${JSON.stringify(a)}`);

const b = run(fakeEnv({ hostname: "example.com", mainText: "Main   article\n\n\n\ntext" }));
check(b.source === "page" && b.text === "Main article\n\ntext", `main text, tidied: ${JSON.stringify(b)}`);

const c = run(fakeEnv({ hostname: "example.com", bodyText: "x".repeat(9000) }));
check(c.text.length === 4000, `cut to 4000 chars (${c.text.length})`);

const d = run(fakeEnv({ hostname: "mail.google.com", bodyText: "Inbox list" }));
check(d.source === "page", `Gmail with no open email falls back: ${d.source}`);

const e = run(fakeEnv({ hostname: "example.com" }));
check(e.source === "none" && e.text === "", `empty page → source "none": ${JSON.stringify(e)}`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
