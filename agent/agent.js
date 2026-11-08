// agent/agent.js — Role 3 (Agent & Backend)
// Contract: PRD 8.4 — runDeepCheck({ text, imageDataUrl }, onStep) → Promise<Verdict>
// onStep(toolResult) is called each time a tool finishes, so the popup can add a checklist line.
//
// Flow: [screenshot → vision model → text] → mask(text) → Nemotron tool loop through our server →
// run tools locally with the REAL values (unmasked here, never sent) → submit_verdict → rules in code.
// Server down/offline → runQuickCheck(text) (mode "quick"). Model slow → finish locally from the checks that ran. Never throws.

import { mask, unmaskArgs } from "../core/mask.js";
import { loadData } from "../core/data.js";
import { runQuickCheck } from "../core/quickcheck.js";
import { getToolSchemas, TOOL_RUNNERS, PAYMENTS } from "./toolSchemas.js";
import { SYSTEM_PROMPT, NUDGE_TOOLS, NUDGE_VERDICT, VISION_PROMPT, userMessage } from "./prompts.js";
import { cleanText, cleanList, pickFamilyMessage, URL_RE } from "./sanitize.js";
import { flagOn, replayDemo, makeRecording, saveRecording, FLAG_REPLAY, FLAG_RECORD } from "./demoReplay.js";

export { cleanText };

// ---------- config ----------
export const CONFIG = {
  serverUrl: "http://localhost:8787/api/chat",
  agentModel: "agent", // logical name only — the server maps it to a real model ID
  visionModel: "vision",
  maxTurns: 6,
  maxInputChars: 4000, // longer messages are cut (keeps the model fast; scams are short)
  visionTimeoutMs: 8000, // screenshot reading gets its own budget inside the 15s
  visionMaxTokens: 1500,
  imageMaxSide: 1280, // screenshots are downscaled in the browser before sending
  imageQuality: 0.85,
  totalTimeoutMs: 15000,
  perCallTimeoutMs: 6000, // with thinking off a turn is ~0.3–1s; a slow call gets one retry
  maxTokens: 2048, // Nemotron thinks first; thinking counts against max_tokens
  temperature: 0.2,
  // Nemotron "thinking" (reasoning before answering). Off = ~0.3s per turn instead of 1.5–14s.
  // Sent as chat_template_kwargs.enable_thinking; the server passes it through unchanged.
  thinkFirstTurn: false, // turn that plans which tools to call
  thinkLaterTurns: false // turns that read results and submit the verdict
};

const VERDICTS = ["scam", "suspicious", "safe"];
const CONFIDENCES = ["high", "medium", "unsure"];

// ---------- small helpers ----------

class DeadlineError extends Error {}

function remainingMs(deadline) {
  return deadline - Date.now();
}

// One model call; if it fails or hangs and there's time left, try once more.
async function callModel(messages, tools, deadline, think) {
  try {
    return await callModelOnce(messages, tools, deadline, think);
  } catch (e) {
    if (e instanceof DeadlineError || remainingMs(deadline) < 3000) throw e;
    return callModelOnce(messages, tools, deadline, think);
  }
}

async function callModelOnce(messages, tools, deadline, think) {
  const left = remainingMs(deadline);
  if (left < 500) throw new DeadlineError("out of time");
  const res = await fetch(CONFIG.serverUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CONFIG.agentModel,
      messages,
      tools,
      tool_choice: "auto",
      max_tokens: CONFIG.maxTokens,
      temperature: CONFIG.temperature,
      chat_template_kwargs: { enable_thinking: !!think }
    }),
    signal: AbortSignal.timeout(Math.min(left, CONFIG.perCallTimeoutMs))
  });
  if (!res.ok) throw new Error("server status " + res.status);
  const json = await res.json();
  const msg = json?.choices?.[0]?.message;
  if (!msg) throw new Error("empty model reply");
  return msg;
}

function parseArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  const s = String(raw ?? "").trim();
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : {};
  } catch {
    const m = s.match(/\{[\s\S]*\}/); // model sometimes wraps JSON in text
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {}
    }
    return {};
  }
}

const unknownResult = (tool) => ({
  tool: String(tool || "unknown_tool").slice(0, 40),
  status: "unknown",
  label: "Extra check",
  detail: "Could not run this check"
});

// Put placeholders back over any real value a tool echoed (e.g. a case number in `detail`),
// then mask anything new that looks personal, so the model never sees real values.
function remask(str, map) {
  let out = String(str ?? "");
  const pairs = Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  for (const [ph, real] of pairs) if (real) out = out.split(real).join(ph);
  const extra = mask(out);
  if (Object.keys(extra.map).length === 0) return out;
  // Fresh placeholders could collide with ours ([PHONE_1]), so use a neutral one.
  return extra.masked.replace(/\[[A-Z]+_\d+\]/g, (ph) => (ph in extra.map ? "[HIDDEN]" : ph));
}

// What the model sees for a tool result: short, re-masked, no URLs.
function toolMessage(callId, list, map) {
  const content = list.length
    ? JSON.stringify(list.map((r) => ({ status: r.status, label: r.label, detail: r.detail })))
    : "Skipped: this check does not apply to this message.";
  return { role: "tool", tool_call_id: callId, content: remask(content, map) };
}

// ---------- what the message contains ----------

const hostOf = (u) =>
  String(u ?? "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0].replace(/[.,;:!?)]+$/, "");

// Facts found locally (no model): which case numbers and links exist, so we only run
// checks that apply. Links are read from the MASKED text, so emails don't count as links.
function messageFacts(text, masked, map) {
  const receipts = Object.entries(map).filter(([ph]) => ph.startsWith("[RECEIPT_")).map(([, v]) => v);
  const links = [...new Set((masked.match(new RegExp(URL_RE.source, "gi")) || []).map(hostOf).filter((h) => h.includes(".")))];
  return { receipts, links };
}

// Results that only say "this doesn't apply" — sent to the model, but not shown in the checklist.
const NOT_APPLICABLE =
  /^(No case number found|No website link found|The message does not say which agency|Could not tell how this message was sent|No official guidance found)/i;
const shown = (r) => !(r.status === "unknown" && NOT_APPLICABLE.test(String(r.detail)));

// Runs one tool call safely. Returns ToolResult[] ([] = skipped / not relevant).
async function runTool(name, args, ctx) {
  if (name === "validate_case_number") {
    const value = String(args.caseNumber ?? "").trim();
    if (!ctx.receipts.includes(value)) return []; // only real case numbers mask() found
    ctx.checkedReceipts.add(value);
  }
  if (name === "check_lookalike_domain") {
    const host = hostOf(args.url);
    if (!host || !ctx.links.includes(host)) return []; // only links that are really in the message
    ctx.checkedLinks.add(host);
    args = { url: host };
  }
  if (name === "check_official_contact") ctx.contactArgs.push(args);
  const runner = TOOL_RUNNERS[name];
  if (!runner) return []; // a tool name the model made up: skip, don't show it
  try {
    const out = await runner(args, ctx);
    const list = (Array.isArray(out) ? out : [out]).filter((r) => r && typeof r === "object" && r.tool);
    return list;
  } catch {
    return [unknownResult(name)];
  }
}

async function findContact(agency) {
  if (!agency || agency === "none") return null;
  try {
    const contacts = await loadData("official_contacts.json");
    const e = contacts.find((c) => String(c.agency).toLowerCase() === String(agency).toLowerCase());
    return e ? { agency: e.agency, url: e.url, phone: e.phone } : null;
  } catch {
    return null;
  }
}

const THREATS = [
  [/deport|deportad|निर्वासन|देश से निकाल|驱逐|遣返/i, "I'll be deported"],
  [/arrest|arrestad|warrant|orden de arresto|गिरफ्तार|逮捕/i, "I'll be arrested"]
];

// Asking for money (a fee, any payment) — counted as its own warning sign, even when no method is named.
const FEE_RE = /\bfees?\b|\bpay(ment)?\b|cuota|tarifa|\bpag(o|ar)\b|शुल्क|भुगतान|फीस|费|支付|付款|缴纳/i;

// Number of independent warning signs: distinct failed checks (official-contact lines count separately),
// plus a money demand in the message if no failed check already said so.
function warningSignals(fails, ctx) {
  const keys = new Set(fails.map((r) => (r.tool === "check_official_contact" ? `${r.tool}:${r.detail}` : r.tool)));
  const payArg = ctx.contactArgs.some((a) => !["none", "unknown", ""].includes(String(a.paymentMethod ?? "").toLowerCase()));
  const payFail = fails.some((r) => /pay|gift|crypto|wire|cash/i.test(String(r.detail)));
  if (!payFail && (payArg || FEE_RE.test(ctx.text))) keys.add("money_demand");
  return keys.size;
}

// Turn the model's submit_verdict args into a Verdict (PRD 8.2), enforcing every rule in code.
async function buildVerdict(args, trace, ctx) {
  const modelVerdict = VERDICTS.includes(args.verdict) ? args.verdict : "suspicious";
  let verdict = modelVerdict;
  let confidence = CONFIDENCES.includes(args.confidence) ? args.confidence : "medium";

  // A failed check is a real warning sign: never call that "safe".
  const fails = trace.filter((r) => r.status === "fail");
  if (verdict === "safe" && fails.length) {
    verdict = "suspicious";
    confidence = new Set(fails.map((r) => r.tool)).size >= 2 ? "medium" : "unsure";
  }
  if (verdict === "safe") confidence = "unsure"; // never safe + high (PRD 13.3); keep it humble
  // A scam verdict is never "unsure": high when 2+ independent warning signs, else medium.
  if (verdict === "scam") confidence = warningSignals(fails, ctx) >= 2 ? "high" : "medium";

  let reasons = cleanList(args.reasons, 3);
  if (reasons.length === 0) reasons = cleanList(fails.map((r) => r.detail), 3);
  if (reasons.length === 0 && verdict === "safe") reasons = ["We did not find common scam warning signs"];
  let steps = cleanList(args.steps, 3);
  if (steps.length === 0) {
    steps = verdict === "safe"
      ? ["If unsure, verify through the official channel"]
      : ["Do not pay or share personal details", "Verify through the official channel"];
  }

  const officialContact = await findContact(args.officialAgency);
  const claimed = ctx.contactArgs.map((a) => String(a.claimedAgency ?? "").replace(/[^\p{L}\s.&-]/gu, "").trim()).find(Boolean);
  const payKey = ctx.contactArgs.map((a) => String(a.paymentMethod ?? "").toLowerCase()).find((p) => PAYMENTS[p]);
  const facts = {
    verdict,
    agency: officialContact?.agency || (claimed && claimed.length <= 30 ? claimed : ""),
    payment: payKey ? PAYMENTS[payKey] : "",
    threat: verdict === "safe" ? "" : (THREATS.find(([re]) => re.test(ctx.text)) || [])[1] || ""
  };
  // If we changed the verdict, the model's family message would say the wrong thing.
  const familyMessage = verdict === modelVerdict ? pickFamilyMessage(args.familyMessage, facts) : pickFamilyMessage("", facts);

  return { verdict, confidence, reasons, steps, officialContact, trace, mode: "deep", familyMessage };
}

// Quick Check result, with the same text rules as Deep Check (no links/numbers in reasons/steps;
// the official link is still shown via officialContact, which comes from data/).
async function quickFallback(text) {
  try {
    const v = await runQuickCheck(text);
    const reasons = cleanList(v.reasons, 3);
    const steps = cleanList(v.steps, 3);
    return { ...v, reasons: reasons.length ? reasons : v.reasons, steps: steps.length ? steps : v.steps };
  } catch {
    return {
      verdict: "suspicious",
      confidence: "unsure",
      reasons: ["We could not finish checking this message"],
      steps: ["Do not pay or share personal details", "Verify through the official channel"],
      officialContact: null,
      trace: [],
      mode: "quick",
      familyMessage: "I got a message I'm not sure about. Can you help me check it before I do anything?"
    };
  }
}

// find_red_flags and search_guidance run on every message; every case number and link in the
// message gets checked. If the model skipped any of these, run them here (local, instant) so the
// checklist is complete. Each line is reported as soon as it finishes.
async function runBaselineChecks(trace, ctx, step, state) {
  const ran = new Set(trace.map((r) => r.tool).concat(ctx.ranTools));
  const lang = /[\u0900-\u097F]/.test(ctx.text) ? "hi" : /[\u4e00-\u9fff]/.test(ctx.text) ? "zh" : "en";
  const jobs = [];
  for (const caseNumber of ctx.receipts) {
    if (!ctx.checkedReceipts.has(caseNumber)) jobs.push(runTool("validate_case_number", { caseNumber }, ctx));
  }
  for (const url of ctx.links) {
    if (!ctx.checkedLinks.has(url)) jobs.push(runTool("check_lookalike_domain", { url }, ctx));
  }
  if (!ran.has("find_red_flags")) jobs.push(runTool("find_red_flags", { lang }, ctx));
  if (!ran.has("search_guidance")) {
    const q = ctx.contactArgs
      .flatMap((a) => [a.claimedAgency, PAYMENTS[String(a.paymentMethod ?? "").toLowerCase()]])
      .concat(/tarjeta|gift|regalo|礼品卡|गिफ्ट/i.test(ctx.text) ? ["gift card"] : [])
      .filter(Boolean)
      .concat("payment")
      .join(" ");
    jobs.push(runTool("search_guidance", { query: q }, ctx));
  }
  await Promise.all(
    jobs.map((job) =>
      job.then((list) => {
        for (const r of list) {
          if (state.done || !shown(r)) continue;
          trace.push(r);
          step(r);
        }
      })
    )
  );
}

// The model answered but didn't finish in time (slow call, or never called submit_verdict).
// The checks that ran are real: finish the remaining local checks and build the verdict from
// the trace with the same rules, instead of throwing that work away.
const SEVERITY = { safe: 0, suspicious: 1, scam: 2 };
async function finishLocally(run, onStep) {
  const { trace, ctx } = run;
  const state = { done: false };
  await runBaselineChecks(trace, ctx, (r) => {
    try {
      onStep(r);
    } catch {}
  }, state);
  const quick = await quickFallback(ctx.text);
  const failTools = new Set(trace.filter((r) => r.status === "fail" && r.tool !== "search_guidance").map((r) => r.tool));
  const fromTrace = failTools.size >= 2 ? "scam" : failTools.size === 1 ? "suspicious" : "safe";
  const verdict = SEVERITY[quick.verdict] > SEVERITY[fromTrace] ? quick.verdict : fromTrace;
  const agency = ctx.contactArgs.map((a) => a.claimedAgency).find(Boolean) || quick.officialContact?.agency || "none";
  return buildVerdict({ verdict, confidence: "medium", reasons: [], steps: [], officialAgency: agency, familyMessage: "" }, trace, ctx);
}

// ---------- screenshot ----------

// Browser only: shrink to ≤1280px on the longest side, JPEG 0.85 (smaller upload, faster model).
// In Node (tests) there is no canvas, so the image is sent as is.
async function downscale(dataUrl) {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return dataUrl;
  try {
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const scale = Math.min(1, CONFIG.imageMaxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff"; // JPEG has no transparency
    g.fillRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: CONFIG.imageQuality });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return "data:image/jpeg;base64," + btoa(bin);
  } catch {
    return dataUrl;
  }
}

// Sends the image (NOT masked — it's pixels; the popup says screenshots are sent as images, PRD 13.5)
// to the vision model and returns the text it reads. Never throws: "" if it failed.
async function readScreenshot(imageDataUrl, deadline) {
  if (!/^data:image\/[a-z+.-]+;base64,/i.test(String(imageDataUrl))) return "";
  try {
    const url = await downscale(imageDataUrl);
    const left = Math.min(CONFIG.visionTimeoutMs, remainingMs(deadline) - 3000);
    if (left < 1000) return "";
    const res = await fetch(CONFIG.serverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CONFIG.visionModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: VISION_PROMPT },
              { type: "image_url", image_url: { url } }
            ]
          }
        ],
        max_tokens: CONFIG.visionMaxTokens,
        temperature: 0,
        chat_template_kwargs: { enable_thinking: false }
      }),
      signal: AbortSignal.timeout(left)
    });
    if (!res.ok) return "";
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    const text = (Array.isArray(content) ? content.map((c) => c?.text ?? "").join("\n") : String(content ?? ""))
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/^```\w*\n?|```$/g, "")
      .trim();
    return text;
  } catch {
    return "";
  }
}

// ---------- main ----------

// The last successful deep run as a recording (see demoReplay.js). Used by the Node harness.
let lastRecording = null;
export const getLastRun = () => lastRecording;

export async function runDeepCheck({ text = "", imageDataUrl = null } = {}, onStep = () => {}) {
  text = String(text ?? "").slice(0, CONFIG.maxInputChars);
  const t0 = Date.now();
  const timed = []; // [{ t, result }] — what the user saw, when
  const emit = (r) => {
    timed.push({ t: Date.now() - t0, result: r });
    try {
      onStep(r);
    } catch {}
  };
  try {
    // Stage safety net: replay a recorded run instead of calling the network.
    if (await flagOn(FLAG_REPLAY)) {
      const replay = await replayDemo(onStep);
      if (replay) return replay;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) return await quickFallback(text);
    const deadline = t0 + CONFIG.totalTimeoutMs;
    const pre = []; // steps before the agent loop (Read screenshot)

    if (imageDataUrl) {
      const read = await readScreenshot(imageDataUrl, deadline);
      const r = read
        ? { tool: "read_screenshot", status: "pass", label: "Read screenshot", detail: "Text read from the image" }
        : { tool: "read_screenshot", status: "unknown", label: "Read screenshot", detail: "Could not read text from the image" };
      pre.push(r);
      emit(r);
      // Screenshot text first, then anything typed. Masked like typed text before the agent loop.
      text = [read, text].filter((t) => t.trim()).join("\n\n").slice(0, CONFIG.maxInputChars);
    }

    if (!text.trim()) return await quickFallback("");
    const verdict = await deepWithTimeout(text, emit, deadline, pre);
    if (verdict.mode === "deep") {
      lastRecording = makeRecording(
        { kind: imageDataUrl ? "screenshot" : "text", preview: mask(text).masked },
        timed,
        verdict,
        Date.now() - t0
      );
      if (await flagOn(FLAG_RECORD)) await saveRecording(lastRecording);
    }
    return verdict;
  } catch {
    return quickFallback(text);
  }
}

async function deepWithTimeout(text, onStep, deadline, pre = []) {
  const state = { done: false };
  const run = { trace: [...pre], ctx: null, modelOk: false };
  let timer;
  // Leave ~400ms after the race to finish locally and still be inside the 15s budget.
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, remainingMs(deadline) - 400));
  });
  try {
    const result = await Promise.race([deepLoop(text, onStep, deadline, state, run).catch(() => null), timeout]);
    state.done = true;
    if (result) return result;
    if (run.modelOk && run.ctx) return await finishLocally(run, onStep);
    return await quickFallback(text);
  } finally {
    state.done = true;
    clearTimeout(timer);
  }
}

async function deepLoop(text, onStep, deadline, state, run) {
  const { masked, map } = mask(text); // map stays here — never sent
  const { receipts, links } = messageFacts(text, masked, map);
  const tools = await getToolSchemas({ hasCaseNumber: receipts.length > 0, hasLink: links.length > 0 });
  // ctx stays local. contactArgs = unmasked check_official_contact args seen so far.
  const ctx = { text, receipts, links, contactArgs: [], checkedReceipts: new Set(), checkedLinks: new Set(), ranTools: [] };
  run.ctx = ctx;
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage(masked) }
  ];
  const trace = run.trace;
  const seen = new Map(); // "name|args" → ToolResult, to skip exact duplicate calls
  let nudgedText = false;
  let nudgedEarly = false;

  const step = (r) => {
    if (state.done) return; // timed out: the result is being finished elsewhere
    try {
      onStep(r);
    } catch {}
  };

  for (let turn = 0; turn <= CONFIG.maxTurns; turn++) {
    const lastChance = turn === CONFIG.maxTurns;
    if (lastChance) messages.push({ role: "user", content: NUDGE_VERDICT });

    if (state.done) return null;
    const msg = await callModel(messages, tools, deadline, turn === 0 ? CONFIG.thinkFirstTurn : CONFIG.thinkLaterTurns);
    run.modelOk = true;
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];

    if (calls.length === 0) {
      if (lastChance || nudgedText) {
        if (lastChance) return null;
        messages.push({ role: "user", content: NUDGE_VERDICT });
        continue;
      }
      nudgedText = true;
      const content = String(msg.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      messages.push({ role: "assistant", content: remask(content, map) || "(no answer)" });
      messages.push({ role: "user", content: NUDGE_TOOLS });
      continue;
    }

    const verdictCall = calls.find((c) => c?.function?.name === "submit_verdict");
    const toolCalls = calls.filter((c) => c !== verdictCall);

    // Model tried to finish without checking anything: make it check first (once).
    if (verdictCall && trace.length === 0 && toolCalls.length === 0 && !nudgedEarly && !lastChance) {
      nudgedEarly = true;
      messages.push({ role: "assistant", content: "", tool_calls: [verdictCall] });
      messages.push({
        role: "tool",
        tool_call_id: verdictCall.id,
        content: "Not accepted yet. Run the relevant checks first, then call submit_verdict."
      });
      continue;
    }

    // Run this turn's tool calls in parallel; each reports to onStep as soon as it finishes.
    const results = await Promise.all(
      toolCalls.map(async (c, i) => {
        if (!c.id) c.id = `call_${turn}_${i}`;
        const name = String(c?.function?.name ?? "");
        const args = unmaskArgs(parseArgs(c?.function?.arguments), map);
        const key = name + "|" + JSON.stringify(args);
        if (seen.has(key)) return { c, list: await seen.get(key), dup: true };
        const pending = runTool(name, args, ctx);
        seen.set(key, pending); // set before awaiting so same-turn duplicates are skipped too
        const list = await pending;
        if (list.length) ctx.ranTools.push(name);
        for (const r of list) {
          if (state.done || !shown(r)) continue;
          trace.push(r);
          step(r);
        }
        return { c, list, dup: false };
      })
    );
    if (state.done) return null;

    if (verdictCall) {
      await runBaselineChecks(trace, ctx, step, state);
      return buildVerdict(parseArgs(verdictCall.function?.arguments), trace, ctx);
    }

    // Send results back (masked). Tool-call args we echo are the model's own (masked) args.
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.function?.name, arguments: remask(JSON.stringify(parseArgs(c.function?.arguments)), map) }
      }))
    });
    for (const { c, list, dup } of results) {
      const m = toolMessage(c.id, list, map);
      if (dup) m.content = "Already checked (same result): " + m.content;
      messages.push(m);
    }
    if (remainingMs(deadline) < 2500 && !lastChance) {
      messages.push({ role: "user", content: NUDGE_VERDICT });
    }
  }
  return null;
}
