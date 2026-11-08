// popup/popup.js — Role 1 (UI)
// SKELETON: wires the popup to the engine stubs (PRD 8.4). Engine results are mock data for now.

import { runQuickCheck } from "../core/quickcheck.js";
import { runDeepCheck } from "../agent/agent.js";
import { translate } from "../core/translate.js";

const $ = (id) => document.getElementById(id);

const VERDICT_LABELS = { scam: "SCAM", suspicious: "SUSPICIOUS", safe: "LOOKS SAFE" };
const CONFIDENCE_LABELS = { high: "High", medium: "Medium", unsure: "Unsure" };

let lastVerdict = null;
let imageDataUrl = null;

const lang = () => $("lang").value;

async function fillList(listEl, items) {
  listEl.replaceChildren();
  for (const item of items.slice(0, 3)) {
    const li = document.createElement("li");
    li.textContent = await translate(item, lang());
    listEl.append(li);
  }
}

async function showVerdict(v) {
  lastVerdict = v;
  $("input-view").hidden = true;
  $("result-view").hidden = false;

  const line = $("verdict-line");
  line.className = `verdict ${v.verdict}`;
  $("verdict-label").textContent = "● " + (await translate(VERDICT_LABELS[v.verdict] || "", lang()));
  $("confidence").textContent =
    (await translate("Confidence", lang())) + ": " + (await translate(CONFIDENCE_LABELS[v.confidence] || "", lang()));

  await fillList($("reasons"), v.reasons);
  await fillList($("steps"), v.steps);
}

function showStatus(message) {
  $("status").textContent = message;
}

$("check").addEventListener("click", async () => {
  const text = $("message").value.trim();
  if (!text && !imageDataUrl) return;
  try {
    if (imageDataUrl) {
      await startDeepCheck(text);
    } else {
      await showVerdict(await runQuickCheck(text));
    }
  } catch {
    showStatus("Something went wrong. Please try again.");
  }
});

async function startDeepCheck(text) {
  $("input-view").hidden = true;
  $("result-view").hidden = false;
  $("reasons-block").hidden = true;
  $("checklist-block").hidden = false;
  $("checklist").replaceChildren();

  const verdict = await runDeepCheck({ text, imageDataUrl }, async (step) => {
    const li = document.createElement("li");
    const mark = document.createElement("span");
    mark.className = `mark ${step.status}`;
    mark.textContent = step.status === "fail" ? "✗" : step.status === "pass" ? "✓" : "…";
    const text = `${await translate(step.label, lang())} — ${await translate(step.detail, lang())}`;
    li.append(mark, text);
    $("checklist").append(li);
  });

  $("checklist-block").hidden = true;
  $("reasons-block").hidden = false;
  await showVerdict(verdict);
}

$("deep-check").addEventListener("click", () => {
  startDeepCheck($("message").value.trim()).catch(() => showStatus("Something went wrong. Please try again."));
});

$("ask-family").addEventListener("click", async () => {
  if (!lastVerdict) return;
  try {
    await navigator.clipboard.writeText(await translate(lastVerdict.familyMessage, lang()));
    showStatus(await translate("Copied ✓", lang()));
    setTimeout(updateOnlineStatus, 2000);
  } catch {
    showStatus("Could not copy.");
  }
});

$("screenshot").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    imageDataUrl = reader.result;
  };
  reader.readAsDataURL(file);
});

function updateOnlineStatus() {
  const online = navigator.onLine;
  $("deep-check").hidden = !online;
  showStatus(online ? "" : "offline ○");
}

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();
