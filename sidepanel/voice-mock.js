// sidepanel/voice-mock.js — Role 1 (UI). MOCK of Role 3's agent/voice.js (same exports).
// startVoice always fails here, so the side panel uses speakFallback (the browser's own voice).
// Delete nothing when the real one lands: contracts.js picks agent/voice.js automatically.

export const VOICE_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "hi", name: "हिन्दी" },
  { code: "zh", name: "中文" }
];

export async function startVoice() {
  throw new Error("voice not ready (mock)");
}

const SPEECH_LANG = { en: "en-US", es: "es-US", hi: "hi-IN", zh: "zh-CN" };

// Reads text aloud with the computer's built-in voice. Resolves when done.
export function speakFallback(text, lang = "en") {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === "undefined" || !text) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH_LANG[lang] || lang;
    u.rate = 0.9; // a little slower, easier to follow
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function stopVoice() {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
