// agent/test/integration.js — the copy-paste example from agent/INTEGRATION.md, running in a mock popup.
// Everything between the ===== lines is what Role 1 copies into popup/popup.js (paths there start with "../").
import { runDeepCheck } from "../agent.js";
const $ = (id) => document.getElementById(id);

// ===== copy from here =====
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
      requestAnimationFrame(() => li.classList.add("shown")); // CSS: .step{opacity:0;transition:opacity .3s} .step.shown{opacity:1}
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
  if (verdict.mode === "quick") $("status").textContent = "Deep check needs internet"; // fell back to Quick Check
  return verdict; // → show verdict.verdict, .confidence, .reasons, .steps, .officialContact, .familyMessage
}
// ===== copy to here =====

// --- mock popup wiring (not part of the example) ---
let imageDataUrl = null;
$("file").addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => (imageDataUrl = r.result);
  r.readAsDataURL(f);
});
async function run(text, img) {
  const t0 = Date.now();
  const v = await deepCheck(text, img);
  $("out").textContent = JSON.stringify({ ms: Date.now() - t0, mode: v.mode, verdict: v.verdict, confidence: v.confidence, steps: $("checklist").children.length, status: $("status").textContent, family: v.familyMessage });
  document.title = "DONE";
}
$("go").addEventListener("click", () => run($("text").value.trim(), imageDataUrl));

// Headless test: integration.html?auto=text | ?auto=image | ?auto=offline | ?replay=on|off
const q = new URLSearchParams(location.search);
if (q.get("replay") === "on") localStorage.kavach_demo_replay = "true";
if (q.get("replay") === "off") localStorage.removeItem("kavach_demo_replay");
const ES = "USCIS AVISO OFICIAL: Su caso EAC2490123456 tiene un problema. Debe pagar $500 en tarjetas de regalo hoy o será deportado. Llame al 469-555-0187.";
if (q.get("auto") === "text") run(ES, null);
if (q.get("auto") === "offline") {
  const { CONFIG } = await import("../agent.js");
  CONFIG.serverUrl = "http://localhost:1/api/chat";
  run(ES, null);
}
if (q.get("auto") === "image") {
  const blob = await (await fetch("es-uscis-whatsapp.png")).blob();
  const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  run("", url);
}
