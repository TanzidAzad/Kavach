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
    list.push({ backend: "brev", url: BREV_BASE[logical] + "/v1/chat/completions", headers: () => ({}) });
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

// One upstream attempt. Returns { status, json } or throws (network error / timeout).
async function attempt(rt, upstreamBody, timeoutMs) {
  const r = await fetch(rt.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...rt.headers() },
    body: JSON.stringify(upstreamBody),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, ok: r.ok, json, text };
}

// ---- app --------------------------------------------------------------------
const app = express();

// CORS so the extension (chrome-extension://…) can call us.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
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
      if (!last) { note = ` (brev ${timedOut ? "timeout" : "unreachable"} → hosted)`; continue; }
      status = timedOut ? 504 : 502;
      if (!timedOut) console.log("upstream error:", redact(e && e.message).slice(0, 120));
      out = { error: timedOut ? "upstream timeout" : "upstream unreachable" };
    }
  }
  res.status(status).json(out);
  console.log(`${logical} ${used} ${status} ${Date.now() - t0}ms${note}`);
});

// Anything else: no other endpoints (PRD 8.5).
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
