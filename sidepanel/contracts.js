// sidepanel/contracts.js — Role 1 (UI).
// One place for the functions other roles own that the side panel calls.
// Until their real code lands on main, each one falls back to a mock with the same name and shape.
//   scamLevel(verdict)  → "highly_likely" | "likely" | "unsure" | "unlikely"   (Role 2, core/level.js)
//   startVoice, speakFallback, VOICE_LANGUAGES                                  (Role 3, agent/voice.js)
// When the real file lands, nothing else in sidepanel/ needs to change.

import * as voiceMock from "./voice-mock.js";

export const LEVELS = ["unlikely", "unsure", "likely", "highly_likely"]; // left → right on the meter

// Mock: same rules as Role 2's core/level.js. Never says "safe".
function mockScamLevel(v) {
  const word = String(v?.verdict ?? "").toLowerCase();
  const conf = String(v?.confidence ?? "").toLowerCase();
  if (word === "scam") return conf === "high" ? "highly_likely" : conf === "medium" ? "likely" : "unsure";
  if (word === "safe") return "unlikely";
  return "unsure";
}

// Loaded once at start (dynamic, so the panel still works before core/level.js is on main).
let realScamLevel = null;
export const ready = import("../core/level.js")
  .then((m) => { if (typeof m.scamLevel === "function") realScamLevel = m.scamLevel; })
  .catch(() => {});

export function scamLevel(verdict) {
  try {
    const level = realScamLevel?.(verdict);
    if (LEVELS.includes(level)) return level;
  } catch {}
  return mockScamLevel(verdict);
}

// Voice: the real agent/voice.js if it's there, otherwise the mock.
let voicePromise = null;
export function loadVoice() {
  voicePromise ??= import("../agent/voice.js")
    .then((m) => (typeof m.startVoice === "function" ? m : voiceMock))
    .catch(() => voiceMock);
  return voicePromise;
}
