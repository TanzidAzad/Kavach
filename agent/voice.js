// agent/voice.js — Role 3 (Agent & Backend)
// Voice helper: Gemini Live is the VOICE, the Kavach verdict (Nemotron Deep Check / Quick Check) is the BRAIN.
// Contract (team): startVoice({ verdict, level, lang, text }, { onState, onTranscript, onError }) → session { stop() }
//                  The session is also awaitable: `await startVoice(...)` resolves when the talk ends and REJECTS if
//                  live voice never connected (→ caller uses speakFallback). stopVoice() stops whatever is talking.
//                  updateVerdict(session, verdict) · speakFallback(text, lang) · VOICE_LANGUAGES
//
// - Key never in the extension: POST /api/voice/token returns a single-use Gemini token that is LOCKED to the Live
//   model and to a system instruction built on the server from the verdict + language + masked text only.
// - Only masked text and the cleaned verdict leave the browser (plus the user's voice, to Google — see NOTES).
// - Voice starts talking right away; the microphone joins when allowed. If the side panel can't show the mic
//   prompt, we open agent/mic-permission.html in a tab once, then attach the mic automatically.
// - Any failure (or no answer within 5 s) → onState("error") + onError(err) → caller uses speakFallback().
import { VOICE_LANGUAGES, voiceLanguage, cleanVerdict, maskedText, resultTurn, fallbackText, BEGIN } from "./voicePrompt.js";

export { VOICE_LANGUAGES, fallbackText };

export const VOICE_CONFIG = {
  tokenUrl: "http://localhost:8787/api/voice/token",
  connectTimeoutMs: 5000,       // token + WebSocket + setupComplete
  micPageWaitMs: 120000,        // how long we wait for the user on mic-permission.html
  micPromptWaitMs: 3000,        // a getUserMedia prompt that never shows (side panel) → open the page
  outRate: 24000,               // Gemini Live output: PCM16 24 kHz
  inRate: 16000,                // Gemini Live input: PCM16 16 kHz
};

const MIC_CHANNEL = "kavach-mic";
const hasChrome = () => typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
const extUrl = (p) => (hasChrome() ? chrome.runtime.getURL(p) : new URL("../" + p, import.meta.url).href);

// ---------------- base64 / PCM helpers ----------------
function b64FromBytes(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function bytesFromB64(b64) {
  const s = atob(b64); const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function floatToPcm16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) { const x = Math.max(-1, Math.min(1, f32[i])); out[i] = x < 0 ? x * 0x8000 : x * 0x7fff; }
  return out;
}

// ---------------- microphone ----------------
async function micPermissionState() {
  try { return (await navigator.permissions.query({ name: "microphone" })).state; } catch { return "unknown"; }
}
const MIC_OPTS = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

function waitForMicPage(ms) {
  return new Promise((resolve) => {
    let bc = null;
    const done = (v) => { clearTimeout(t); try { bc && bc.close(); } catch {} resolve(v); };
    const t = setTimeout(() => done(false), ms);
    try { bc = new BroadcastChannel(MIC_CHANNEL); bc.onmessage = (e) => done(!!(e.data && e.data.granted)); }
    catch { /* no BroadcastChannel → only the timeout */ }
  });
}
function openMicPage() {
  const url = extUrl("agent/mic-permission.html");
  if (hasChrome() && chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url, active: true });
  else window.open(url, "_blank");
}

// Returns a MediaStream, or null (no mic / refused). Never throws.
async function getMic(session) {
  const tryGet = () => navigator.mediaDevices.getUserMedia(MIC_OPTS);
  const state = await micPermissionState();
  if (state === "granted") { try { return await tryGet(); } catch (e) { session._micNote("mic error: " + e.name); return null; } }
  if (state !== "denied") {
    // In a normal page the prompt shows. In the side panel / popup it is dismissed at once or never appears.
    try {
      return await Promise.race([tryGet(), new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("no prompt"), { name: "PromptTimeout" })), VOICE_CONFIG.micPromptWaitMs))]);
    } catch (e) {
      if (e.name === "NotFoundError") { session._micNote("no microphone found"); return null; }
    }
  }
  if (session.ended) return null;
  session._micNote("asking for microphone in a new tab");
  openMicPage();
  const granted = await waitForMicPage(VOICE_CONFIG.micPageWaitMs);
  if (session.ended) return null;
  if (!granted && (await micPermissionState()) !== "granted") { session._micNote("microphone not allowed"); return null; }
  try { return await tryGet(); } catch (e) { session._micNote("mic error: " + e.name); return null; }
}

// ---------------- session ----------------
let current = null; // the one live session (stopVoice / starting a new one ends it)

export function stopVoice() {
  try { current && current.stop(); } catch {}
  current = null;
  stopFallback();
}

export function startVoice({ verdict = null, level = null, lang = "en", text = "" } = {}, { onState = () => {}, onTranscript = () => {}, onError = () => {}, onMic = () => {} } = {}) {
  if (verdict && level && typeof verdict === "object") verdict = { ...verdict, level };
  if (current) { try { current.stop(); } catch {} }
  const L = voiceLanguage(lang);
  let settle;
  const done = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  done.catch(() => {}); // no "unhandled rejection" noise when the caller doesn't await
  const session = {
    lang: L.code, state: "connecting", ended: false, ready: false, hasVerdict: !!verdict,
    _pending: [], _official: null,
    stop: () => end("ended"),
    done,
    then: (a, b) => done.then(a, b),
    catch: (b) => done.catch(b),
    finally: (f) => done.finally(f),
    _micNote: (m) => { try { onMic(m); } catch {} },
  };
  current = session;
  let ws = null, micStream = null, inCtx = null, worklet = null, outCtx = null, nextAt = 0;
  const playing = new Set();
  let modelTurnDone = true, outText = "", userText = "", guarded = false, connectTimer = null;

  const setState = (s) => { if (session.state === s) return; session.state = s; try { onState(s); } catch (e) { console.warn("[kavach voice] onState threw", e); } };
  const emit = (role, t, final) => { try { onTranscript({ role, text: t, final }); } catch (e) { console.warn("[kavach voice] onTranscript threw", e); } };

  function cleanup() {
    clearTimeout(connectTimer);
    try { if (ws && ws.readyState <= 1) { if (session.ready) ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); ws.close(1000); } } catch {}
    try { micStream && micStream.getTracks().forEach((t) => t.stop()); } catch {}
    try { worklet && worklet.disconnect(); } catch {}
    for (const s of playing) { try { s.stop(); } catch {} }
    playing.clear();
    try { inCtx && inCtx.close(); } catch {}
    try { outCtx && outCtx.close(); } catch {}
  }
  function end(state, err) {
    if (session.ended) return;
    session.ended = true;
    cleanup();
    if (current === session) current = null;
    const e = err instanceof Error ? err : new Error(String(err || "voice error"));
    if (state === "error") {
      setState("error");
      try { onError(e); } catch {}
    } else setState("ended");
    // Never connected → reject so `await startVoice()` callers fall back. Dropped mid-talk → just finish.
    if (state === "error" && !session.ready) settle.reject(e); else settle.resolve();
  }
  const fail = (err) => end("error", err);

  // Output AudioContext created NOW (inside the user's click) so Chrome lets it play.
  try { outCtx = new AudioContext({ sampleRate: VOICE_CONFIG.outRate }); } catch (e) { queueMicrotask(() => fail(e)); return session; }
  setState("connecting");
  connectTimer = setTimeout(() => fail(new Error("voice did not connect within 5 s")), VOICE_CONFIG.connectTimeoutMs);

  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const sayText = (t) => send({ clientContent: { turns: [{ role: "user", parts: [{ text: t }] }], turnComplete: true } });
  session._send = (t) => { if (session.ready) sayText(t); else session._pending.push(t); };

  function play(b64) {
    if (!outCtx || session.ended) return;
    const bytes = bytesFromB64(b64);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    const buf = outCtx.createBuffer(1, pcm.length, VOICE_CONFIG.outRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = outCtx.createBufferSource();
    src.buffer = buf; src.connect(outCtx.destination);
    const at = Math.max(outCtx.currentTime + 0.05, nextAt);
    src.start(at); nextAt = at + buf.duration;
    playing.add(src);
    src.onended = () => { playing.delete(src); if (!playing.size && modelTurnDone && !session.ended) setState("listening"); };
    setState("speaking");
  }
  function stopPlayback() { for (const s of playing) { try { s.stop(); } catch {} } playing.clear(); nextAt = 0; }

  // Grounding guard on what the voice actually SAID: a phone number / link that isn't the official one → correct it.
  function guardTurn(t) {
    if (guarded || !t) return;
    const off = session._official;
    const offDigits = off && off.phone ? off.phone.replace(/\D/g, "") : "";
    const badPhone = (t.match(/\d[\d\s().-]{5,}\d/g) || []).map((x) => x.replace(/\D/g, "")).some((d) => d.length >= 7 && !offDigits.endsWith(d) && !d.endsWith(offDigits || "x"));
    const badUrl = /(https?:\/\/|www\.)\S+|\b[\w-]+\.(com|org|net|info|xyz|top)\b/i.test(t) && !(off && off.url && t.includes(off.url.replace(/^https?:\/\//, "").split("/")[0]));
    if (!badPhone && !badUrl) return;
    guarded = true;
    console.warn("[kavach voice] guard: voice said a number/link not from Kavach's data → correcting");
    sayText(`CORRECTION: You just said a phone number or website that is not in the Kavach facts. In one short sentence, tell them not to use it. ${off ? `The only official contact is ${off.agency}${off.phone ? ", " + off.phone : ""}.` : "Tell them to contact the agency using details they already trust."}`);
  }

  function onServer(m) {
    if (m.setupComplete) {
      clearTimeout(connectTimer);
      session.ready = true;
      sayText(BEGIN);
      for (const t of session._pending.splice(0)) sayText(t);
      return;
    }
    if (m.goAway) { setTimeout(() => end("ended"), 500); return; }
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.interrupted) { stopPlayback(); modelTurnDone = true; setState("listening"); }
    if (sc.inputTranscription && sc.inputTranscription.text) { userText += sc.inputTranscription.text; emit("user", userText.trim(), false); }
    if (sc.modelTurn && sc.modelTurn.parts) {
      if (userText) { emit("user", userText.trim(), true); userText = ""; }
      modelTurnDone = false;
      for (const p of sc.modelTurn.parts) if (p.inlineData && p.inlineData.data) play(p.inlineData.data);
    }
    if (sc.outputTranscription && sc.outputTranscription.text) { outText += sc.outputTranscription.text; emit("kavach", outText.trim(), false); }
    if (sc.turnComplete) {
      modelTurnDone = true;
      if (outText) { emit("kavach", outText.trim(), true); guardTurn(outText); }
      outText = ""; guarded = false;
      if (!playing.size) setState("listening");
    }
  }

  async function attachMic() {
    const stream = await getMic(session);
    if (!stream) return;
    if (session.ended) { stream.getTracks().forEach((t) => t.stop()); return; }
    micStream = stream;
    try {
      inCtx = new AudioContext({ sampleRate: VOICE_CONFIG.inRate });
      await inCtx.audioWorklet.addModule(extUrl("agent/pcm-worklet.js"));
      const srcNode = inCtx.createMediaStreamSource(stream);
      worklet = new AudioWorkletNode(inCtx, "pcm-capture");
      const CHUNK = VOICE_CONFIG.inRate / 10; // 100 ms
      let buf = new Float32Array(CHUNK), n = 0;
      worklet.port.onmessage = (e) => {
        if (!session.ready || session.ended) return;
        const f = e.data;
        for (let i = 0; i < f.length; i++) {
          buf[n++] = f[i];
          if (n === CHUNK) {
            const pcm = floatToPcm16(buf);
            send({ realtimeInput: { audio: { data: b64FromBytes(new Uint8Array(pcm.buffer)), mimeType: `audio/pcm;rate=${VOICE_CONFIG.inRate}` } } });
            buf = new Float32Array(CHUNK); n = 0;
          }
        }
      };
      srcNode.connect(worklet);
      session._micNote("microphone on");
    } catch (e) {
      console.warn("[kavach voice] mic setup failed", e);
      session._micNote("mic error: " + e.name);
    }
  }

  (async () => {
    try {
      const v = await cleanVerdict(verdict);
      session._official = v && v.officialContact;
      const r = await fetch(VOICE_CONFIG.tokenUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict: v, lang: L.code, text: maskedText(text) }),
        signal: AbortSignal.timeout(VOICE_CONFIG.connectTimeoutMs),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token) throw new Error("voice token: " + (j.error || "HTTP " + r.status));
      if (session.ended) return;
      ws = new WebSocket(j.wsUrl + "?access_token=" + encodeURIComponent(j.token));
      ws.binaryType = "arraybuffer";
      const dec = new TextDecoder();
      ws.onopen = () => ws.send(JSON.stringify({ setup: { model: "models/" + j.model } }));
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(typeof ev.data === "string" ? ev.data : dec.decode(ev.data)); } catch { return; }
        try { onServer(m); } catch (e) { console.warn("[kavach voice] message handling failed", e); }
      };
      ws.onerror = () => { if (!session.ready) fail(new Error("voice connection failed")); };
      ws.onclose = (e) => {
        if (session.ended) return;
        if (!session.ready || (e.code !== 1000 && e.code !== 1001)) fail(new Error(`voice connection closed (${e.code}${e.reason ? ": " + String(e.reason).slice(0, 80) : ""})`));
        else end("ended");
      };
      attachMic(); // in parallel: the voice can start explaining before the mic is ready
    } catch (e) {
      fail(e);
    }
  })();

  return session;
}

// Talk mode: Deep Check finished → hand the facts to the running voice. Returns true if sent/queued.
export async function updateVerdict(session, verdict) {
  if (!session || session.ended || typeof session._send !== "function") return false;
  const v = await cleanVerdict(verdict);
  const turn = await resultTurn(verdict);
  if (!v || !turn || session.ended) return false;
  session._official = v.officialContact;
  session.hasVerdict = true;
  session._send(turn);
  return true;
}

// ---------------- offline fallback: Chrome speechSynthesis ----------------
function loadVoices() {
  const ss = globalThis.speechSynthesis;
  const now = ss.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(ss.getVoices()), 1500);
    ss.addEventListener("voiceschanged", () => { clearTimeout(t); resolve(ss.getVoices()); }, { once: true });
  });
}
export function pickVoice(voices, lang) {
  const L = voiceLanguage(lang);
  const want = L.tts.toLowerCase(), base = L.code === "fil" ? ["fil", "tl"] : [L.code];
  const match = voices.filter((v) => base.some((b) => v.lang.toLowerCase().replace("_", "-").startsWith(b)));
  return match.find((v) => v.lang.toLowerCase().replace("_", "-") === want && v.localService)
    || match.find((v) => v.localService)
    || match.find((v) => v.lang.toLowerCase().replace("_", "-") === want)
    || match[0] || null;
}
// Speaks `text` (already in the user's language) slowly. Resolves true when finished, false if this browser has
// no voice for that language (then show the text instead) or speech isn't available. stopFallback() cancels.
export async function speakFallback(text, lang = "en") {
  const ss = globalThis.speechSynthesis;
  if (!ss || !text) return false;
  const voice = pickVoice(await loadVoices(), lang);
  if (!voice) return false;
  ss.cancel();
  // Chrome cuts long utterances (~15 s), so speak sentence by sentence.
  const parts = String(text).match(/[^.!?。！？।]+[.!?。！？।]*/g) || [String(text)];
  return new Promise((resolve) => {
    let left = parts.length, ok = true, settled = false;
    const finish = (v) => { if (!settled) { settled = true; clearTimeout(guard); resolve(v); } };
    // Some setups never fire onend (no audio device, Chrome bug) → resolve anyway after a generous estimate.
    const guard = setTimeout(() => finish(ok), 4000 + String(text).length * 150);
    for (const p of parts) {
      const u = new SpeechSynthesisUtterance(p.trim());
      u.voice = voice; u.lang = voice.lang; u.rate = 0.9;
      u.onend = () => { if (--left === 0) finish(ok); };
      u.onerror = (e) => { if (e.error !== "interrupted" && e.error !== "canceled") ok = false; if (--left === 0) finish(ok); };
      ss.speak(u);
    }
  });
}
export function stopFallback() { try { globalThis.speechSynthesis.cancel(); } catch {} }
