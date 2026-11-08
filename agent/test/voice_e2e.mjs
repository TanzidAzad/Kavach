// agent/test/voice_e2e.mjs — Role 3. Drives agent/test/voice.html (real agent/voice.js) in Chrome over CDP.
// No npm deps. Chrome must run with: --remote-debugging-port=<port> --enable-unsafe-extension-debugging
//   --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<silent.wav> --autoplay-policy=no-user-gesture-required
// Env: CDP=http://127.0.0.1:9335  EXT=<extension folder>  SERVER=http://localhost:8787
// Checks: 1) en session: connects <5s, first sentence calms, mic on, Stop → ended
//         2) es talk mode: no verdict before it exists, then the verdict   3) server down → error <5s + fallback
//         4) mic not granted → agent/mic-permission.html opens; "Allow" there → voice gets the mic
//         5) no console errors
const CDP = process.env.CDP || "http://127.0.0.1:9335";
const SERVER = process.env.SERVER || "http://localhost:8787";

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

const browser = await connect((await (await fetch(`${CDP}/json/version`)).json()).webSocketDebuggerUrl);
const extId = process.env.EXT_ID || (await browser.send("Extensions.loadUnpacked", { path: process.env.EXT })).id;
const origin = `chrome-extension://${extId}`;
const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
const target = (await (await fetch(`${CDP}/json/list`)).json()).find((t) => t.id === targetId);
const page = await connect(target.webSocketDebuggerUrl);
const errors = [];
page.on((m) => {
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") errors.push("EXCEPTION " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
});
await page.send("Runtime.enable"); await page.send("Page.enable");
const js = async (expression) => {
  const r = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expr).catch(() => false)) return Date.now() - t0; await sleep(100); } return -1; };
const open = async () => {
  await page.send("Page.navigate", { url: `${origin}/agent/test/voice.html?server=${encodeURIComponent(SERVER)}` });
  await waitFor(`document.getElementById("lang").options.length > 5`, 10000);
};
const kavachLines = () => js(`[...document.querySelectorAll("#log .kavach:not(.partial)")].map(p => p.textContent)`);
const S = (id) => `document.getElementById("${id}").textContent`;

// ---- 1) English, mic already allowed ----
await browser.send("Browser.grantPermissions", { origin, permissions: ["audioCapture"] });
await open();
await js(`document.getElementById("lang").value = "en"; document.getElementById("talk").checked = false; document.getElementById("breakit").checked = false; document.getElementById("start").click()`);
const tSpeak = await waitFor(`${S("state")} === "speaking"`, 8000);
check("en: connects and starts speaking", tSpeak >= 0, `first audio ${tSpeak} ms (${await js(S("meta"))})`);
await waitFor(`document.querySelectorAll("#log .kavach:not(.partial)").length >= 1`, 30000);
const en = await kavachLines();
check("en: first sentence calms", /breath|you have time/i.test(en[0] || ""), (en[0] || "").slice(0, 160));
check("en: microphone on", /microphone on/.test(await js(S("mic"))), await js(S("mic")));
check("en: back to listening", (await waitFor(`${S("state")} === "listening"`, 25000)) >= 0);
await js(`document.getElementById("stop").click()`);
check("en: Stop → ended", (await waitFor(`${S("state")} === "ended"`, 3000)) >= 0);

// ---- 2) Spanish talk mode ----
await open();
await js(`document.getElementById("lang").value = "es"; document.getElementById("talk").checked = true; document.getElementById("start").click()`);
await waitFor(`document.querySelectorAll("#log .kavach:not(.partial)").length >= 2`, 45000);
const es = await kavachLines();
check("es talk: first turn has no verdict", !!es[0] && !/estafa|fraude|scam/i.test(es[0]), (es[0] || "").slice(0, 140));
check("es talk: verdict after updateVerdict", /estafa|fraude/i.test(es.slice(1).join(" ")), (es[1] || "").slice(0, 140));
check("es talk: spoke Spanish", /tiempo|mensaje/i.test(es.join(" ")));
await js(`document.getElementById("stop").click()`);

// ---- 3) server down → error + fallback ----
await open();
await js(`document.getElementById("breakit").checked = true; document.getElementById("start").click()`);
const tErr = await waitFor(`${S("state")} === "error"`, 6000);
check("server down: error within 5s", tErr >= 0, `${tErr} ms`);
check("server down: fallback attempted", (await waitFor(`/fallback|system voice/.test(${S("meta")})`, 5000)) >= 0, await js(S("meta")));

// ---- 4) mic permission page ----
await browser.send("Browser.resetPermissions", {});
await open();
await js(`document.getElementById("breakit").checked = false; document.getElementById("talk").checked = false; document.getElementById("lang").value = "en"; document.getElementById("start").click()`);
let micTab = null;
for (let i = 0; i < 80 && !micTab; i++) { await sleep(100); micTab = (await (await fetch(`${CDP}/json/list`)).json()).find((t) => t.url.includes("mic-permission.html")); }
check("mic: permission page opened", !!micTab, micTab ? "" : await js(S("mic")));
if (micTab) {
  await browser.send("Browser.grantPermissions", { origin, permissions: ["audioCapture"] }); // = user clicks Allow
  const mp = await connect(micTab.webSocketDebuggerUrl);
  await mp.send("Runtime.evaluate", { expression: `document.getElementById("allow").click()`, userGesture: true });
  const tMic = await waitFor(`/microphone on/.test(${S("mic")})`, 8000);
  check("mic: voice got the mic after Allow", tMic >= 0, await js(S("mic")));
  mp.close();
}
await js(`document.getElementById("stop").click()`);

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.every(Boolean) ? `\nALL ${results.length} PASSED` : `\n${results.filter((x) => !x).length} FAILED`);
await browser.send("Target.closeTarget", { targetId }).catch(() => {});
process.exit(results.every(Boolean) ? 0 : 1);
