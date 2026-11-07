// agent/agent.js — Role 3 (Agent & Backend)
// Contract: PRD 8.4 — runDeepCheck({ text, imageDataUrl }, onStep) → Promise<Verdict>
// onStep(toolResult) is called each time a tool finishes, so the popup can add a checklist line.
//
// Flow: mask(text) → Nemotron tool loop through our server → run tools locally with the
// REAL values (unmasked here, never sent) → submit_verdict → rules enforced in code.
// Any error, timeout, or offline → runQuickCheck(text) (mode "quick"). Never throws.
// TODO (next session): imageDataUrl → vision model → extracted text.

import { mask, unmaskArgs } from "../core/mask.js";
import { loadData } from "../core/data.js";
import { runQuickCheck } from "../core/quickcheck.js";
import { getToolSchemas, TOOL_RUNNERS } from "./toolSchemas.js";
import { SYSTEM_PROMPT, NUDGE_TOOLS, NUDGE_VERDICT, userMessage } from "./prompts.js";

// ---------- config ----------
export const CONFIG = {
  serverUrl: "http://localhost:8787/api/chat",
  agentModel: "agent", // logical name only — the server maps it to a real model ID
  visionModel: "vision",
  maxTurns: 6,
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
function toolMessage(callId, result, map) {
  const content = JSON.stringify({ status: result.status, label: result.label, detail: result.detail });
  return { role: "tool", tool_call_id: callId, content: remask(content, map) };
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|gov|us|info|io|co|app|xyz|top|site|online|me|biz)\b\S*/gi;
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;
const PLACEHOLDER_RE = /\[[A-Z]+_\d+\]/g;

// Replace anything that looks like a link, phone number, or placeholder in model text with
// a plain phrase, so sentences stay readable: "Do not call 214-555-0143" → "Do not call that number".
// The real official contact is shown separately, from data/official_contacts.json.
export function cleanText(s) {
  return String(s ?? "")
    .replace(/\[PHONE_\d+\]/g, "that number")
    .replace(/\b(?:case|receipt)(?:\s+number)?\s+\[RECEIPT_\d+\]/gi, "the case number")
    .replace(/\[RECEIPT_\d+\]/g, "the case number")
    .replace(PLACEHOLDER_RE, "")
    .replace(URL_RE, "the website")
    .replace(PHONE_RE, "that number")
    .replace(/\b(the website|that number)(?:\s*(?:or|and|,|\/)\s*\1)+/gi, "$1")
    .replace(/\b(link|website|site|domain|number)\s+(?:the website|that number)/gi, "$1") // "the link X" → "the link"
    .replace(/\(\s*(?:the website|that number)?\s*\)/gi, "")
    .replace(/\s*\([^)]*$/, "") // a "(" left open (the link ate the ")") → drop the aside
    .replace(/\s+([,.;:!?])(?=\s|$)/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

function cleanList(list, max) {
  if (!Array.isArray(list)) list = typeof list === "string" ? [list] : [];
  return list
    .map(cleanText)
    .map((s) => (/\bignore\b/i.test(s) ? "Do not reply. Verify through the official channel" : s))
    .filter((s) => s.length > 2)
    .slice(0, max);
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

// Turn the model's submit_verdict args into a Verdict (PRD 8.2), enforcing every rule in code.
async function buildVerdict(args, trace) {
  let verdict = VERDICTS.includes(args.verdict) ? args.verdict : "suspicious";
  let confidence = CONFIDENCES.includes(args.confidence) ? args.confidence : "medium";

  const fails = new Set(trace.filter((r) => r.status === "fail" && r.tool !== "search_guidance").map((r) => r.tool));
  // Safety net: the model says safe but two different checks found red flags.
  if (verdict === "safe" && fails.size >= 2) {
    verdict = "suspicious";
    confidence = "medium";
  }
  if (verdict === "safe") confidence = "unsure"; // never safe + high (PRD 13.3); keep it humble

  let reasons = cleanList(args.reasons, 3);
  if (reasons.length === 0) {
    reasons = trace.filter((r) => r.status === "fail").map((r) => r.detail).slice(0, 3);
  }
  let steps = cleanList(args.steps, 3);
  if (steps.length === 0) {
    steps = verdict === "safe"
      ? ["If unsure, verify through the official channel"]
      : ["Do not pay or share personal details", "Verify through the official channel"];
  }
  let familyMessage = cleanText(args.familyMessage);
  if (familyMessage.length < 10) {
    familyMessage = `I got a message and Kavach says it looks ${verdict === "scam" ? "like a scam" : verdict}. Can you help me check it before I do anything?`;
  }

  return {
    verdict,
    confidence,
    reasons,
    steps,
    officialContact: await findContact(args.officialAgency),
    trace,
    mode: "deep",
    familyMessage
  };
}

async function quickFallback(text) {
  try {
    return await runQuickCheck(text);
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

// find_red_flags and search_guidance should run on every message. If the model skipped them,
// run them here (local, instant) so the checklist and trace are complete.
async function runBaselineChecks(trace, ctx, step, state) {
  const ran = new Set(trace.map((r) => r.tool));
  const lang = /[\u0900-\u097F]/.test(ctx.text) ? "hi" : /[\u4e00-\u9fff]/.test(ctx.text) ? "zh" : "en";
  const jobs = [];
  if (!ran.has("find_red_flags")) jobs.push(TOOL_RUNNERS.find_red_flags({ lang }, ctx));
  if (!ran.has("search_guidance")) {
    const q = ctx.contactArgs
      .flatMap((a) => [a.claimedAgency, a.paymentMethod])
      .concat(/tarjeta|gift|regalo|礼品卡|गिफ्ट/i.test(ctx.text) ? ["gift card"] : [])
      .filter(Boolean)
      .concat("payment")
      .join(" ");
    jobs.push(TOOL_RUNNERS.search_guidance({ query: q }, ctx));
  }
  for (const r of await Promise.all(jobs)) {
    if (state.done || !r) continue;
    trace.push(r);
    step(r);
  }
}

// ---------- main ----------

export async function runDeepCheck({ text = "", imageDataUrl = null } = {}, onStep = () => {}) {
  text = String(text ?? "");
  if (typeof navigator !== "undefined" && navigator.onLine === false) return quickFallback(text);
  if (!text.trim()) return quickFallback(text); // image-only path comes next session

  const deadline = Date.now() + CONFIG.totalTimeoutMs;
  const state = { done: false };
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), CONFIG.totalTimeoutMs);
  });
  try {
    const result = await Promise.race([deepLoop(text, onStep, deadline, state), timeout]);
    state.done = true;
    return result || (await quickFallback(text));
  } catch {
    state.done = true;
    return quickFallback(text);
  } finally {
    state.done = true;
    clearTimeout(timer);
  }
}

async function deepLoop(text, onStep, deadline, state) {
  const { masked, map } = mask(text); // map stays here — never sent
  const tools = await getToolSchemas();
  const ctx = { text, contactArgs: [] }; // contactArgs: unmasked check_official_contact args seen so far
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage(masked) }
  ];
  const trace = [];
  const seen = new Map(); // "name|args" → ToolResult, to skip exact duplicate calls
  let nudgedText = false;
  let nudgedEarly = false;

  const step = (r) => {
    if (state.done) return; // timed out: popup already has the quick result
    try {
      onStep(r);
    } catch {}
  };

  for (let turn = 0; turn <= CONFIG.maxTurns; turn++) {
    const lastChance = turn === CONFIG.maxTurns;
    if (lastChance) messages.push({ role: "user", content: NUDGE_VERDICT });

    if (state.done) return null;
    const msg = await callModel(messages, tools, deadline, turn === 0 ? CONFIG.thinkFirstTurn : CONFIG.thinkLaterTurns);
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
        const name = c?.function?.name;
        const args = unmaskArgs(parseArgs(c?.function?.arguments), map);
        if (name === "check_official_contact") ctx.contactArgs.push(args);
        const key = name + "|" + JSON.stringify(args);
        if (seen.has(key)) return { c, result: await seen.get(key), dup: true };
        const pending = (async () => {
          const runner = TOOL_RUNNERS[name];
          try {
            const r = runner ? await runner(args, ctx) : unknownResult(name);
            return r && typeof r === "object" ? r : unknownResult(name);
          } catch {
            return unknownResult(name);
          }
        })();
        seen.set(key, pending); // set before awaiting so same-turn duplicates are skipped too
        const result = await pending;
        if (state.done) return { c, result, dup: false };
        trace.push(result);
        step(result);
        return { c, result, dup: false };
      })
    );
    if (state.done) return null;

    if (verdictCall) {
      await runBaselineChecks(trace, ctx, step, state);
      return buildVerdict(parseArgs(verdictCall.function?.arguments), trace);
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
    for (const { c, result, dup } of results) {
      const m = toolMessage(c.id, result, map);
      if (dup) m.content = "Already checked (same result): " + m.content;
      messages.push(m);
    }
    if (remainingMs(deadline) < 2500 && !lastChance) {
      messages.push({ role: "user", content: NUDGE_VERDICT });
    }
  }
  return null;
}
