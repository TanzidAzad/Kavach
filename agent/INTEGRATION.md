# Deep Check: how the popup uses it (for Role 1)

A working example is in `agent/test/integration.js` (between the `=====` lines) with a mock popup,
`agent/test/integration.html`. It was tested in Chrome on 2026-11-08 with text, a screenshot, the server off,
and replay on/off.

## 1. Import and call
```js
import { runDeepCheck } from "../agent/agent.js";

const verdict = await runDeepCheck({ text, imageDataUrl }, onStep);
```
- `text`: what the user pasted (can be `""` if there is a screenshot).
- `imageDataUrl`: the screenshot from `FileReader.readAsDataURL(file)`, or `null`. Don't shrink it yourself; the agent does that.
- Don't call it with no text and no image.
- It **never throws** and always finishes in under 15 seconds.
- `verdict` has the usual shape: `verdict`, `confidence`, `reasons`, `steps`, `officialContact`, `familyMessage`, `trace`, `mode`.

## 2. `onStep`: the live checklist
Each finished check calls `onStep(step)`. A step looks like:
```js
{ tool: "check_official_contact", status: "fail", label: "Sender channel", detail: "USCIS does not contact people on WhatsApp" }
```
- `status` is `"pass"` (✓), `"fail"` (✗) or `"unknown"` (?).
- With a screenshot, the **first** step is `label: "Read screenshot"`.
- **Several steps can arrive at the same moment** (checks run in parallel). Show them one by one, **about 300 ms apart**, fading each in. The example does this with a small queue.
- If you translate inside `onStep`, do it inside the queue (as in the example), or the lines can come out of order.
- Keep the checklist visible after the verdict arrives. Right now popup.js hides it, so people never see the agent's work.

## 3. When Deep Check couldn't reach the server
If `verdict.mode === "quick"`, the server was unreachable and you got a Quick Check result instead. Show
**"Deep check needs internet"**. In this case `onStep` was not called, so show `verdict.trace` as the checklist.

## 4. Screenshot note
When a screenshot is attached, show a short line: **"Screenshots are sent as images so we can read the text."**
(PRD 13.5: typed text is masked before it leaves the device, but an image can't be.)

## 5. manifest.json, add these
```json
"host_permissions": ["http://localhost:8787/*"],
"permissions": ["storage"]
```

## 6. Demo replay (stage safety net)
Plays a recorded real run of the Spanish screenshot, without using the network. Right-click the popup → Inspect → Console:
```js
localStorage.kavach_demo_replay = "true"      // ON
localStorage.removeItem("kavach_demo_replay") // OFF
```
Keep it OFF normally. While it's ON, every Deep Check shows the Spanish screenshot run, whatever is pasted.

## 7. Copy-paste example
```js
import { runDeepCheck } from "../agent/agent.js";
const $ = (id) => document.getElementById(id);

// Steps can arrive several at once. Show them one by one, ~300 ms apart, in arrival order.
function makeStepShower(listEl) {
  let chain = Promise.resolve();
  const show = (step) => {
    chain = chain.then(async () => {
      const li = document.createElement("li");
      li.className = "step " + step.status; // "pass" | "fail" | "unknown"
      const mark = step.status === "fail" ? "✗" : step.status === "pass" ? "✓" : "?";
      li.textContent = `${mark} ${step.label} — ${step.detail}`; // translate here if you need to
      listEl.append(li);
      requestAnimationFrame(() => li.classList.add("shown"));
      await new Promise((r) => setTimeout(r, 300));
    });
  };
  show.done = () => chain; // resolves when every step is on screen
  return show;
}

async function deepCheck(text, imageDataUrl) {
  $("checklist").replaceChildren();
  $("image-note").hidden = !imageDataUrl; // "Screenshots are sent as images so we can read the text."
  const showStep = makeStepShower($("checklist"));
  const verdict = await runDeepCheck({ text, imageDataUrl }, showStep); // never throws
  await showStep.done(); // let the last steps fade in before showing the verdict
  if (verdict.mode === "quick") $("status").textContent = "Deep check needs internet";
  return verdict; // then show verdict.verdict, .reasons, .steps, .officialContact, .familyMessage
}
```
CSS:
```css
.step { opacity: 0; transition: opacity .3s; }
.step.shown { opacity: 1; }
```

## Try it yourself
Start the server (`cd server && npm start`). Reload the extension, then open
`chrome-extension://<ID>/agent/test/integration.html`. Paste a message or pick `agent/test/es-uscis-whatsapp.png`,
then click **Deep Check**.

---

# Voice: "Talk to Kavach" (side panel) — for Role 1

Gemini Live is the **voice**; the Kavach verdict is the **brain**. The voice only knows the verdict, the language,
and the masked message. It never invents phone numbers or links; the only ones it may say come from
`data/official_contacts.json`. The server holds the Gemini key (`POST /api/voice/token`); the extension never sees it.

```js
import { startVoice, updateVerdict, speakFallback, stopFallback, fallbackText, VOICE_LANGUAGES } from "../agent/voice.js";
```
| export | what it does |
|---|---|
| `startVoice({ verdict, lang, text }, { onState, onTranscript, onError, onMic })` | Starts talking. Returns `session` right away; `session.stop()` ends it. `verdict` = Verdict or `null` (talk mode). `lang` = popup language code (`"en"`, `"es"`, `"hi"`, `"zh"`, …). `text` = the message (masked again inside). |
| `onState(s)` | `"connecting"` → `"speaking"` ⇄ `"listening"` → `"ended"` (after stop) or `"error"`. |
| `onTranscript({ role, text, final })` | `role` = `"kavach"` or `"user"`. `text` is the **whole line so far**: replace the last line of that role until `final: true`, then start a new line. |
| `onError(err)` | Couldn't connect within 5 s, server down, no internet, connection lost. `onState("error")` fires too. → use `speakFallback`. |
| `onMic(note)` | Optional. `"asking for microphone in a new tab"`, `"microphone on"`, `"microphone not allowed"`, `"no microphone found"`. Voice keeps talking even without a mic. |
| `updateVerdict(session, verdict)` | Talk mode: call it when Deep Check finishes. Voice then explains the result. Returns `true` if sent. |
| `speakFallback(text, lang)` | Offline browser voice (Chrome speechSynthesis). `text` must already be in that language. Resolves `true` when done, `false` if there is no voice for that language (then just show the text). `stopFallback()` stops it. |
| `fallbackText(verdict)` | Short **English** script for the fallback ("Take a breath. You have time. This message is a scam. …"). Translate it first (same as reasons). |
| `VOICE_LANGUAGES` | `[{ code, name, native, tts }]`, e.g. `{ code: "es", name: "Spanish", native: "Español", tts: "es-US" }`. All 4 popup languages are in it. |

**Rules:** call `startVoice` directly inside the click handler (Chrome only lets audio play after a click).
Only one session at a time: `stop()` the old one first. Show a Stop button while a session runs.

## Copy-paste: Talk button after a check, with fallback
```js
let voice = null;

$("talk").onclick = () => {
  if (voice) { voice.stop(); voice = null; return; }        // the same button is Stop while talking
  stopFallback();
  const lang = currentLang;                                   // "en" | "es" | "hi" | "zh"
  voice = startVoice({ verdict: lastVerdict, lang, text: $("message").value }, {
    onState: (s) => {
      $("talk").textContent = s === "speaking" || s === "listening" || s === "connecting" ? "Stop" : "Talk to Kavach";
      $("voice-state").textContent = { connecting: "Connecting…", speaking: "Kavach is speaking", listening: "Listening…" }[s] || "";
      if (s === "ended" || s === "error") voice = null;
    },
    onTranscript: ({ role, text, final }) => showLine(role, text, final),
    onError: async () => {                                    // no internet / server down → browser voice
      const english = await fallbackText(lastVerdict);
      const spoken = lang === "en" ? english : await translate(english, lang); // your existing translate()
      const ok = await speakFallback(spoken, lang);
      if (!ok) $("voice-state").textContent = spoken;         // no system voice for that language → show text
    },
  });
};

// One transcript line per turn: replace while it grows, new line after final.
const current = {};
function showLine(role, text, final) {
  if (!current[role]) { current[role] = document.createElement("p"); current[role].className = role; $("transcript").append(current[role]); }
  current[role].textContent = text;
  if (final) current[role] = null;
}
```

## Copy-paste: talk mode ("Talk to Kavach" before any check)
```js
$("talk-first").onclick = async () => {
  const text = $("message").value;
  voice = startVoice({ verdict: null, lang: currentLang, text }, callbacks);  // says "Take a breath… let me check, one moment"
  const verdict = await runDeepCheck({ text }, showStep);                    // never throws
  lastVerdict = verdict;
  showVerdict(verdict);
  if (voice) updateVerdict(voice, verdict);                                   // voice now explains the real result
};
```
The voice never says scam/safe before `updateVerdict` (tested in Spanish).

## Microphone
The side panel can't show Chrome's mic prompt. The first time, `startVoice` opens `agent/mic-permission.html` in a
tab ("Allow microphone"). After Allow, the tab closes and the voice gets the mic by itself, with no second click.
Kavach keeps talking meanwhile. Permission is remembered for the extension. Nothing is needed in manifest.json.

## Try it yourself
Server running with `GEMINI_API_KEY` in `server/.env`. Reload the extension and open
`chrome-extension://<ID>/agent/test/voice.html`. Pick a language → **Start**. Tick "Talk mode" to test the
pending flow, or "Simulate server down" to hear the fallback.
