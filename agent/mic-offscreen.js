// agent/mic-offscreen.js — Role 3. Runs in a hidden offscreen document (agent/mic-offscreen.html, reason USER_MEDIA).
// Why: the floating panel is an iframe on the web page, and Chrome gives an iframe the PAGE's microphone permission
// (and sites like WhatsApp Web / Facebook block the mic for every iframe). This page belongs to the extension, so it
// uses Kavach's own permission (asked once on agent/mic-permission.html) and the website never gets the microphone.
// Protocol (chrome.runtime port "kavach-mic"): offscreen → panel { type: "on" } | { type: "need-permission" }
//   | { type: "error", name } | { type: "pcm", data: <base64 PCM16 LE 16 kHz, 100 ms> }; panel → offscreen
//   { type: "start" } (again after the user allowed the mic). Port closed → mic off.
const RATE = 16000, CHUNK = RATE / 10;

function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

let ports = 0; // last talk gone (also when the floating panel was closed mid-talk) → close this page
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "kavach-mic") return;
  ports++;
  let stream = null, ctx = null, closed = false;
  const post = (m) => { try { port.postMessage(m); } catch {} };
  const stop = () => {
    try { stream && stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { ctx && ctx.close(); } catch {}
    stream = null; ctx = null;
  };
  async function start() {
    if (stream || closed) return;
    let state = "unknown";
    try { state = (await navigator.permissions.query({ name: "microphone" })).state; } catch {}
    if (state !== "granted") return post({ type: "need-permission" }); // an offscreen page can't show a prompt
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (closed) return stop();
      ctx = new AudioContext({ sampleRate: RATE });
      await ctx.audioWorklet.addModule(chrome.runtime.getURL("agent/pcm-worklet.js"));
      const node = new AudioWorkletNode(ctx, "pcm-capture");
      let buf = new Float32Array(CHUNK), n = 0;
      node.port.onmessage = (e) => {
        const f = e.data;
        for (let i = 0; i < f.length; i++) {
          buf[n++] = f[i];
          if (n === CHUNK) {
            const pcm = new Int16Array(CHUNK);
            for (let j = 0; j < CHUNK; j++) { const x = Math.max(-1, Math.min(1, buf[j])); pcm[j] = x < 0 ? x * 0x8000 : x * 0x7fff; }
            post({ type: "pcm", data: b64(new Uint8Array(pcm.buffer)) });
            n = 0;
          }
        }
      };
      ctx.createMediaStreamSource(stream).connect(node);
      post({ type: "on" });
    } catch (e) {
      stop();
      post({ type: "error", name: (e && e.name) || "Error" });
    }
  }
  port.onMessage.addListener((m) => { if (m && m.type === "start") start(); });
  port.onDisconnect.addListener(() => {
    closed = true; stop();
    if (--ports === 0) setTimeout(() => { if (!ports) window.close(); }, 1500);
  });
});
