// server/index.js — Role 3 (Agent & Backend)
// Contract: PRD section 8.5 — POST /api/chat forwards an OpenAI chat-completions body to NVIDIA NIM.
// The extension sends a LOGICAL model name ("agent" or "vision"); this server swaps in the real model ID.
// Backends: "hosted" (build.nvidia.com, needs NVIDIA_API_KEY) or "brev" (self-hosted NIMs via `brev port-forward`).
// Run: npm start   (= node --env-file=.env index.js)

const express = require("express");

// ---- config -----------------------------------------------------------------
const MODELS = {
  // IDs verified with scripts/smoke.js against build.nvidia.com (see agent/NOTES.md).
  hosted: {
    agent: "nvidia/nemotron-3.5-lightning-30b-a3b",
    vision: "nvidia/nemotron-3.5-super-vl-120b-a12b",
  },
  // IDs served by the Brev NIM containers. Confirm with `node --env-file=.env scripts/smoke.js brev`.
  brev: {
    agent: process.env.BREV_LLM_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b",
    vision: process.env.BREV_VL_MODEL || "nvidia/nemotron-3.5-super-vl-120b-a12b",
  },
};

const PORT = Number(process.env.PORT) || 8787;
const KEY = process.env.NVIDIA_API_KEY || "";
const BACKEND = (process.env.NIM_BACKEND || "hosted").toLowerCase() === "brev" ? "brev" : "hosted";
const HOSTED_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const BREV_BASE = {
  agent: trimUrl(process.env.BREV_LLM_URL || "http://localhost:8000"),
  // No VL model on Brev by default: vision only tries Brev when BREV_VL_URL is set AND healthy, else hosted.
  vision: process.env.BREV_VL_URL ? trimUrl(process.env.BREV_VL_URL) : null,
};
const UPSTREAM_TIMEOUT_MS = 30000;
const BREV_TIMEOUT_MS = 12000; // Brev slower than this → give up and try hosted
const HEALTH_TIMEOUT_MS = 2000;
const HEALTH_CACHE_MS = 30000;

if (!KEY && BACKEND !== "brev") {
  console.log("NVIDIA_API_KEY missing — copy .env.example to .env");
  process.exit(1);
}

function trimUrl(u) { return String(u).replace(/\/+$/, "").replace(/\/v1$/, ""); }
// Never let the key leak into a log line or response.
function redact(s) { s = String(s); return KEY ? s.split(KEY).join("[REDACTED]") : s; }

// ---- Brev health check (cached per logical model) ---------------------------
const health = {}; // logical -> { ok, at }
async function brevReady(logical) {
  if (!BREV_BASE[logical]) return false;
  const cached = health[logical];
  if (cached && Date.now() - cached.at < HEALTH_CACHE_MS) return cached.ok;
  let ok = false;
  try {
    const r = await fetch(BREV_BASE[logical] + "/v1/health/ready", { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    ok = r.ok;
  } catch { ok = false; }
  health[logical] = { ok, at: Date.now() };
  return ok;
}
function markBrevDown(logical) { health[logical] = { ok: false, at: Date.now() }; }

const HOSTED_ROUTE = { backend: "hosted", url: HOSTED_URL, headers: () => ({ Authorization: "Bearer " + KEY }) };

// Ordered list of places to try for this request: Brev first (if chosen + healthy), then hosted (if we have a key).
async function routes(logical) {
  const list = [];
  if (BACKEND === "brev" && await brevReady(logical)) {
    list.push({ backend: "brev", url: BREV_BASE[logical] + "/v1/chat/completions", healthUrl: BREV_BASE[logical] + "/v1/health/ready", headers: () => ({}) });
  }
  if (KEY) list.push(HOSTED_ROUTE);
  return list;
}

// ---- Brev without a tool-call parser -----------------------------------------
// If the vLLM container was started without --enable-auto-tool-choice / --tool-call-parser, it rejects
// tool_choice:"auto" with HTTP 400. The model still writes calls as text in the qwen3_coder XML format:
//   <tool_call><function=NAME><parameter=KEY>VALUE</parameter>…</function></tool_call>
// So we resend with tool_choice:"none" (tools stay in the prompt) and turn that text into tool_calls.
// Fallback only: the real parser (--enable-auto-tool-choice --tool-call-parser qwen3_coder) is the normal path.
// After a "no parser" 400 we use the shim for 5 min, then try real tool calling again (container may be fixed).
let brevNoToolParserAt = 0;
const SHIM_RETRY_MS = 5 * 60 * 1000;
const shimActive = () => brevNoToolParserAt > 0 && Date.now() - brevNoToolParserAt < SHIM_RETRY_MS;
const NO_PARSER_RE = /tool-call-parser|auto-tool-choice/i;

function paramType(tools, fn, key) {
  const t = (tools || []).find((x) => x && x.function && x.function.name === fn);
  return t && t.function.parameters && t.function.parameters.properties && t.function.parameters.properties[key]
    ? t.function.parameters.properties[key].type : "string";
}
function parseXmlToolCalls(json, tools) {
  const msg = json && json.choices && json.choices[0] && json.choices[0].message;
  if (!msg || typeof msg.content !== "string" || !msg.content.includes("<tool_call>")) return json;
  const calls = [];
  const blockRe = /<tool_call>\s*<function=([^>\s]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/g;
  let m, i = 0;
  while ((m = blockRe.exec(msg.content))) {
    const name = m[1].trim();
    const args = {};
    const pRe = /<parameter=([^>\s]+)>\n?([\s\S]*?)\n?<\/parameter>/g;
    let p;
    while ((p = pRe.exec(m[2]))) {
      const key = p[1].trim();
      const raw = p[2];
      const type = paramType(tools, name, key);
      if (type === "string") { args[key] = raw; continue; }
      try { args[key] = JSON.parse(raw); }
      catch { args[key] = type === "array" ? raw.split("\n").map((x) => x.trim()).filter(Boolean) : raw; }
    }
    calls.push({ id: "call_" + Date.now().toString(36) + "_" + i++, type: "function", function: { name, arguments: JSON.stringify(args) } });
  }
  if (!calls.length) return json;
  const rest = msg.content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
  json.choices[0].message = { ...msg, content: rest || null, tool_calls: calls };
  json.choices[0].finish_reason = "tool_calls";
  return json;
}

// Watchdog for Brev: if the port-forward/tunnel dies mid-request (connection hangs instead of refusing),
// a health ping (every 0.5s, 600ms each) fails and we abort → the caller retries hosted in ~1s, not 12s.
const WATCHDOG_MS = 600;
const WATCHDOG_EVERY_MS = 500;

// One upstream attempt. Returns { status, json } or throws (network error / timeout / watchdog).
async function attempt(rt, upstreamBody, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException("upstream timeout", "TimeoutError")), timeoutMs);
  let watch = null;
  if (rt.healthUrl) {
    const probe = async () => {
      try {
        const h = await fetch(rt.healthUrl, { signal: AbortSignal.timeout(WATCHDOG_MS) });
        if (!h.ok) throw new Error("health " + h.status);
      } catch {
        if (!ctl.signal.aborted) ctl.abort(new Error("brev unreachable (watchdog)"));
      }
    };
    probe();
    watch = setInterval(probe, WATCHDOG_EVERY_MS);
  }
  try {
    const r = await fetch(rt.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...rt.headers() },
      body: JSON.stringify(upstreamBody),
      signal: ctl.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, ok: r.ok, json, text };
  } finally {
    clearTimeout(timer);
    if (watch) clearInterval(watch);
  }
}

// ---- app --------------------------------------------------------------------
const app = express();

// CORS so the extension (chrome-extension://…) can call us.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Expose-Headers", "X-Kavach-Backend");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "10mb" }));

app.post("/api/chat", async (req, res) => {
  const t0 = Date.now();
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const logical = body.model;
  if (logical !== "agent" && logical !== "vision") {
    console.log(`${String(logical).slice(0, 30)} rejected 400 ${Date.now() - t0}ms`);
    return res.status(400).json({ error: 'model must be "agent" or "vision"' });
  }

  const list = await routes(logical);
  if (!list.length) {
    console.log(`${logical} none 503 ${Date.now() - t0}ms`);
    return res.status(503).json({ error: logical === "vision" ? "no vision backend (set NVIDIA_API_KEY)" : "Brev is down and no NVIDIA_API_KEY for hosted fallback" });
  }

  let status = 502, out = { error: "upstream unreachable" }, used = list[0].backend, note = "";
  for (let i = 0; i < list.length; i++) {
    const rt = list[i];
    const last = i === list.length - 1;
    used = rt.backend;
    let upstreamBody = { ...body, model: MODELS[rt.backend][logical], stream: false };
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    const shim = rt.backend === "brev" && hasTools && shimActive();
    if (shim) upstreamBody.tool_choice = "none";
    try {
      let r = await attempt(rt, upstreamBody, rt.backend === "brev" ? BREV_TIMEOUT_MS : UPSTREAM_TIMEOUT_MS);
      // First time we learn Brev has no tool parser: remember it and retry this request with the shim.
      if (rt.backend === "brev" && hasTools && !shim && r.status === 400 && NO_PARSER_RE.test(r.text)) {
        brevNoToolParserAt = Date.now();
        console.log("brev: TOOL SHIM FALLBACK ON — no tool-call parser on the container → parsing tool calls in the proxy (restart vLLM with --enable-auto-tool-choice --tool-call-parser qwen3_coder)");
        upstreamBody = { ...upstreamBody, tool_choice: "none" };
        r = await attempt(rt, upstreamBody, BREV_TIMEOUT_MS);
      }
      if (rt.backend === "brev" && (r.status >= 500 || r.json === null) && !last) {
        markBrevDown(logical); note = ` (brev ${r.status} → hosted)`; continue;
      }
      status = r.json === null ? (r.ok ? 502 : r.status) : r.status;
      out = r.json === null ? { error: "upstream returned non-JSON", upstreamStatus: r.status } : r.json;
      if (rt.backend === "brev" && hasTools && upstreamBody.tool_choice === "none" && body.tool_choice !== "none" && r.ok) {
        out = parseXmlToolCalls(out, body.tools); note += " (tool shim fallback)";
      }
      break;
    } catch (e) {
      const timedOut = e && (e.name === "TimeoutError" || e.name === "AbortError");
      if (rt.backend === "brev") markBrevDown(logical);
      if (!last) { note = ` (brev ${timedOut ? "timeout" : "unreachable"} after ${Date.now() - t0}ms → hosted)`; continue; }
      status = timedOut ? 504 : 502;
      if (!timedOut) console.log("upstream error:", redact(e && e.message).slice(0, 120));
      out = { error: timedOut ? "upstream timeout" : "upstream unreachable" };
    }
  }
  // Which backend answered, for tests (eval counts fallbacks). No secrets in it.
  res.set("X-Kavach-Backend", used + (note.includes("→ hosted") ? " fallback" : "") + (note.includes("shim") ? " shim" : ""));
  res.status(status).json(out);
  console.log(`${logical} ${used} ${status} ${Date.now() - t0}ms${note}`);
});

// ---- POST /api/screen — fast yes/no screen for every opened email/chat ------------
// Body { text } (already masked on the device, max 4000 chars). One short "agent" call (thinking off, temp 0),
// same Brev → hosted routing as /api/chat, whole thing capped at 5 s. Answers { verdict, reason } with
// verdict "scam" | "suspicious" | "safe", or 503 { error: "screen_unavailable" } (the extension then uses
// Quick Check locally). Log: backend, verdict, ms — never the text.
const SCREEN_BUDGET_MS = 5000;
const SCREEN_MAX_CHARS = 4000;
const SCREEN_VERDICTS = ["scam", "suspicious", "safe"];
const SCREEN_SYSTEM = [
  "You screen messages for scams that target immigrants and elderly people.",
  "Signs of a scam: someone pretending to be a government agency (USCIS, IRS, ICE, SSA, police, courts);",
  "payment by gift card, crypto, wire transfer, Zelle or cash app; asking for a card number, CVC, SSN,",
  "password, PIN or a verification code; threats of arrest, deportation or fines; fake or strange links;",
  "pressure to act right now. Normal personal, work, shopping and real appointment messages are safe.",
  "Text like [PHONE_1] or [EMAIL_1] is a hidden personal detail, not a sign of anything.",
  "Answer with ONLY one JSON object, nothing else:",
  '{"verdict":"scam"|"suspicious"|"safe","reason":"<one short plain English sentence>"}',
  "The reason must not contain any numbers, phone numbers, links or email addresses.",
].join(" ");

function parseScreen(json) {
  const msg = json && json.choices && json.choices[0] && json.choices[0].message;
  let content = msg && typeof msg.content === "string" ? msg.content : "";
  content = content.replace(/<think>[\s\S]*?<\/think>/g, "");
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj;
  try { obj = JSON.parse(m[0]); } catch { return null; }
  const verdict = String(obj && obj.verdict || "").toLowerCase().trim();
  if (!SCREEN_VERDICTS.includes(verdict)) return null;
  let reason = typeof obj.reason === "string" ? obj.reason : "";
  // No numbers / links / emails in the reason, ever. If the model slipped one in, use a plain default.
  reason = reason.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!reason || /\d|https?:|www\.|@|\.(com|gov|org|net)\b/i.test(reason)) {
    reason = verdict === "safe" ? "This message does not show common scam signs."
      : verdict === "scam" ? "This message shows common scam signs." : "This message has some signs that need a closer look.";
  }
  return { verdict, reason };
}

app.post("/api/screen", async (req, res) => {
  const t0 = Date.now();
  const deadline = t0 + SCREEN_BUDGET_MS;
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const text = typeof body.text === "string" ? body.text.trim().slice(0, SCREEN_MAX_CHARS) : "";
  if (!text) {
    console.log(`screen - 400 ${Date.now() - t0}ms`);
    return res.status(400).json({ error: "text required" });
  }
  let used = "none";
  try {
    const list = await routes("agent");
    for (let i = 0; i < list.length; i++) {
      const rt = list[i];
      const left = deadline - Date.now();
      if (left < 300) break;
      used = rt.backend + (i > 0 ? " fallback" : "");
      const upstreamBody = {
        model: MODELS[rt.backend].agent,
        messages: [{ role: "system", content: SCREEN_SYSTEM }, { role: "user", content: "Message:\n\"\"\"\n" + text + "\n\"\"\"" }],
        temperature: 0,
        max_tokens: 120,
        stream: false,
        chat_template_kwargs: { enable_thinking: false },
      };
      try {
        // Brev gets at most 3.5 s of the budget so hosted still has time if it hangs.
        const budget = rt.backend === "brev" && i < list.length - 1 ? Math.min(left, 3500) : left;
        const r = await attempt(rt, upstreamBody, budget);
        const out = r.ok ? parseScreen(r.json) : null;
        if (out) {
          res.json(out);
          return console.log(`screen ${used} ${out.verdict} ${Date.now() - t0}ms`);
        }
        if (rt.backend === "brev" && r.status >= 500) markBrevDown("agent");
      } catch (e) {
        if (rt.backend === "brev") markBrevDown("agent");
      }
    }
  } catch { /* fall through */ }
  res.status(503).json({ error: "screen_unavailable" });
  console.log(`screen ${used} unavailable ${Date.now() - t0}ms`);
});

// ---- POST /api/voice/token — Gemini Live ephemeral token ---------------------
// The extension never sees GEMINI_API_KEY. We mint a single-use, short-lived token that is LOCKED to the Live
// model AND to a system instruction we build here from { verdict, lang, text } (agent/voicePrompt.js): grounded
// in the verdict, official contact re-checked against data/, message text masked again. The client cannot change
// the instruction (tested: with an ephemeral token, Live uses the token's setup, not the client's).
// Never logs content — only language, verdict word, status, ms.
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live";
const GEMINI_VOICE = process.env.GEMINI_VOICE || "Sulafat";
const GEMINI_TOKEN_URL = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
const GEMINI_WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const VOICE_TOKEN_TTL_MS = 15 * 60 * 1000; // whole conversation must fit (native audio sessions cap ~15 min anyway)
const VOICE_CONNECT_TTL_MS = 60 * 1000;    // must open the WebSocket within 1 min
const VOICE_RATE = { max: 8, windowMs: 60 * 1000 };
const voiceHits = new Map(); // ip -> [timestamps]
function redactGemini(s) { s = redact(s); return GEMINI_KEY ? s.split(GEMINI_KEY).join("[REDACTED]") : s; }
function voiceRateLimited(ip) {
  const now = Date.now();
  const hits = (voiceHits.get(ip) || []).filter((t) => now - t < VOICE_RATE.windowMs);
  hits.push(now);
  voiceHits.set(ip, hits);
  if (voiceHits.size > 1000) voiceHits.clear();
  return hits.length > VOICE_RATE.max;
}
let voicePromptMod = null;
const voicePrompt = () => (voicePromptMod ||= import("../agent/voicePrompt.js"));

app.post("/api/voice/token", async (req, res) => {
  const t0 = Date.now();
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const lang = typeof body.lang === "string" ? body.lang.slice(0, 12) : "en";
  const tag = `voice ${lang} ${body.verdict && body.verdict.verdict ? String(body.verdict.verdict).slice(0, 12) : "pending"}`;
  if (!GEMINI_KEY) {
    console.log(`${tag} 503 no key`);
    return res.status(503).json({ error: "voice not configured (GEMINI_API_KEY missing in server/.env)" });
  }
  if (voiceRateLimited(req.ip || "?")) {
    console.log(`${tag} 429`);
    return res.status(429).json({ error: "too many voice sessions, wait a minute" });
  }
  try {
    const vp = await voicePrompt();
    const L = vp.voiceLanguage(lang);
    const instruction = await vp.buildVoiceInstruction({ verdict: body.verdict || null, lang: L.code, text: body.text || "" });
    const now = Date.now();
    const upstream = {
      uses: 1,
      expireTime: new Date(now + VOICE_TOKEN_TTL_MS).toISOString(),
      newSessionExpireTime: new Date(now + VOICE_CONNECT_TTL_MS).toISOString(),
      bidiGenerateContentSetup: {
        model: "models/" + GEMINI_LIVE_MODEL,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } },
        },
        systemInstruction: { parts: [{ text: instruction }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        // Scared / older speakers pause mid-sentence: wait a bit longer before treating silence as "done".
        realtimeInputConfig: { automaticActivityDetection: { endOfSpeechSensitivity: "END_SENSITIVITY_LOW", silenceDurationMs: 900 } },
      },
    };
    const r = await fetch(GEMINI_TOKEN_URL, {
      method: "POST",
      headers: { "x-goog-api-key": GEMINI_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(upstream),
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!r.ok || !json || !json.name) {
      const msg = json && json.error && json.error.message ? json.error.message : "token request failed";
      console.log(`${tag} upstream ${r.status} ${Date.now() - t0}ms: ${redactGemini(msg).slice(0, 160)}`);
      return res.status(502).json({ error: "could not start voice", upstreamStatus: r.status });
    }
    res.set("Cache-Control", "no-store");
    res.json({ token: json.name, model: GEMINI_LIVE_MODEL, wsUrl: GEMINI_WS_URL, lang: L.code, expiresAt: upstream.expireTime });
    console.log(`${tag} 200 ${Date.now() - t0}ms`);
  } catch (e) {
    const timedOut = e && (e.name === "TimeoutError" || e.name === "AbortError");
    console.log(`${tag} ${timedOut ? 504 : 500} ${Date.now() - t0}ms: ${redactGemini(e && e.message).slice(0, 120)}`);
    res.status(timedOut ? 504 : 500).json({ error: timedOut ? "voice token timeout" : "voice token error" });
  }
});

// Anything else: no other endpoints (PRD 8.5 + /api/screen + /api/voice/token).
app.use((req, res) => res.status(404).json({ error: "not found" }));

// Bad JSON / body too large → clean JSON, no stack.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status === 413 ? "body too large" : status === 400 ? "invalid JSON" : "server error" });
});

app.listen(PORT, () => {
  const where = BACKEND === "brev"
    ? `brev (agent ${BREV_BASE.agent}, vision ${BREV_BASE.vision || "hosted"})${KEY ? ", hosted fallback on" : ", NO hosted fallback (no key)"}`
    : "hosted";
  console.log(`Kavach proxy on http://localhost:${PORT} → ${where}`);
});
