// agent/test/voice-test.js — Role 3. Drives agent/voice.js the same way the side panel will.
import { startVoice, updateVerdict, speakFallback, stopFallback, fallbackText, VOICE_LANGUAGES, VOICE_CONFIG } from "../voice.js";

const $ = (id) => document.getElementById(id);
const demo = await (await fetch("../demo_run.json")).json();
const verdict = demo.verdict;
const text = demo.input.preview; // already masked in the recording
$("verdict").textContent = JSON.stringify(verdict, null, 2);
for (const l of VOICE_LANGUAGES) $("lang").append(new Option(`${l.native} — ${l.name}`, l.code));
try { $("lang").value = localStorage.kavach_voice_test_lang || "en"; } catch {}
$("lang").onchange = () => { try { localStorage.kavach_voice_test_lang = $("lang").value; } catch {} };

// Hand-written fallback lines (Role 1 will translate the verdict with Chrome Translator instead).
const FALLBACK = {
  es: "Respire hondo. Tiene tiempo. Este mensaje es una estafa. No pague nada.",
  hi: "एक लंबी सांस लीजिए। आपके पास समय है। यह संदेश एक धोखा है। कोई पैसा न दें।",
  zh: "深呼吸。你有时间。这条消息是诈骗。不要付任何钱。",
};
const fallbackFor = async (lang) => FALLBACK[lang] || (lang === "en" ? await fallbackText(verdict) : null);

let session = null, t0 = 0, firstAudio = 0;
const lines = new Map(); // role+turn → <p>
let turn = { user: 0, kavach: 0 };

function line(role, txt, final) {
  const key = role + turn[role];
  let p = lines.get(key);
  if (!p) { p = document.createElement("p"); p.className = role; $("log").append(p); lines.set(key, p); }
  p.textContent = txt; p.classList.toggle("partial", !final);
  if (final) turn[role]++;
}

async function fallback(lang) {
  const t = await fallbackFor(lang);
  $("meta").textContent = "(fallback voice speaking…)";
  const ok = t ? await speakFallback(t, lang) : false;
  $("meta").textContent = ok ? "(fallback voice spoke)" : `(no ${lang} system voice — show text instead)`;
}

$("start").onclick = () => {
  const lang = $("lang").value, talk = $("talk").checked;
  stopFallback();
  $("log").textContent = ""; lines.clear(); turn = { user: 0, kavach: 0 }; $("mic").textContent = ""; $("meta").textContent = "";
  const server = new URLSearchParams(location.search).get("server") || "http://localhost:8787"; // ?server=http://localhost:8790
  VOICE_CONFIG.tokenUrl = $("breakit").checked ? "http://localhost:1/api/voice/token" : server + "/api/voice/token";
  t0 = performance.now(); firstAudio = 0;
  session = startVoice({ verdict: talk ? null : verdict, lang, text }, {
    onState: (s) => {
      $("state").textContent = s;
      if (s === "speaking" && !firstAudio) { firstAudio = performance.now(); $("meta").textContent = `first audio after ${Math.round(firstAudio - t0)} ms`; }
      if (s === "error" || s === "ended") { $("start").disabled = false; $("stop").disabled = true; }
    },
    onTranscript: ({ role, text, final }) => line(role, text, final),
    onError: (e) => {
      const p = document.createElement("p"); p.className = "err"; p.textContent = "Error: " + e.message + " → fallback voice"; $("log").append(p);
      fallback(lang);
    },
    onMic: (m) => { $("mic").textContent = "Mic: " + m; },
  });
  $("start").disabled = true; $("stop").disabled = false;
  if (talk) setTimeout(async () => { const ok = await updateVerdict(session, verdict); $("mic").textContent += ok ? " · verdict sent" : " · verdict NOT sent"; }, 4000);
};
$("stop").onclick = () => { session && session.stop(); stopFallback(); };
$("fallback").onclick = () => fallback($("lang").value);
