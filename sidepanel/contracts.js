// sidepanel/contracts.js — Role 1 (UI).
// One place for the functions other roles own that the side panel calls.
// Until their real code lands, each one falls back to a mock with the same name and shape.
//   scamLevel(verdict)  → "highly_likely" | "likely" | "unsure" | "unlikely"   (Role 2, core/)
//   startVoice, speakFallback, VOICE_LANGUAGES                                  (Role 3, agent/voice.js)
// When the real file lands, nothing else in sidepanel/ needs to change.

import * as quick from "../core/quickcheck.js";
import * as voiceMock from "./voice-mock.js";

export const LEVELS = ["unlikely", "unsure", "likely", "highly_likely"]; // left → right on the meter

// Mock: same idea as Quick Check's scoring. Never says "safe".
function mockScamLevel(v) {
  if (!v) return "unsure";
  if (v.verdict === "scam") return v.confidence === "high" ? "highly_likely" : "likely";
  if (v.verdict === "suspicious") return v.confidence === "unsure" ? "unsure" : "likely";
  return v.confidence === "unsure" ? "unsure" : "unlikely";
}

export function scamLevel(verdict) {
  try {
    if (typeof quick.scamLevel === "function") {
      const level = quick.scamLevel(verdict);
      if (LEVELS.includes(level)) return level;
    }
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
