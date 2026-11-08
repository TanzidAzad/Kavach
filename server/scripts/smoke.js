// server/scripts/smoke.js — Role 3. Proves Nemotron works on the chosen backend.
// Run from server/:  node --env-file=.env scripts/smoke.js [hosted|brev]
// Prints only model IDs and one pass/fail line per check. Never prints keys, headers or full responses.

const zlib = require("node:zlib");

const MODE = (process.argv[2] || process.env.NIM_BACKEND || "hosted").toLowerCase();
const KEY = process.env.NVIDIA_API_KEY || "";
const HOSTED = "https://integrate.api.nvidia.com/v1";
const LLM_BASE = MODE === "brev" ? trimUrl(process.env.BREV_LLM_URL || "http://localhost:8000") + "/v1" : HOSTED;
// No VL model on Brev by default: vision is tested on hosted unless BREV_VL_URL is set (same rule as index.js).
const VL_ON_BREV = MODE === "brev" && !!process.env.BREV_VL_URL;
const VL_BASE = VL_ON_BREV ? trimUrl(process.env.BREV_VL_URL) + "/v1" : HOSTED;
const TIMEOUT_MS = 60000;

function trimUrl(u) { return u.replace(/\/+$/, "").replace(/\/v1$/, ""); }
function redact(s) { s = String(s); return KEY ? s.split(KEY).join("[REDACTED]") : s; }
function short(s, n = 80) { s = redact(s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; }
function stripThink(s) { return String(s || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim(); }

function headers(base) {
  const h = { "Content-Type": "application/json", Accept: "application/json" };
  if (base === HOSTED) h.Authorization = "Bearer " + KEY;
  return h;
}
const NO_THINK = { chat_template_kwargs: { enable_thinking: false } }; // what agent.js sends

async function call(base, path, body) {
  const t0 = Date.now();
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: headers(base),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text, ms: Date.now() - t0 };
}

// ---- tiny PNG generator (solid colour), no deps ----
function solidPng(w, h, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array(h).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CASE_TOOL = {
  type: "function",
  function: {
    name: "validate_case_number",
    description: "Check whether a USCIS receipt/case number has a valid format (3 letters + 10 digits).",
    parameters: {
      type: "object",
      properties: { caseNumber: { type: "string", description: "The case number exactly as written in the message" } },
      required: ["caseNumber"],
    },
  },
};

const ES_SCAM = "Hola, le escribe USCIS por WhatsApp. Su caso IOE12345 tiene un problema y será deportado en 24 horas. Para evitarlo pague $500 en tarjetas de regalo de Google Play y envíe los códigos a este número hoy.";
const HI_SCAM = "यह ICE (इमिग्रेशन विभाग) की ओर से अंतिम चेतावनी है। आपके वीज़ा में गड़बड़ी पाई गई है। अगर आज 2 घंटे के अंदर $1500 बिटकॉइन में जुर्माना नहीं भरा तो पुलिस आपको गिरफ़्तार करके देश से निकाल देगी। किसी को मत बताइए।";

function summaryBody(model, text) {
  return {
    model, temperature: 0, max_tokens: 1024, ...NO_THINK,
    messages: [
      { role: "system", content: "/no_think You are a scam analyst. Reply in English with exactly one line, no preamble." },
      { role: "user", content: "Summarize this message in one English sentence and say whether it looks like a scam:\n\n" + text },
    ],
  };
}

function oneLineEnglish(content) {
  const c = stripThink(content);
  return c.length > 10 && /[a-z]{3}/i.test(c) && !/[ऀ-ॿ]/.test(c) && /scam|fraud|suspicious/i.test(c);
}

async function main() {
  if ((MODE !== "brev" || !VL_ON_BREV) && !KEY) { console.log("NVIDIA_API_KEY missing — copy .env.example to .env"); process.exit(1); }
  console.log(`backend: ${MODE}`);

  // a. list models
  const llmList = await call(LLM_BASE, "/models");
  if (!llmList.ok) { console.log(`models list failed: HTTP ${llmList.status} ${short(llmList.text)}`); process.exit(1); }
  let llmIds = (llmList.json.data || []).map((m) => m.id);
  let vlIds = llmIds;
  if (VL_ON_BREV) {
    const vlList = await call(VL_BASE, "/models").catch(() => ({ ok: false }));
    vlIds = vlList.ok ? (vlList.json.data || []).map((m) => m.id) : [];
  } else if (MODE === "brev") {
    // vision on hosted: just the known hosted VL model
    vlIds = ["nvidia/nemotron-3.5-super-vl-120b-a12b"];
    console.log("vision: hosted (no BREV_VL_URL)");
  } else {
    llmIds = llmIds.filter((id) => /nemotron/i.test(id));
    vlIds = llmIds;
  }
  console.log("models:", [...new Set([...llmIds, ...vlIds])].join(", "));

  // b. candidates (from the list only)
  const NOT_CHAT = /(vl|vision|embed|rerank|reward|safety|guard|parse|retriever|ocr|content|pii|topic)/i;
  const isVl = (id) => /(vl\b|-vl|vl-|vision)/i.test(id);
  // Prefer smaller/faster models first (agent has a 15s budget), then bigger ones.
  // Nemotron 3.x first (newest), fast tiers before big ones. Non-matching IDs keep list order at the end.
  const rank = (id) => ([/lightning/, /nano/, /super/, /ultra/].findIndex((r) => r.test(id)) + 5) % 5 + (/nemotron-3/i.test(id) ? 0 : 5);
  const chatCands = (MODE === "brev" ? llmIds : llmIds.filter((id) => !NOT_CHAT.test(id))).sort((a, b) => rank(a) - rank(b));
  const vlCands = (VL_ON_BREV ? vlIds : vlIds.filter(isVl)).sort((a, b) => rank(a) - rank(b));

  const results = [];
  const report = (name, pass, ms, note = "") => {
    results.push(pass);
    console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(14)} ${String(ms).padStart(6)} ms ${note}`);
  };

  // pick chat model: must pass plain chat + tool call
  let chatModel = null;
  for (const model of chatCands) {
    const plain = await call(LLM_BASE, "/chat/completions", {
      model, temperature: 0, max_tokens: 1024, ...NO_THINK,
      messages: [{ role: "system", content: "/no_think" }, { role: "user", content: "Reply with the single word: pong" }],
    }).catch((e) => ({ ok: false, status: 0, text: e.message, ms: 0 }));
    const plainOk = plain.ok && /pong/i.test(stripThink(plain.json?.choices?.[0]?.message?.content));
    if (!plainOk) { console.log(`  skip ${model}: chat HTTP ${plain.status} ${short(plain.text, 60)}`); continue; }

    const tool = await call(LLM_BASE, "/chat/completions", {
      model, temperature: 0, max_tokens: 1024, tools: [CASE_TOOL], tool_choice: "auto", ...NO_THINK,
      messages: [
        { role: "system", content: "/no_think You are a scam investigator. Use tools when relevant." },
        { role: "user", content: "A message claims my USCIS case number is IOE1234567890. Is that format valid? Use the tool." },
      ],
    }).catch((e) => ({ ok: false, status: 0, text: e.message, ms: 0 }));
    const tc = tool.json?.choices?.[0]?.message?.tool_calls?.[0];
    let argsOk = false;
    try { argsOk = tc?.function?.name === "validate_case_number" && typeof JSON.parse(tc.function.arguments).caseNumber === "string"; } catch {}
    if (!(tool.ok && argsOk)) {
      console.log(`  skip ${model}: tools HTTP ${tool.status} ${short(tool.text, 60)}`);
      if (/tool-call-parser|auto-tool-choice/i.test(tool.text)) {
        console.log("  → container has no tool parser. Restart vLLM with: --enable-auto-tool-choice --tool-call-parser qwen3_coder");
        console.log("    (NIM env: NIM_ENABLE_AUTO_TOOL_CHOICE=1 NIM_TOOL_CALL_PARSER=qwen3_coder). Until then the proxy parses tool calls itself.");
      }
      continue;
    }

    chatModel = model;
    console.log(`chat model: ${model}`);
    report("plain chat", true, plain.ms);
    const m = tool.json.choices[0].message;
    const thought = !!(m.reasoning_content || m.reasoning || /<think>/.test(m.content || ""));
    report("tool call", true, tool.ms, `args=${short(tc.function.arguments, 50)} thinking=${thought ? "ON (flag ignored?)" : "off"}`);
    break;
  }
  if (!chatModel) { report("plain chat", false, 0, "no candidate worked"); report("tool call", false, 0); }
  else {
    for (const [name, text] of [["spanish scam", ES_SCAM], ["hindi scam", HI_SCAM]]) {
      const r = await call(LLM_BASE, "/chat/completions", summaryBody(chatModel, text)).catch((e) => ({ ok: false, status: 0, text: e.message, ms: 0 }));
      const c = r.json?.choices?.[0]?.message?.content;
      report(name, r.ok && oneLineEnglish(c), r.ms, r.ok ? `"${short(stripThink(c), 90)}"` : `HTTP ${r.status} ${short(r.text, 60)}`);
    }
  }

  // VL check
  const img = "data:image/png;base64," + solidPng(64, 64, [220, 20, 20]).toString("base64");
  let vlModel = null;
  for (const model of vlCands) {
    const r = await call(VL_BASE, "/chat/completions", {
      model, temperature: 0, max_tokens: 1024, // reasoning tokens count against max_tokens
      messages: [{ role: "user", content: [
        { type: "text", text: "What single colour fills this image? Answer with one word." },
        { type: "image_url", image_url: { url: img } },
      ] }],
    }).catch((e) => ({ ok: false, status: 0, text: e.message, ms: 0 }));
    const c = stripThink(r.json?.choices?.[0]?.message?.content);
    if (r.ok && /red/i.test(c)) { vlModel = model; console.log(`vl model: ${model}`); report("vision", true, r.ms, `"${short(c, 30)}"`); break; }
    console.log(`  skip ${model}: vl HTTP ${r.status} ${short(r.ok ? c : r.text, 60)}`);
  }
  if (!vlModel) report("vision", false, 0, "no candidate worked");

  const passed = results.filter(Boolean).length;
  console.log(`${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.log("smoke error:", short(e.message, 120)); process.exit(1); });
