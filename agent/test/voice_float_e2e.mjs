// agent/test/voice_float_e2e.mjs — Role 3. Live voice inside the FLOATING panel (sidepanel.html?float=1 in an iframe
// on a normal web page, exactly like sidepanel/float.js makes it: allow="microphone; autoplay; clipboard-write").
// Chrome flags: --remote-debugging-port --enable-unsafe-extension-debugging --use-fake-device-for-media-stream
//   --use-file-for-fake-audio-capture=<silent.wav>   (NO autoplay flag: we want Chrome's real autoplay rules)
// Env: CDP  EXT (extension folder)  PAGE (top page, default https://example.com/)
// Checks: which origin the mic permission belongs to inside the frame · BroadcastChannel from the mic page reaches
//         the frame · full voice session from the frame (connect → speaking → mic on → stop) · no console errors.
const CDP = process.env.CDP || "http://127.0.0.1:9336";
const PAGE = process.env.PAGE || "https://example.com/";
const pageOrigin = new URL(PAGE).origin;

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method) listeners.forEach((f) => f(m));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { pending.set(++id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  return new Promise((r) => (ws.onopen = () => r({ send, on: (f) => listeners.push(f), close: () => ws.close() })));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
const info = (name, detail) => console.log(`INFO  ${name} — ${detail}`);
const list = async () => (await fetch(`${CDP}/json/list`)).json();

const browser = await connect((await (await fetch(`${CDP}/json/version`)).json()).webSocketDebuggerUrl);
const extId = process.env.EXT_ID || (await browser.send("Extensions.loadUnpacked", { path: process.env.EXT })).id;
const extOrigin = `chrome-extension://${extId}`;
await browser.send("Browser.resetPermissions", {});

const { targetId } = await browser.send("Target.createTarget", { url: PAGE });
await sleep(2500);
const page = await connect((await list()).find((t) => t.id === targetId).webSocketDebuggerUrl);
await page.send("Runtime.enable");
const evalIn = async (conn, expression) => {
  const r = await conn.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
// Same frame float.js builds (shadow root + iframe with the same allow list).
await evalIn(page, `(() => {
  const host = document.createElement("div"); const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = '<iframe allow="microphone; autoplay; clipboard-write" style="position:fixed;top:12px;right:12px;width:400px;height:600px;border:0"></iframe>';
  root.querySelector("iframe").src = ${JSON.stringify(`${extOrigin}/sidepanel/sidepanel.html?float=1&vh=700`)};
  document.body.append(host); return true; })()`);

let ft = null;
for (let i = 0; i < 50 && !ft; i++) { await sleep(200); ft = (await list()).find((t) => t.url.includes("sidepanel.html?float=1")); }
check("float frame loads as its own target", !!ft, ft ? ft.type : "not found");
if (!ft) process.exit(1);
const frame = await connect(ft.webSocketDebuggerUrl);
const errors = [];
frame.on((m) => {
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") errors.push("EXCEPTION " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
});
await frame.send("Runtime.enable");
const js = (e) => evalIn(frame, e);
const micState = () => js(`navigator.permissions.query({ name: "microphone" }).then(s => s.state)`);
const policy = () => js(`document.featurePolicy ? document.featurePolicy.allowsFeature("microphone") : "n/a"`);

info("frame", `origin ${await js("location.origin")}, top ${pageOrigin}, microphone allowed by policy: ${await policy()}, chrome.tabs: ${await js("!!(chrome.tabs && chrome.tabs.create)")}`);

// ---- 1) Whose permission is it? ----
const s0 = await micState();
await browser.send("Browser.grantPermissions", { origin: extOrigin, permissions: ["audioCapture"] });
const sExt = await micState();
await browser.send("Browser.resetPermissions", {});
await browser.send("Browser.grantPermissions", { origin: pageOrigin, permissions: ["audioCapture"] });
const sPage = await micState();
await browser.send("Browser.resetPermissions", {});
info("mic permission in frame", `none granted: ${s0} · granted to extension: ${sExt} · granted to page (${pageOrigin}): ${sPage}`);
// Finding (2026-11-08): inside the iframe Chrome uses the PAGE's permission → voice.js uses agent/mic-offscreen.html.
info("→ frame uses", sExt === "granted" && sPage !== "granted" ? "Kavach's permission" : sPage === "granted" ? "the PAGE's permission (so voice.js must not ask in the frame)" : "?");

// ---- 2) BroadcastChannel from an extension tab reaches the frame? ----
await js(`window.__bc = null; new BroadcastChannel("kavach-mic").onmessage = (e) => (window.__bc = e.data); true`);
const { targetId: tabId } = await browser.send("Target.createTarget", { url: `${extOrigin}/sidepanel/contracts.js`, background: true });
await sleep(800);
const tab = await connect((await list()).find((t) => t.id === tabId).webSocketDebuggerUrl);
await evalIn(tab, `new BroadcastChannel("kavach-mic").postMessage({ granted: true, probe: 1 }); true`);
await sleep(500);
const got = await js("window.__bc");
check("BroadcastChannel from extension tab reaches the floating frame", !!(got && got.granted), JSON.stringify(got));
tab.close(); await browser.send("Target.closeTarget", { targetId: tabId }).catch(() => {});

// ---- 3) Full voice session from the frame ----
await browser.send("Browser.grantPermissions", { origin: extOrigin, permissions: ["audioCapture"] });
const VERDICT = `{ verdict: "scam", confidence: "high", reasons: ["The message asks you to pay with gift cards."], steps: ["Do not pay.", "Call USCIS using the official number."], agency: "USCIS", familyMessage: "I got a message that looks like a scam." }`;
await js(`(async () => {
  const v = await import(chrome.runtime.getURL("agent/voice.js"));
  window.__v = { states: [], mic: [], err: null, lines: [], actx: null };
  const ac = new AudioContext(); window.__v.actx = ac.state; ac.close();
  window.__s = v.startVoice({ verdict: ${VERDICT}, level: "high", lang: "en", text: "USCIS: pay the fee with gift cards today or you will be deported." }, {
    onState: (s) => window.__v.states.push(s),
    onMic: (m) => window.__v.mic.push(m),
    onError: (e) => (window.__v.err = String(e.message || e)),
    onTranscript: (t) => { if (t.final && t.role === "kavach") window.__v.lines.push(t.text); },
  });
  window.__vmod = v; return true; })()`);
const waitFor = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expr).catch(() => false)) return Date.now() - t0; await sleep(100); } return -1; };
const tSpeak = await waitFor(`window.__v.states.includes("speaking")`, 8000);
check("voice connects and plays audio in the floating frame", tSpeak >= 0, `first audio ${tSpeak} ms; states ${JSON.stringify(await js("window.__v.states"))}; err ${await js("window.__v.err")}`);
info("AudioContext state right after the click (no autoplay flag)", await js("window.__v.actx"));
const tMic = await waitFor(`window.__v.mic.includes("microphone on")`, 6000);
check("microphone attaches in the floating frame", tMic >= 0, JSON.stringify(await js("window.__v.mic")));
await waitFor(`window.__v.lines.length >= 1`, 30000);
const line = (await js("window.__v.lines[0]")) || "";
check("first sentence calms", /breath|you have time/i.test(line), line.slice(0, 140));
await js(`window.__vmod.stopVoice(); true`);
check("stopVoice → ended", (await waitFor(`window.__v.states.includes("ended")`, 3000)) >= 0);

// ---- 4) Mic NOT granted: what does the frame do? (headless can't click a prompt; we watch the path) ----
await browser.send("Browser.resetPermissions", {});
await js(`(async () => { window.__v.mic = []; window.__v.states = [];
  window.__s = window.__vmod.startVoice({ verdict: ${VERDICT}, level: "high", lang: "en", text: "x" }, {
    onState: (s) => window.__v.states.push(s), onMic: (m) => window.__v.mic.push(m) }); return true; })()`);
let micTab = null;
for (let i = 0; i < 60 && !micTab; i++) { await sleep(100); micTab = (await list()).find((t) => t.url.includes("mic-permission.html")); }
info("mic not granted", `mic notes ${JSON.stringify(await js("window.__v.mic"))}; mic-permission tab opened: ${!!micTab}`);
if (micTab) {
  await browser.send("Browser.grantPermissions", { origin: extOrigin, permissions: ["audioCapture"] });
  const mp = await connect(micTab.webSocketDebuggerUrl);
  await mp.send("Runtime.evaluate", { expression: `document.getElementById("allow").click()`, userGesture: true });
  const t = await waitFor(`window.__v.mic.includes("microphone on")`, 8000);
  check("after Allow on the mic page, the floating frame gets the mic", t >= 0, JSON.stringify(await js("window.__v.mic")));
  mp.close();
}
await js(`window.__vmod.stopVoice(); true`);

// ---- 5) Panel closed mid-talk (Esc / click outside removes the iframe) → mic + offscreen page go away ----
await browser.send("Browser.grantPermissions", { origin: extOrigin, permissions: ["audioCapture"] });
await js(`(async () => { window.__v.mic = [];
  window.__vmod.startVoice({ verdict: ${VERDICT}, level: "high", lang: "en", text: "x" }, { onMic: (m) => window.__v.mic.push(m) }); return true; })()`);
await waitFor(`window.__v.mic.includes("microphone on")`, 8000);
const before = (await list()).filter((t) => t.url.includes("mic-offscreen.html")).length;
await evalIn(page, `document.body.lastElementChild.remove(); true`); // the float host (appended last)
await sleep(2500);
const after = (await list()).filter((t) => t.url.includes("mic-offscreen.html")).length;
check("panel closed mid-talk → offscreen mic page closes itself", before === 1 && after === 0, `open before ${before}, after ${after}`);

const pageMic = await evalIn(page, `navigator.permissions.query({ name: "microphone" }).then(s => s.state)`);
check("the website never got the microphone", pageMic !== "granted", `page mic permission: ${pageMic}`);
await sleep(500);
const offDocs = (await list()).filter((t) => t.url.includes("mic-offscreen.html")).length;
check("offscreen mic page closed after stop", offDocs === 0, `${offDocs} open`);
check("no console errors in the frame", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.every(Boolean) ? `\nALL ${results.length} PASSED` : `\n${results.filter((x) => !x).length} FAILED`);
await browser.send("Target.closeTarget", { targetId }).catch(() => {});
process.exit(results.every(Boolean) ? 0 : 1);
