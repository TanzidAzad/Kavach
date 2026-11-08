// End-to-end test of the REAL popup (popup/popup.html) inside Chrome, driven over the DevTools protocol.
// No npm deps (Node 22+: fetch + WebSocket). Screenshots go to OUT (default agent/test/integration_shots).
//
// 1. Start Chrome with DevTools + unsafe extension debugging, e.g. (Windows Chrome from WSL):
//    chrome.exe --headless=new --remote-debugging-port=9333 --enable-unsafe-extension-debugging \
//      --user-data-dir=<tmp profile> --no-first-run about:blank
// 2. Server running on :8787 (cd server && npm start).
// 3. EXT=<folder with manifest.json> node agent/test/popup_e2e.mjs      (loads it via Extensions.loadUnpacked)
//    or EXT_ID=<id> if it's already loaded. CDP=http://127.0.0.1:9333 by default. IMG=<png> for the upload step.
// Branded Chrome 137+ ignores --load-extension, which is why the extension is loaded over CDP.

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CDP = process.env.CDP || "http://127.0.0.1:9333";
const OUT = process.env.OUT || path.join(HERE, "integration_shots");
const IMG = process.env.IMG || path.join(HERE, "es-uscis-whatsapp.png");
const ES_TEXT =
  "USCIS AVISO: Su caso IOE-55821 tiene un problema y su solicitud será cancelada. Debe pagar una multa de $480 en tarjetas de regalo en 24 horas o será deportado. Responda a este WhatsApp para recibir instrucciones. Oficial Ramírez.";
mkdirSync(OUT, { recursive: true });

// ---------- tiny CDP client ----------
function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(`${m.error.message} ${m.error.data || ""}`)) : res(m.result);
    } else if (m.method) listeners.forEach((f) => f(m));
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      pending.set(++id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return new Promise((r) => (ws.onopen = () => r({ send, on: (f) => listeners.push(f), close: () => ws.close() })));
}

const results = [];
const log = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok === "env" ? "ENV " : ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await connect((await (await fetch(`${CDP}/json/version`)).json()).webSocketDebuggerUrl);
let extId = process.env.EXT_ID;
if (!extId) extId = (await browser.send("Extensions.loadUnpacked", { path: path.resolve(process.env.EXT || path.join(HERE, "../..")) })).id;
const origin = `chrome-extension://${extId}`;
await browser
  .send("Browser.grantPermissions", { origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] })
  .catch((e) => console.log("(clipboard permission:", e.message + ")"));

const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
const target = (await (await fetch(`${CDP}/json/list`)).json()).find((t) => t.id === targetId);
const page = await connect(target.webSocketDebuggerUrl);
const consoleLines = [];
page.on((m) => {
  if (m.method === "Runtime.consoleAPICalled") consoleLines.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (m.method === "Runtime.exceptionThrown") consoleLines.push(`EXCEPTION: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
});
await page.send("Runtime.enable");
await page.send("Page.enable");
await page.send("Network.enable");
await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await page.send("Emulation.setDeviceMetricsOverride", { width: 380, height: 600, deviceScaleFactor: 1, mobile: false });

const js = async (expression) => {
  const r = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expression, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await js(expression).catch(() => false)) return Date.now() - t0;
    await sleep(100);
  }
  return -1;
};
const shot = async (name) => {
  const { contentSize } = await page.send("Page.getLayoutMetrics");
  const h = Math.ceil(Math.max(600, contentSize.height));
  const { data } = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 380, height: h, scale: 1 } });
  writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, "base64"));
};
const load = async () => {
  await page.send("Page.navigate", { url: `${origin}/popup/popup.html` });
  await waitFor(`document.readyState === "complete" && !!document.getElementById("check").dataset.en`);
  await sleep(300);
};
// Records every checklist line as it appears (the popup hides the checklist once the verdict shows).
const watchChecklist = `(() => { window.__lines = []; window.__t0 = performance.now();
  new MutationObserver(() => { document.querySelectorAll("#checklist li").forEach((li) => {
    if (!li.__seen) { li.__seen = 1; window.__lines.push({ ms: Math.round(performance.now() - window.__t0), li }); } }); })
  .observe(document.getElementById("checklist"), { childList: true, subtree: true }); return true; })()`;
const readLines = `window.__lines.map((l) => ({ ms: l.ms, mark: l.li.querySelector(".mark")?.textContent, text: l.li.textContent.replace(/^[✓✗…]\\s*/, "") }))`;
const visible = (id) => `!document.getElementById("${id}").hidden`;
const verdictShown = `${visible("verdict-line")} && ${visible("reasons-block")} && !document.getElementById("check").disabled && document.getElementById("checklist-block").hidden`;
const summary = `({ verdict: document.getElementById("verdict-line").className, label: document.getElementById("verdict-label").textContent,
  conf: document.getElementById("conf-value").textContent, reasons: [...document.querySelectorAll("#reasons li")].map((l) => l.textContent),
  steps: [...document.querySelectorAll("#steps li")].map((l) => l.textContent), contact: document.getElementById("contact").textContent,
  status: document.getElementById("status").dataset.en || "", statusText: document.getElementById("status").textContent,
  deepBtn: ${visible("deep-check")}, family: ${visible("ask-family")} })`;
const click = (id) => js(`document.getElementById("${id}").click(), true`);

try {
  await load();
  await js(`chrome.storage.local.set({ lang: "en" }).then(() => true)`);
  await load();
  await shot("00_empty");

  // 1. Spanish text → Check (Quick)
  await js(`(() => { const m = document.getElementById("message"); m.value = ${JSON.stringify(ES_TEXT)}; m.dispatchEvent(new Event("input")); return true; })()`);
  await shot("01_spanish_text");
  await click("check");
  let ms = await waitFor(verdictShown, 10000);
  let s = await js(summary);
  await shot("02_quick_check");
  log("Quick Check (Spanish text)", ms >= 0 && /scam/.test(s.verdict) && s.deepBtn, `${s.label}/${s.conf}, ${ms}ms, ${s.reasons.length} reasons, deep button ${s.deepBtn ? "shown" : "HIDDEN"}`);

  // 2. Deep check
  await js(watchChecklist);
  const t0 = Date.now();
  await click("deep-check");
  await waitFor(`document.querySelectorAll("#checklist li").length >= 2`, 15000);
  await shot("03_deep_checklist_live");
  ms = await waitFor(verdictShown, 20000);
  const deepMs = Date.now() - t0;
  s = await js(summary);
  let lines = await js(readLines);
  await shot("04_deep_verdict");
  const gaps = lines.slice(1).map((l, i) => l.ms - lines[i].ms);
  log(
    "Deep Check (Spanish text)",
    ms >= 0 && /scam/.test(s.verdict) && !s.deepBtn && lines.length >= 3 && deepMs < 15000 && !s.status,
    `${s.label}/${s.conf}, ${deepMs}ms, ${lines.length} checklist lines (gaps ${gaps.join("/")}ms), status "${s.status}"`
  );
  console.log("   lines:", lines.map((l) => `${l.mark} ${l.text}`).join(" | "));
  console.log("   reasons:", s.reasons.join(" | "));
  console.log("   contact:", s.contact);

  // 3. Ask family → clipboard
  await click("ask-family");
  await waitFor(`/Copied|Could not/.test(document.getElementById("status").dataset.en || "")`, 5000);
  const st = await js(`document.getElementById("status").dataset.en`);
  await shot("05_ask_family_copied");
  const clip = await js(`navigator.clipboard.readText().catch((e) => "ERR " + e.message)`);
  log("Ask family copies text", st.startsWith("Copied") && clip.length > 20 && !clip.startsWith("ERR"), `status "${st}", clipboard: "${clip.slice(0, 120)}…"`);

  // 4. Screenshot upload → Check (runs Deep Check)
  await click("new-check");
  await waitFor(visible("input-view"));
  const { root } = await page.send("DOM.getDocument");
  const { nodeId } = await page.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#screenshot" });
  await page.send("DOM.setFileInputFiles", { nodeId, files: [path.resolve(IMG)] });
  await waitFor(visible("file-info"), 5000);
  const note = await js(`${visible("image-note")}`);
  await shot("06_screenshot_added");
  await js(watchChecklist);
  const t1 = Date.now();
  await click("check");
  await waitFor(`document.querySelectorAll("#checklist li").length >= 1`, 15000);
  await shot("07_screenshot_checklist_live");
  ms = await waitFor(verdictShown, 25000);
  const shotMs = Date.now() - t1;
  s = await js(summary);
  lines = await js(readLines);
  await shot("08_screenshot_verdict");
  log(
    "Screenshot upload → Deep Check",
    ms >= 0 && /scam/.test(s.verdict) && note && lines.some((l) => /screenshot/i.test(l.text)) && shotMs < 15000,
    `${s.label}/${s.conf}, ${shotMs}ms, ${lines.length} lines, image note ${note ? "shown" : "MISSING"}`
  );
  console.log("   lines:", lines.map((l) => `${l.mark} ${l.text}`).join(" | "));

  // 5. Language → Hindi, then Spanish (on the screenshot verdict)
  for (const [L, name, re] of [["hi", "09_hindi", /[ऀ-ॿ]/], ["es", "10_spanish", /[áéíóúñ¿¡]|ESTAFA|Confianza|Por qué/i]]) {
    await js(`(() => { const s = document.getElementById("lang"); s.value = "${L}"; s.dispatchEvent(new Event("change")); return true; })()`);
    const tms = await waitFor(`${re}.test(document.getElementById("result-view").innerText)`, 40000);
    await sleep(500);
    await shot(name);
    const body = await js(`document.getElementById("verdict-line").innerText + " | " + document.getElementById("result-view").querySelector(".heading:not([hidden])")?.innerText`);
    const saved = await js(`chrome.storage.local.get("lang").then((r) => r.lang)`);
    const avail = await js(`typeof Translator === "undefined" ? "no Translator API" : Translator.availability({ sourceLanguage: "en", targetLanguage: "${L}" })`);
    // Headless Chrome never downloads the on-device language models → "env" (can't be tested here), not a popup bug.
    const ok = saved !== L ? false : tms >= 0 ? true : avail !== "available" ? "env" : false;
    log(`Language → ${L}`, ok, `${tms >= 0 ? `translated in ${tms}ms` : "NOT translated in time"}, Translator: ${avail}, saved: ${saved}, shows "${body.replace(/\s+/g, " ").slice(0, 80)}"`);
  }
  await js(`(() => { const s = document.getElementById("lang"); s.value = "en"; s.dispatchEvent(new Event("change")); return true; })()`);

  // 6. Server unreachable → Deep check falls back to Quick Check + "Deep check needs internet"
  await page.send("Network.setBlockedURLs", { urls: ["http://localhost:8787/*", "*localhost:8787*"] });
  await load();
  await js(`(() => { const m = document.getElementById("message"); m.value = ${JSON.stringify(ES_TEXT)}; return true; })()`);
  await click("check");
  await waitFor(verdictShown, 10000);
  await js(watchChecklist);
  await click("deep-check");
  ms = await waitFor(`${verdictShown} && !!document.getElementById("status").dataset.en`, 20000);
  s = await js(summary);
  lines = await js(readLines);
  await shot("11_server_down");
  log("Server stopped → Deep check needs internet", ms >= 0 && s.status === "Deep check needs internet" && /scam/.test(s.verdict), `${s.label}/${s.conf}, status "${s.status}", ${lines.length} checklist lines shown during the run`);
  await page.send("Network.setBlockedURLs", { urls: [] });

  // 7. Fully offline (navigator.onLine false): Deep button hidden, Quick Check works, status says offline
  await page.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await load();
  await js(`(() => { const m = document.getElementById("message"); m.value = ${JSON.stringify(ES_TEXT)}; return true; })()`);
  await click("check");
  await waitFor(verdictShown, 10000);
  s = await js(summary);
  await shot("12_offline_quick_check");
  log("Offline → Quick Check, no Deep button", /scam/.test(s.verdict) && !s.deepBtn, `${s.label}/${s.conf}, status "${s.statusText}", deep button ${s.deepBtn ? "SHOWN" : "hidden"}`);
  await page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
} catch (e) {
  log("driver", false, e.message);
}

const bad = consoleLines.filter((l) => /^EXCEPTION|^error|^warning: \[kavach\]/.test(l));
log("No exceptions / [kavach] warnings in the popup console", bad.length === 0, bad.slice(0, 3).join(" ; "));
if (consoleLines.length) console.log("console:", consoleLines.slice(0, 12).join("\n  "));
writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ when: new Date().toISOString(), results, console: consoleLines }, null, 2));
await browser.send("Target.closeTarget", { targetId });
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
