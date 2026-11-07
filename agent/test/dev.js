// agent/test/dev.js — runs Deep Check inside Chrome so you can watch steps appear.
// Open chrome-extension://<extension id>/agent/test/dev.html
import { runDeepCheck } from "../agent.js";
import { runQuickCheck } from "../../core/quickcheck.js";
import { TEST_MESSAGES } from "./messages.js";

const $ = (id) => document.getElementById(id);
const ICON = { fail: "❌", pass: "✅", unknown: "❔" };

for (const m of TEST_MESSAGES) $("sample").add(new Option(`${m.id} (expect ${m.expect})`, m.text));
$("text").value = TEST_MESSAGES[0].text;
$("sample").onchange = () => ($("text").value = $("sample").value);

async function run(kind) {
  $("steps").textContent = "";
  $("out").textContent = "";
  $("status").textContent = "running…";
  const t0 = performance.now();
  const onStep = (r) => {
    const line = document.createElement("div");
    line.textContent = `+${Math.round(performance.now() - t0)}ms ${ICON[r.status] || "•"} ${r.label}: ${r.detail}`;
    $("steps").append(line);
  };
  const text = $("text").value;
  const v = kind === "deep" ? await runDeepCheck({ text }, onStep) : await runQuickCheck(text);
  const ms = Math.round(performance.now() - t0);
  $("status").textContent = `${v.mode} · ${v.verdict}/${v.confidence} · ${v.trace.length} steps · ${ms}ms` +
    (kind === "deep" && v.mode === "quick" ? " (fell back — is the server running?)" : "");
  $("out").textContent = JSON.stringify(v, null, 2);
}

$("deep").onclick = () => run("deep");
$("quick").onclick = () => run("quick");
