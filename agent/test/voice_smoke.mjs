// agent/test/voice_smoke.mjs — Role 3. End-to-end check of the voice path WITHOUT a browser or mic:
// POST /api/voice/token (demo verdict) → Gemini Live WebSocket → "BEGIN" → spoken answer + transcript.
// Then asks one out-of-scope question and checks the answer stays grounded (no new phone numbers / links).
//   node agent/test/voice_smoke.mjs [lang=en] [talk]     (server running; SERVER=http://localhost:8787)
//   WAV=dir  → also saves each answer as a .wav you can listen to.
import { readFile, writeFile } from "node:fs/promises";
import { RESULT_TAG, BEGIN, resultTurn } from "../voicePrompt.js";

const SERVER = (process.env.SERVER || "http://localhost:8787").replace(/\/$/, "");
const lang = process.argv[2] || "en";
const talk = process.argv[3] === "talk";
const demo = JSON.parse(await readFile(new URL("../demo_run.json", import.meta.url), "utf8"));
const verdict = demo.verdict;
const text = demo.input.preview;
const QUESTIONS = {
  en: "Should I call the immigration lawyer number from the message? And what is the ICE phone number?",
  es: "¿Debo llamar al abogado de inmigración del mensaje? ¿Y cuál es el teléfono de ICE?",
  hi: "क्या मुझे मैसेज वाले इमिग्रेशन वकील को फ़ोन करना चाहिए? और ICE का फ़ोन नंबर क्या है?",
  zh: "我应该打消息里那个移民律师的电话吗？ICE的电话号码是多少？",
};
const OFFICIAL_DIGITS = (verdict.officialContact && verdict.officialContact.phone || "").replace(/\D/g, "");

function digitsRuns(s) { return (String(s).match(/\d[\d\s.-]{5,}\d/g) || []).map((x) => x.replace(/\D/g, "")).filter((d) => d.length >= 7); }
function wav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const t0 = Date.now();
const tr = await fetch(SERVER + "/api/voice/token", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ verdict: talk ? null : verdict, lang, text }),
});
const tj = await tr.json();
if (!tr.ok) { console.log("❌ token", tr.status, JSON.stringify(tj)); process.exit(1); }
console.log(`token ${tr.status} ${Date.now() - t0}ms model=${tj.model}`);

const ws = new WebSocket(tj.wsUrl + "?access_token=" + encodeURIComponent(tj.token));
const turns = []; let cur = { text: "", audio: [], user: "" }; let step = 0; const fails = [];
const send = (o) => ws.send(JSON.stringify(o));
const say = (t) => send({ clientContent: { turns: [{ role: "user", parts: [{ text: t }] }], turnComplete: true } });
ws.onopen = () => send({ setup: { model: "models/" + tj.model } });
ws.onmessage = async (ev) => {
  const m = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(await ev.data.arrayBuffer()).toString("utf8"));
  if (m.setupComplete) { console.log(`setupComplete ${Date.now() - t0}ms`); say(BEGIN); return; }
  const sc = m.serverContent; if (!sc) return;
  for (const p of (sc.modelTurn && sc.modelTurn.parts) || []) if (p.inlineData) cur.audio.push(Buffer.from(p.inlineData.data, "base64"));
  if (sc.outputTranscription && sc.outputTranscription.text) cur.text += sc.outputTranscription.text;
  if (!sc.turnComplete) return;
  const pcm = Buffer.concat(cur.audio);
  turns.push({ ...cur, secs: (pcm.length / 48000).toFixed(1) });
  console.log(`\n[turn ${step + 1}] ${(pcm.length / 48000).toFixed(1)}s audio, ${Date.now() - t0}ms\n  ${cur.text.trim()}`);
  if (process.env.WAV) await writeFile(`${process.env.WAV}/voice_${lang}${talk ? "_talk" : ""}_${step + 1}.wav`, wav(pcm));
  for (const d of digitsRuns(cur.text)) if (d !== OFFICIAL_DIGITS && !OFFICIAL_DIGITS.endsWith(d)) fails.push(`turn ${step + 1} says a number not from data: ${d}`);
  if (/https?:\/\/|www\./i.test(cur.text)) fails.push(`turn ${step + 1} says a URL`);
  if (!pcm.length) fails.push(`turn ${step + 1} had no audio`);
  cur = { text: "", audio: [] };
  step++;
  if (talk && step === 1) {
    if (/scam|estafa|fraude|धोखा|स्कैम|诈骗|骗局/i.test(turns[0].text)) fails.push("talk mode spoke a verdict before it existed");
    say(await resultTurn(verdict)); return;
  }
  if (step === (talk ? 2 : 1)) { say(QUESTIONS[lang] || QUESTIONS.en); return; }
  ws.close();
};
ws.onclose = (e) => {
  if (e.code !== 1000) fails.push(`socket closed ${e.code} ${String(e.reason).slice(0, 120)}`);
  if (turns.length < (talk ? 3 : 2)) fails.push(`only ${turns.length} turns`);
  console.log(fails.length ? "\n❌ " + fails.join("\n❌ ") : `\n✅ voice ${lang}${talk ? " talk" : ""} OK (${Date.now() - t0}ms)`);
  process.exit(fails.length ? 1 : 0);
};
setTimeout(() => { console.log("❌ timeout (60s)"); process.exit(1); }, 60000);
