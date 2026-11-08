// agent/demoReplay.js — Role 3 (Agent & Backend)
// Stage safety net (PRD 9 Role 3 task 6).
//
// RECORD: if storage flag "kavach_record" is true, every successful Deep Check is saved to
//   "kavach_last_run" as { input, steps: [{ t, result }], totalMs, verdict } (t = ms since start).
// REPLAY: if storage flag "kavach_demo_replay" is true, runDeepCheck skips the network and plays
//   agent/demo_run.json with the recorded timing, then returns its verdict (mode "deep").
//
// Storage: chrome.storage.local when available (needs "storage" permission in manifest.json),
// otherwise localStorage (same extension origin, works in the popup and dev.html).
// Only masked / fake data is ever recorded.

export const FLAG_REPLAY = "kavach_demo_replay";
export const FLAG_RECORD = "kavach_record";
export const LAST_RUN_KEY = "kavach_last_run";
const MAX_REPLAY_MS = 14000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

async function storageGet(key) {
  try {
    if (globalThis.chrome?.storage?.local) {
      const o = await chrome.storage.local.get(key);
      if (o && key in o) return o[key];
    }
  } catch {}
  try {
    const v = globalThis.localStorage?.getItem(key);
    if (v != null) return JSON.parse(v);
  } catch {}
  return undefined;
}

async function storageSet(key, value) {
  try {
    if (globalThis.chrome?.storage?.local) return void (await chrome.storage.local.set({ [key]: value }));
  } catch {}
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {}
}

export async function flagOn(name) {
  const v = await storageGet(name);
  return v === true || v === "true";
}

// Build a recording from one run. `steps` = [{ t, result }] in the order the user saw them.
export function makeRecording({ kind, preview }, steps, verdict, totalMs) {
  const { trace, ...rest } = verdict;
  return {
    version: 1,
    recordedAt: new Date().toISOString(),
    input: { kind, preview: String(preview ?? "").slice(0, 200) },
    steps: steps.map(({ t, result }) => ({ t: Math.round(t), result })),
    totalMs: Math.round(totalMs),
    verdict: rest
  };
}

export async function saveRecording(rec) {
  await storageSet(LAST_RUN_KEY, rec);
}

export async function getLastRecording() {
  return (await storageGet(LAST_RUN_KEY)) ?? null;
}

async function loadDemoRun() {
  const urls = [];
  try {
    if (globalThis.chrome?.runtime?.getURL) urls.push(chrome.runtime.getURL("agent/demo_run.json"));
  } catch {}
  urls.push(new URL("./demo_run.json", import.meta.url).href);
  for (const url of urls) {
    try {
      if (url.startsWith("file:")) {
        const { readFile } = await import("node:fs/promises"); // Node tests only
        return JSON.parse(await readFile(new URL(url), "utf8"));
      }
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
  }
  return null;
}

const validRecording = (rec) =>
  rec && Array.isArray(rec.steps) && rec.verdict && ["scam", "suspicious", "safe"].includes(rec.verdict.verdict);

// Plays a recording: onStep(result) at each recorded time, then returns the Verdict.
// Returns null if there is nothing valid to replay (caller then runs a real check).
export async function replayDemo(onStep = () => {}, rec = null) {
  try {
    rec = rec || (await loadDemoRun());
    if (!validRecording(rec)) return null;
    const t0 = Date.now();
    const trace = [];
    for (const { t, result } of rec.steps) {
      if (!result || typeof result !== "object") continue;
      await sleep(Math.min(Number(t) || 0, MAX_REPLAY_MS) - (Date.now() - t0));
      trace.push(result);
      try {
        onStep(result);
      } catch {}
    }
    await sleep(Math.min(Number(rec.totalMs) || 0, MAX_REPLAY_MS) - (Date.now() - t0));
    return { ...rec.verdict, trace, mode: "deep" };
  } catch {
    return null;
  }
}
