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
  vision: trimUrl(process.env.BREV_VL_URL || "http://localhost:8001"),
};
const UPSTREAM_TIMEOUT_MS = 30000;
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

// Decide where this request goes. Returns { backend, url, headers }.
async function route(logical) {
  if (BACKEND === "brev") {
    if (await brevReady(logical) || !KEY) {
      return { backend: "brev", url: BREV_BASE[logical] + "/v1/chat/completions", headers: {} };
    }
    // Brev is down but we have a key: fall back to hosted.
  }
  return { backend: "hosted", url: HOSTED_URL, headers: { Authorization: "Bearer " + KEY } };
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

  const { backend, url, headers } = await route(logical);
  const upstreamBody = { ...body, model: MODELS[backend][logical], stream: false };
  let status = 502;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    status = r.status;
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    if (json === null) {
      status = r.ok ? 502 : r.status;
      res.status(status).json({ error: "upstream returned non-JSON", upstreamStatus: r.status });
    } else {
      res.status(r.status).json(json);
    }
  } catch (e) {
    const timedOut = e && (e.name === "TimeoutError" || e.name === "AbortError");
    status = timedOut ? 504 : 502;
    if (!timedOut) console.log("upstream error:", redact(e && e.message).slice(0, 120));
    res.status(status).json({ error: timedOut ? "upstream timeout" : "upstream unreachable" });
  }
  console.log(`${logical} ${backend} ${status} ${Date.now() - t0}ms`);
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
  const where = BACKEND === "brev" ? `brev (agent ${BREV_BASE.agent}, vision ${BREV_BASE.vision})${KEY ? ", hosted fallback on" : ""}` : "hosted";
  console.log(`Kavach proxy on http://localhost:${PORT} → ${where}`);
});
