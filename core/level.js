// core/level.js — Role 2 (Core Engine)
// scamLevel(verdict) → "highly_likely" | "likely" | "unsure" | "unlikely"
//
// Turns a Verdict (PRD 8.2) into one simple "how likely is this a scam" level:
//   scam + high         → "highly_likely"
//   scam + medium       → "likely"
//   suspicious          → "unsure"
//   safe                → "unlikely"
//   anything unclear    → "unsure"   (missing verdict, scam/unsure, unknown words…)
// Accepts the whole Verdict object, or just the verdict word ("scam").

export const LEVELS = ["highly_likely", "likely", "unsure", "unlikely"];

export function scamLevel(verdict) {
  const v = typeof verdict === "string" ? { verdict } : verdict || {};
  const word = String(v.verdict ?? "").toLowerCase();
  const confidence = String(v.confidence ?? "").toLowerCase();

  if (word === "scam") {
    if (confidence === "high") return "highly_likely";
    if (confidence === "medium") return "likely";
    return "unsure";
  }
  if (word === "safe") return "unlikely";
  return "unsure"; // "suspicious", or anything we don't recognise
}
