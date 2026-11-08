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
