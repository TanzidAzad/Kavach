// server/scripts/preflight.js — Role 3. Demo-morning checklist: `cd server && npm run preflight`.
// Prints one ✅/❌ line per check, with a one-line fix for each ❌. Never prints keys, headers or full responses.
// Needs: server running (`npm start`) for the server + Deep Check lines; Brev port-forward for the Brev lines.

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const KEY = process.env.NVIDIA_API_KEY || "";
const BACKEND = (process.env.NIM_BACKEND || "hosted").toLowerCase();
const BREV = (process.env.BREV_LLM_URL || "http://localhost:8000").replace(/\/+$/, "").replace(/\/v1$/, "");
const BREV_MODEL = process.env.BREV_LLM_MODEL || "nvidia/nemotron-3.5-lightning";
const HOSTED = "https://integrate.api.nvidia.com/v1";
const HOSTED_AGENT = "nvidia/nemotron-3.5-lightning-30b-a3b";
const HOSTED_VISION = process.env.BREV_VL_MODEL || "nvidia/nemotron-3.5-super-vl-120b-a12b";
const SERVER = `http://localhost:${Number(process.env.PORT) || 8787}/api/chat`;
const ROOT = path.resolve(__dirname, "..", "..");
const NO_THINK = { chat_template_kwargs: { enable_thinking: false } };

const redact = (s) => (KEY ? String(s).split(KEY).join("[REDACTED]") : String(s));
const short = (s, n = 90) => { s = redact(s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };

const results = [];
function line(ok, name, detail, fix) {
  const mark = ok === true ? "✅" : ok === "warn" ? "⚠️ " : "❌";
  results.push(ok);
  console.log(`${mark} ${name}${detail ? " — " + short(detail, 110) : ""}`);
  if (ok !== true && fix) console.log(`     fix: ${fix}`);
}

async function post(url, body, { auth = false, timeout = 20000 } = {}) {
  const t0 = Date.now();
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (auth) headers.Authorization = "Bearer " + KEY;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, json, text, ms: Date.now() - t0 };
}
const errMsg = (e) => (e && (e.name === "TimeoutError" || e.name === "AbortError") ? "timed out" : short(e && e.message));

const TOOL = [{
  type: "function",
  function: { name: "get_weather", description: "Get the weather for a city", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }
}];
const TOOL_ASK = [{ role: "user", content: "What is the weather in Dallas? Use the tool." }];

async function checkBrev() {
  const fixUp = "start `brev port-forward <instance> -p 8000:8000`; on Brev: `docker ps` shows kavach-llm (NOTES → Brev container)";
  if (BACKEND !== "brev") {
    line("warn", "Brev NIM", `NIM_BACKEND=${BACKEND} — Brev not used (hosted only)`, "set NIM_BACKEND=brev in server/.env and restart the server to demo on Brev");
    return false;
  }
  try {
    const r = await fetch(BREV + "/v1/health/ready", { signal: AbortSignal.timeout(3000) });
    line(r.status === 200, "Brev NIM healthy (localhost:8000, port-forward up)", `health ${r.status}`, fixUp);
    if (r.status !== 200) return false;
  } catch (e) {
    line(false, "Brev NIM healthy (localhost:8000, port-forward up)", errMsg(e), fixUp);
    return false;
  }
  try {
    const r = await post(BREV + "/v1/chat/completions", { model: BREV_MODEL, max_tokens: 256, messages: TOOL_ASK, tools: TOOL, ...NO_THINK }, { timeout: 15000 });
    const calls = r.json?.choices?.[0]?.message?.tool_calls;
    if (r.ok && Array.isArray(calls) && calls.length) {
      line(true, "Brev tool calling (native parser)", `${calls[0].function?.name} in ${r.ms}ms`);
    } else if (r.status === 400 && /tool.?call.?parser|auto.?tool/i.test(r.text)) {
      line("warn", "Brev tool calling", "no parser on the container → proxy shim will be used (works, slightly slower)",
        "restart kavach-llm with NIM_PASSTHROUGH_ARGS (NOTES → Brev container)");
    } else {
      line(false, "Brev tool calling", `status ${r.status}, no tool_calls`, "check BREV_LLM_MODEL matches `curl localhost:8000/v1/models`");
    }
  } catch (e) {
    line(false, "Brev tool calling", errMsg(e), "Brev is slow or down — run again; if it stays down, set NIM_BACKEND=hosted");
  }
  return true;
}

async function checkHosted() {
  if (!KEY) return line(false, "Hosted fallback key", "NVIDIA_API_KEY is missing", "put NVIDIA_API_KEY in server/.env (vision + fallback need it)");
  try {
    const r = await post(HOSTED + "/chat/completions", { model: HOSTED_AGENT, max_tokens: 64, messages: [{ role: "user", content: "Say OK." }], ...NO_THINK }, { auth: true });
    const fix = r.status === 401 || r.status === 403 ? "the key in server/.env is wrong or expired — make a new one on build.nvidia.com" : "hosted API trouble — retry in a minute";
    line(r.ok && !!r.json?.choices, "Hosted fallback key works", `status ${r.status}, ${r.ms}ms`, fix);
  } catch (e) {
    line(false, "Hosted fallback key works", errMsg(e), "no internet to integrate.api.nvidia.com?");
  }
}

async function checkVision(png) {
  if (!KEY) return line(false, "Vision model", "no NVIDIA_API_KEY", "put NVIDIA_API_KEY in server/.env");
  if (!png) return line(false, "Vision model", "agent/test/es-uscis-whatsapp.png missing", "git checkout agent/test/es-uscis-whatsapp.png");
  try {
    const r = await post(HOSTED + "/chat/completions", {
      model: HOSTED_VISION, max_tokens: 512, ...NO_THINK,
      messages: [{ role: "user", content: [{ type: "text", text: "Transcribe all text in this image exactly. Output only the text." }, { type: "image_url", image_url: { url: png } }] }]
    }, { auth: true, timeout: 20000 });
    const txt = String(r.json?.choices?.[0]?.message?.content || "");
    line(r.ok && /USCIS/i.test(txt), "Vision model reads the screenshot", `status ${r.status}, ${r.ms}ms${r.ok && !/USCIS/i.test(txt) ? ", text did not contain USCIS" : ""}`,
      "vision model down? try the backup model in NOTES → Models (BREV_VL_MODEL)");
  } catch (e) {
    line(false, "Vision model reads the screenshot", errMsg(e), "retry; hosted vision sometimes spikes");
  }
}

async function checkServer() {
  try {
    const r = await post(SERVER, {}, { timeout: 3000 });
    const ok = r.status === 400 && /model must be/.test(r.text);
    line(ok, "Server on :8787 responds", `status ${r.status}`, "`cd server && npm start` (and keep that terminal open)");
    return ok;
  } catch (e) {
    line(false, "Server on :8787 responds", errMsg(e), "`cd server && npm start` (and keep that terminal open)");
    return false;
  }
}

// Voice (Gemini Live): token from our server + the Live WebSocket answers setup within 5 s. Never prints the token.
// Not counted as a problem if voice fails: the side panel falls back to the browser voice. → warning only.
async function checkVoice() {
  const name = "Voice: Gemini Live token + connect (<5s)";
  const fix = "GEMINI_API_KEY in server/.env, restart `npm start`; demo still works (fallback voice)";
  const t0 = Date.now();
  try {
    const demo = JSON.parse(fs.readFileSync(path.join(ROOT, "agent", "demo_run.json"), "utf8"));
    const r = await fetch(SERVER.replace("/api/chat", "/api/voice/token"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: demo.verdict, lang: "es", text: demo.input.preview }), signal: AbortSignal.timeout(5000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.token) return line("warn", name, `token HTTP ${r.status} ${j.error || ""}`, fix);
    const ok = await new Promise((resolve) => {
      const ws = new WebSocket(j.wsUrl + "?access_token=" + encodeURIComponent(j.token));
      const t = setTimeout(() => { try { ws.close(); } catch {} resolve("timeout"); }, Math.max(500, 5000 - (Date.now() - t0)));
      ws.onopen = () => ws.send(JSON.stringify({ setup: { model: "models/" + j.model } }));
      ws.onmessage = async (ev) => {
        const raw = typeof ev.data === "string" ? ev.data : Buffer.from(await ev.data.arrayBuffer()).toString("utf8");
        if (raw.includes("setupComplete")) { clearTimeout(t); ws.close(1000); resolve(true); }
      };
      ws.onclose = (e) => { clearTimeout(t); resolve(e.code === 1000 ? true : `closed ${e.code} ${String(e.reason).slice(0, 60)}`); };
    });
    line(ok === true ? true : "warn", name, ok === true ? `${j.model}, ${Date.now() - t0}ms` : String(ok), fix);
  } catch (e) {
    line("warn", name, errMsg(e), fix);
  }
}

// Auto-detection screen (Gmail/Outlook/WhatsApp card): a scam → scam/suspicious, a family text → safe, each <5 s.
// Warning only: if it fails, the card still appears via Quick Check on the device.
async function checkScreen() {
  const name = "Email screen: /api/screen (scam flagged, safe passes, .gov page never flagged, <5s)";
  const fix = "restart `npm start` so it has /api/screen; cards still work via local Quick Check";
  const ask = async (text, pageUrl) => {
    const r = await post(SERVER.replace("/api/chat", "/api/screen"), pageUrl ? { text, pageUrl } : { text }, { timeout: 6000 });
    return { ms: r.ms, verdict: r.json && r.json.verdict, status: r.status, gov: !!(r.json && r.json.govSite) };
  };
  try {
    const scam = "USCIS: your case is suspended. Pay $500 in gift cards today or ICE will arrest you.";
    const a = await ask(scam);
    const b = await ask("Hi mom, I landed safe. Call you tonight.");
    // Same scam words, but the page the user is ON is reportfraud.ftc.gov → never flagged.
    const g = await ask(scam, "https://reportfraud.ftc.gov/form/main");
    const ok = (a.verdict === "scam" || a.verdict === "suspicious") && b.verdict === "safe" && g.verdict === "safe" && g.gov
      && a.ms < 5000 && b.ms < 5000;
    line(ok ? true : "warn", name, `scam→${a.verdict || "HTTP " + a.status} ${a.ms}ms, safe→${b.verdict || "HTTP " + b.status} ${b.ms}ms, .gov page→${g.verdict || "HTTP " + g.status}${g.gov ? "" : " (no gov guard — restart npm start)"}`, fix);
  } catch (e) {
    line("warn", name, errMsg(e), fix);
  }
}

async function checkDeep(runDeepCheck, name, input) {
  const t0 = Date.now();
  let steps = 0;
  try {
    const v = await runDeepCheck(input, () => { steps++; });
    const ms = Date.now() - t0;
    const ok = v.mode === "deep" && v.verdict === "scam" && ms < 15000;
    line(ok, name, `${v.mode} ${v.verdict}/${v.confidence}, ${steps} steps, ${ms}ms`,
      v.mode !== "deep" ? "server unreachable from Deep Check — is `npm start` running?" : ms >= 15000 ? "too slow — check Brev/hosted latency, or use demo replay" : "wrong verdict — run `node agent/test/run_deep.mjs 1` and look at the steps");
  } catch (e) {
    line(false, name, "threw: " + errMsg(e), "this should never happen — run node agent/test/run_deep.mjs");
  }
}

function checkReplay() {
  const f = path.join(ROOT, "agent", "demo_run.json");
  try {
    const rec = JSON.parse(fs.readFileSync(f, "utf8"));
    const steps = Array.isArray(rec.steps) ? rec.steps.length : 0;
    const v = rec.verdict || {};
    // officialContact comes from data/official_contacts.json (a real official number is expected there) — skip it.
    const leak = /EAC\d{10}|\d{3}-\d{4}/.test(JSON.stringify({ ...rec, verdict: { ...v, officialContact: null } }));
    const ok = steps >= 4 && v.verdict === "scam" && !leak;
    line(ok, "Demo replay file loads (agent/demo_run.json)", `${steps} steps, ${v.verdict}/${v.confidence}, recorded ${String(rec.recordedAt || "?").slice(0, 10)}${leak ? ", CONTAINS A REAL NUMBER" : ""}`,
      "re-record: RECORD=agent/demo_run.json node agent/test/run_deep.mjs 1 es-screenshot");
  } catch (e) {
    line(false, "Demo replay file loads (agent/demo_run.json)", errMsg(e), "git checkout agent/demo_run.json, or re-record (NOTES → Demo replay)");
  }
}

(async () => {
  console.log(`Kavach preflight — backend ${BACKEND}${BACKEND === "brev" ? ` (${BREV})` : ""}\n`);
  const pngFile = path.join(ROOT, "agent", "test", "es-uscis-whatsapp.png");
  const png = fs.existsSync(pngFile) ? "data:image/png;base64," + fs.readFileSync(pngFile).toString("base64") : null;

  await checkBrev();
  await Promise.all([checkHosted(), checkVision(png)]);
  const serverUp = await checkServer();

  const agent = await import(pathToFileURL(path.join(ROOT, "agent", "agent.js")).href);
  const { TEST_MESSAGES } = await import(pathToFileURL(path.join(ROOT, "agent", "test", "messages.js")).href);
  agent.CONFIG.serverUrl = SERVER;
  if (agent.CONFIG.cacheMs !== undefined) agent.CONFIG.cacheMs = 0; // measure the real path, not the cache
  if (serverUp) {
    const es = TEST_MESSAGES.find((m) => m.id === "es-uscis-whatsapp");
    await checkDeep(agent.runDeepCheck, "Deep Check: Spanish text demo (deep, scam, <15s)", { text: es.text });
    if (png) await checkDeep(agent.runDeepCheck, "Deep Check: Spanish screenshot (deep, scam, <15s)", { imageDataUrl: png });
    else line(false, "Deep Check: Spanish screenshot", "agent/test/es-uscis-whatsapp.png missing", "git checkout agent/test/es-uscis-whatsapp.png");
  } else {
    line(false, "Deep Check: Spanish text + screenshot", "skipped — server is not running", "`cd server && npm start`, then run preflight again");
  }
  if (serverUp) await checkScreen();
  if (serverUp) await checkVoice();
  checkReplay();

  const bad = results.filter((r) => r === false).length;
  const warn = results.filter((r) => r === "warn").length;
  console.log(`\n${bad ? `❌ ${bad} problem(s)` : "✅ ALL GOOD"}${warn ? `, ⚠️  ${warn} warning(s)` : ""} — ${results.length} checks`);
  if (bad) console.log("Last resort on stage: demo replay ON (NOTES → Demo replay).");
  process.exit(bad ? 1 : 0);
})();
