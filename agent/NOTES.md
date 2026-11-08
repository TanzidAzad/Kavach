# Role 3 notes (agent/ + server/) — resume from here

**Demo morning: run `cd server && npm run preflight`** (server running first) — 8 ✅/❌ lines with fixes: Brev health,
native tool calling, hosted key, vision, server, Spanish text + screenshot Deep Check (<15s), demo_run.json. Exits 1 on any ❌.

**Accuracy (agent/EVAL.md, Role 4's 40 messages, Brev):** Deep Check **34/40 (85%) exactly right, 20/20 scams flagged,
0/12 safe called scam** (blind run, before tuning) · Quick Check 24/40, 18/20 · phrase baseline 19/40, 15/20.
After fixes (tuned on the same set): Deep 40/40 ×2 — optimistic, don't put on the slide. Median 2.9 s, p90 ≤5.3 s, 0 fallbacks.

## Done
- 2026-11-08 full test run on merged main (Brev): core tests 4/4 · preflight 8/8 · run_deep.mjs 2 32/32 · eval Deep 39/40
  (miss t-hi-07 unknown link, no agency → safe/unsure) · popup_e2e 9/9 (Hindi reasons now translate as full sentences).
  Fixed: preflight "real number" check now skips verdict.officialContact (the official USCIS phone from data/ is
  expected there); run_deep cache case compares to the recording's step count instead of a hardcoded 6.
- 2026-11-07: translation-friendly reasons/steps/familyMessage — prompt + submit_verdict descriptions require one short, complete, literal sentence (subject + verb), no idioms ("create urgency", "red flag", "too good to be true"), no abbreviations except agency names. demo_run.json re-recorded. `run_deep.mjs 2`: ALL PASSED.
- `server/index.js` — proxy (PRD 8.5): POST /api/chat only, logical models `agent` / `vision`, hosted + brev,
  10 MB body limit, clean JSON errors, `X-Kavach-Backend` response header (`brev` / `hosted` / `hosted fallback`).
  - Brev → hosted per request: unreachable / 12s timeout / 5xx / non-JSON, **plus a watchdog**: while a Brev call
    runs, health is pinged every 0.5s (600ms limit); a failed ping aborts → hosted. Tunnel hang → hosted in 0.5–1.1s
    (measured with a black-hole relay). Log: `(brev unreachable after Nms → hosted)`.
  - Tool-call shim (fallback only), vision always hosted unless `BREV_VL_URL`.
  - `npm run smoke [brev]`, **`npm run preflight`** (`server/scripts/preflight.js`).
- **Deep Check** (`agent/agent.js` → `runDeepCheck({ text, imageDataUrl }, onStep)`):
  - Text: mask → tool loop (max 6 turns, parallel, dedupe) → `submit_verdict` → rules enforced in code.
  - Screenshot: downscale → vision (8s budget, **hedged**: 2nd identical request at 3.5s or at once if the 1st fails)
    → `Read screenshot` step → text + typed text → mask → same loop. Unreadable + no text → suspicious/unsure
    "We could not read the text in the screenshot" (`mode: "quick"`), never "safe".
  - Verdict rules: scam → high (2+ warning signs) or medium, never unsure; failed check + 2+ signs → scam;
    arrest/deportation threat never safe; guidance (advice) never counts as a failed check; safe always unsure.
  - **Cache:** same message (masked text + hash of hidden values + image hash) within 10 min → same verdict, steps
    replayed at once. `CONFIG.cacheMs` (0 = off). Never used while demo replay is on. Memory only.
  - Our own bugs are caught (fallback) but reported: `console.warn("[kavach] …")` + `CONFIG.onError` (harnesses fail on it).
  - Demo replay/record: `agent/demoReplay.js` + `agent/demo_run.json`.
- Tests: `agent/test/run_deep.mjs` (15 cases + cache case + sanitizer; `SERVER=` to point at another server),
  `agent/test/eval_deep.mjs` (Role 4's eval set, read from `origin/data` via git show), `agent/test/sanitize.test.mjs`,
  `agent/test/dev.html`, `agent/test/integration.html` (mock popup = the INTEGRATION.md example, tested headless Chrome).
- Docs: `agent/EVAL.md` (judge-readable accuracy + slide table), `agent/INTEGRATION.md` (for Role 1).

## Next
- Role 1 / 2 / 4 asks below (none block the demo).
- Re-record `agent/demo_run.json` the night before (see Demo replay / record).
- Demo laptop: switch the popup to Español, हिन्दी, 中文 once each the day before (first switch downloads the
  on-device translation model — Hindi took several minutes on a fresh profile; the popup stays English meanwhile).

## Integrated product (merged main, 2026-11-07) — `agent/test/popup_e2e.mjs`
Real popup (`popup/popup.html` with Role 1's code) in Chrome 157, driven over DevTools; screenshots in
`agent/test/integration_shots/` (+ results.json). **9/9 PASS:** Quick Check es-text SCAM/High 0.1s · Deep Check
SCAM/High 2.7s, 5 lines ~300ms apart · Ask family copies the family message · screenshot upload → Deep SCAM/High
5–7s, "Read screenshot" first, image note shown · Hindi + Spanish translate (after the model download) and are saved ·
server unreachable → Quick Check + "Deep check needs internet" · offline → Quick only, no Deep button · no console
errors. Also: core tests 4/4, `run_deep.mjs 2` 32/32, preflight 8/8 (with tunnel), eval unchanged (EVAL.md).
manifest.json has `storage` + `http://localhost:8787/*`; popup imports `runDeepCheck` from `../agent/agent.js` ✓.
**How to run it** (WSL + Windows Chrome; branded Chrome 137+ ignores --load-extension, so we load over CDP):
```bash
# copy the extension to a Windows folder (Chrome can't load from \\wsl paths reliably)
D=/mnt/c/Users/Rafid/AppData/Local/Temp/kavach_ext; rm -rf $D; mkdir -p $D; cp -r manifest.json popup core data agent $D/
"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=9334 --enable-unsafe-extension-debugging \
  --user-data-dir='C:\Users\Rafid\AppData\Local\Temp\kv_prof2' --no-first-run --window-position=-3000,0 about:blank &
cd /mnt/c/Users/Rafid/AppData/Local/Temp && CDP=http://127.0.0.1:9334 EXT='C:\Users\Rafid\AppData\Local\Temp\kavach_ext' \
  WSLENV=CDP:EXT "/mnt/c/Program Files/nodejs/node.exe" '\\wsl.localhost\Ubuntu\home\rafid\hackutd\Kavach\agent\test\popup_e2e.mjs'
```
Headless Chrome works for everything except translation (it never downloads the language models → reported `ENV`).
`LANG_WAIT_MS` (default 60000) = how long to wait for a translation. Server unreachable is simulated with
`Network.setBlockedURLs` (the real server keeps running).

## Latest results (Brev, 2026-11-08) — `SERVER=… node agent/test/run_deep.mjs 2`
32/32 PASS. Text checks 1.5–3.2s; es-screenshot 6.1–8.7s, hi-screenshot 3.4s (hosted vision 1.3–2.7s, spikes seen
up to 30s → hedge); vision-stall (mocked) 7.2–8.2s deep; vision-fails 1ms suspicious; cache 2.2s → 0ms.
zh-lookalike scam/high in every round since the confidence fix (was scam/unsure).
During testing the Brev port-forward really dropped once: watchdog switched to hosted after 1.6s as designed.
If it happens: `ssh -N -o ServerAliveInterval=15 -L 8000:localhost:8000 modest-jade-panda` (or `brev port-forward`).

## Results (hosted, thinking off, 2 rounds, 2026-11-07) — `node agent/test/run_deep.mjs 2`
| case | verdict | steps | ms (round 1 · 2) | mode | result |
|---|---|---|---|---|---|
| sanitizer unit tests (32 checks) | – | – | – | – | PASS |
| es-text (USCIS WhatsApp, receipt + phone) | scam/high ×2 | 5 | 6986 · 3898 | deep | PASS ×2 |
| en-irs (gift cards) | scam/high ×2 | 4 | 2637 · 4467 | deep | PASS ×2 |
| hi-ice (Hindi deportation threat) | scam/high ×2 | 3 | 2548 · 4403 | deep | PASS ×2 |
| zh-lookalike (uscis-gov-help.com) | scam/high, scam/unsure | 3–4 | 3259 · 3473 | deep | PASS ×2 |
| en-safe (biometrics reminder) | safe/unsure ×2 | 1 | 2918 · 8760 | deep | PASS ×2 |
| empty input | safe/unsure (Quick Check) | 4 | 0–3 | quick | PASS ×2 |
| very-long (≈8000 chars, capped to 4000) | scam/high ×2 | 5 | 3918 · 3364 | deep | PASS ×2 |
| server-down | scam/high (Quick Check) | 5 | 1–4 | quick | PASS ×2 |
| never-submits (mocked model) | scam/medium | 3 | 3–6 | deep | PASS ×2 |
| malformed-args (mocked: bad JSON, fake tool, fake case/link) | suspicious/medium | 3 | 2–5 | deep | PASS ×2 |
| es-screenshot | scam/high ×2 | 6 | 5246 · 6802 | deep | PASS ×2 |
| hi-screenshot | scam/high ×2 | 4 | 6324 · 4772 | deep | PASS ×2 |
| replay (demo_run.json) | scam/high | 6 | 7419 · 6383 | deep | PASS ×2 |

Every case also asserts: valid Verdict (PRD 8.2), ≤15s, no throw, no case number/phone in any `/api/chat` body,
familyMessage first person / ≤3 sentences / no placeholders, no links/phones/doubled words in reasons/steps,
never safe+high, safe never has a failed check. Real Chrome (headless, same code as the popup): screenshot sent as
86 KB JPEG, deep scam/high, 6 steps, 6.0s.
Occasional hosted latency spike (one call 6–9s): the run still finishes inside 15s (retry or local finish).

## Results Brev with native tool calling (2026-11-08) — `node agent/test/run_deep.mjs 3`
Container parser on (`qwen3_coder`), shim never used. Smoke 5/5 (tool call 284 ms, thinking off).
39/39 PASS. Verdicts ×3: es-text, en-irs, hi-ice, very-long, es/hi-screenshot scam/high; zh-lookalike scam/unsure;
en-safe safe/unsure; mocked/quick cases unchanged. ms: es-text 2156·1907·1889, en-irs 1648·1652·1693,
hi-ice 1687·1781·1753, zh 3954·2079·1996, en-safe 1731·1696·1820, very-long 2065·2013·2101,
es-screenshot 3603·5957·4229, hi-screenshot 3537·3565·3479. ≈1.0s per agent call — same as with the shim.

## Results Brev (shim) vs hosted (2026-11-07, thinking off) — `node agent/test/run_deep.mjs 3`
Brev = self-hosted NIM, vLLM int4, `nvidia/nemotron-3.5-lightning`, tool calls via proxy shim; vision on hosted.
| case | hosted verdict | Brev verdict (×3) | hosted ms | Brev ms (3 rounds) | Brev result |
|---|---|---|---|---|---|
| es-text | scam/high | scam/high ×3 | 2566–6986 | 2080 · 3845 · 1925 | PASS ×3 |
| en-irs | scam/high | scam/high ×3 | 2637–4467 | 1629 · 1868 · 1692 | PASS ×3 |
| hi-ice | scam/high | scam/high ×3 | 2158–4403 | 1733 · 1678 · 1683 | PASS ×3 |
| zh-lookalike | scam/high·unsure·medium | scam/medium·high·medium | 2736–5764 | 1958 · 1987 · 2093 | PASS ×3 |
| en-safe | safe/unsure | safe/unsure ×3 | 2918–8760 | 1629 · 1611 · 3729 | PASS ×3 |
| very-long | scam/high | scam/high ×3 | 3364–3918 | 1960 · 1949 · 2045 | PASS ×3 |
| es-screenshot | scam/high | scam/high ×3 | 5246–6802 | 6250 · 4382 · 3437 | PASS ×3 |
| hi-screenshot | scam/high | scam/high ×3 | 4772–6324 | 3002 · 3177 · 4306 | PASS ×3 |
| empty / server-down / never-submits / malformed-args / replay | same | same | – | ≤6 ms (replay ~6.3s, scripted) | PASS ×3 |
- **Quality:** int4 gave the same verdict as hosted on every case, every round; reasons and family messages read
  the same (often word-for-word). No int4 drop found. zh-lookalike confidence wobbles on both backends.
  The one wrong reason ("gift cards" on the Chinese fee scam) happened on hosted too → our bug, fixed (see Done).
- **Latency:** Brev ≈1.0s per agent call, very steady (max 995 ms); text Deep Checks 1.6–2.1s vs 2.2–8.8s hosted.
  Screenshots are dominated by hosted vision (~2.4s avg). 2 model calls per run (checks, then submit_verdict).
- **Fallback test** (second server on :8788, fake Brev): A) nothing on the Brev port → hosted, 0.35s;
  B) health OK but chat drops the connection → `(brev unreachable → hosted)` in the same request, 0.35s;
  C) Brev 503 → `(brev 503 → hosted)`, 1.5s. Later requests skip Brev for 30s (health cache), then re-check.

## Brev container (tool calling ON — working command, 2026-11-08)
Run on the Brev machine (`ssh modest-jade-panda '…'`, never `brev shell`). Only touch `kavach-llm`; never delete
`~/.cache/nim`; never print the key.
```bash
docker stop kavach-llm && docker rm kavach-llm
docker run -d --name kavach-llm --restart unless-stopped --gpus all --shm-size=16GB \
  -e NGC_API_KEY="$(cat ~/.ngc_key)" \
  -e NIM_PASSTHROUGH_ARGS="--enable-auto-tool-choice --tool-call-parser qwen3_coder" \
  -v "$HOME/.cache/nim:/opt/nim/.cache" -u $(id -u) -p 8000:8000 \
  nvcr.io/nim/nvidia/nemotron-3.5-lightning-30b-a3b:latest
docker logs kavach-llm 2>&1 | grep "Launching vLLM"     # must contain --enable-auto-tool-choice --tool-call-parser qwen3_coder
curl -s -o /dev/null -w "%{http_code}\n" localhost:8000/v1/health/ready   # 200 when ready (~3 min, weights cached)
```
- **Why passthrough:** `NIM_ENABLE_AUTO_TOOL_CHOICE` / `NIM_TOOL_CALL_PARSER` are NOT read by this image (grep of
  `nim_llm` source: no such names). It reads `NIM_PASSTHROUGH_ARGS` (parsed as CLI args, priority
  CLI > PASSTHROUGH > ENV) and appends them to `vllm serve`. vLLM 0.32.0 in the image has `qwen3_coder`
  (also `qwen3_xml`, `qwen3_json`). The model's raw tool output is the qwen3_coder XML format.
- No reasoning parser is set; we send `enable_thinking:false` (works: no reasoning tokens).
- Known-good fallback (no tool calling; proxy shim covers it): same command without the `NIM_PASSTHROUGH_ARGS` line.

## Models
| Logical | Hosted model ID | Latency |
|---|---|---|
| agent | `nvidia/nemotron-3.5-lightning-30b-a3b` | ~0.3–2s per turn with thinking off |
| vision | `nvidia/nemotron-3.5-super-vl-120b-a12b` | 2–3.5s for a 720×1280 screenshot |
Backups: `nemotron-3-ultra-550b` (agent), `nemotron-3-nano-omni-30b-a3b-reasoning` (vision).

## Quirks
- Nemotron reasons first; reasoning tokens count against `max_tokens` → use ≥1024. We turn thinking off.
- Many listed model IDs 404 on hosted — always smoke test.
- The vision model reads everything on screen (clock, battery, "+1 (469) 555-0187" header) — fine, it's masked.

## Decisions
- **Thinking off** (`chat_template_kwargs.enable_thinking: false`). `THINK=first,later` in the harness to compare.
- Per-call timeout 6s + one retry if ≥3s left; 15s total. If the model answered once but didn't finish,
  `finishLocally` runs the missing local checks and builds the verdict from the trace (verdict = worse of
  trace-based and Quick Check's). Only "server unreachable" goes to Quick Check.
- **Relevant checks only:** `validate_case_number` is offered only if mask() found a `[RECEIPT_n]`, and only runs on
  those values; `check_lookalike_domain` only if the masked text has a link, and only on links really in the message.
  Results that just say "doesn't apply" (no case number / no link / no agency / can't tell channel / no guidance)
  go back to the model but are NOT shown. Unknown tool names are skipped silently.
- If the model skips a check that applies (case number, link, red flags, guidance), it runs locally before returning.
- `check_official_contact` args are enums (`CHANNELS`, `PAYMENTS` in toolSchemas.js) mapped to core's words.
  `unknown` channel → no channel check. Channel + payment → two lines ("Sender channel", "Payment method").
- **Scam is never "unsure"** (2026-11-08): `warningSignals()` counts distinct failed checks (each official-contact
  line separately) + a money/fee demand in the message (`FEE_RE`, en/es/hi/zh, or a paymentMethod arg) → scam is
  `high` with ≥2, else `medium`. Prompt + schema say the same. zh-lookalike (link + 处理费) now scam/high on Brev;
  `run_deep.mjs 3` 39/39 PASS, harness asserts no scam+unsure.
- Safe + any failed check → `suspicious` (medium if ≥2 tools failed, else unsure). Safe → always `unsure`.
- familyMessage: model's text only if first person, ≤3 sentences, no link/phone/case number/placeholder, and the
  verdict wasn't changed by our rules; otherwise `familyTemplate()` (verdict + agency + payment + threat).
- Quick Check fallback's reasons/steps also go through the sanitizer (its "check at https://www.irs.gov/" step
  becomes "the official website"; the real link still shows via `officialContact`).
- Screenshot: image goes to the vision model unmasked (it's pixels — PRD 13.5, popup must say so); the extracted
  text is masked before the agent loop. Vision fails + typed text → continue with text; both empty → Quick Check("").
- Checklist pacing: `onStep` fires once per shown check, as it finishes, in finish order. No fake delays (Role 1 fades in).
- `agent/package.json` = `{"type":"module"}` so Node loads agent/ as ES modules.
- Server: logical model names only, `stream: false` forced, Brev health cached 30s, falls back to hosted.
- **Brev routing:** each request gets a list [Brev if `NIM_BACKEND=brev` and healthy, hosted if key]. Brev network
  error / 12s timeout / 5xx / non-JSON → mark Brev down 30s and retry hosted in the same request. 4xx is passed through.
  Vision: Brev only if `BREV_VL_URL` is set (there is no VL NIM on Brev now) — otherwise straight to hosted.
- **Tool shim (fallback only):** normal path is the container's own parser. If Brev answers 400 "tool-call-parser",
  the proxy logs `TOOL SHIM FALLBACK ON`, uses the shim for 5 min (then tries real tool calling again), resends with
  `tool_choice:"none"` (vLLM still puts the tools in the prompt) and converts `<tool_call>` XML in `content` into
  OpenAI `tool_calls` (array/number args JSON-parsed using the request's tool schema). Log lines say
  `(tool shim fallback)`. Tested against a fake parserless server (2026-11-08).
- `other_fee` payment choice maps to "" (no payment-method line) — for fees with no method named.
- Output text is machine-translated (Chrome Translator) → reasons/steps/familyMessage must be literal full sentences, no idioms. Good: "The message threatens you with deportation." / "Real agencies do not rush you to pay the same day."

## How to run the server
```bash
cd server
npm install
cp .env.example .env        # then put your key in .env (never commit it)
npm start                   # http://localhost:8787 — one log line per request
npm run smoke               # optional: checks the models still work (hosted)
```
Health check: `curl -s localhost:8787/api/chat -H 'Content-Type: application/json' -d '{"model":"agent","max_tokens":512,"messages":[{"role":"user","content":"hi"}]}'`
→ JSON with `choices`. (`{}` body → 400 "model must be…" also proves the server is up.)

## How to test Deep Check
**Node** (server running): `node agent/test/run_deep.mjs 2` (table at the end) or one case:
`node agent/test/run_deep.mjs 1 es-screenshot`. Sanitizer only: `node agent/test/sanitize.test.mjs`.
Image cases are skipped with a message if the PNGs are missing.
**Chrome:** server running → `chrome://extensions` → Developer mode → Load unpacked (repo root) or reload →
copy the extension ID → open `chrome-extension://<ID>/agent/test/dev.html`.
- Text: pick a sample → "Run Deep Check". Steps appear one by one; status shows mode/verdict/ms.
- **Screenshot:** "Upload screenshot" → choose `agent/test/es-uscis-whatsapp.png` (or make new ones: open
  `chrome-extension://<ID>/agent/test/make_screenshot.html` → Download). Clear the textarea (or leave text — it's
  combined) → "Run Deep Check". Expect `Read screenshot` first, then ≥4 more lines, SCAM, under 15s.
  "Clear image" removes it.

## Demo replay / record (flags)
Open DevTools on the popup (right-click popup → Inspect) or on dev.html, Console tab:
```js
// REPLAY ON — Deep Check plays agent/demo_run.json, no network (last resort on stage)
localStorage.kavach_demo_replay = "true"
// REPLAY OFF
localStorage.removeItem("kavach_demo_replay")
// RECORD ON — every successful Deep Check is saved; dev.html "Download recording" saves it as JSON
localStorage.kavach_record = "true"
// RECORD OFF
localStorage.removeItem("kavach_record")
```
If manifest.json has the `"storage"` permission you can use chrome.storage instead (checked first):
`chrome.storage.local.set({ kavach_demo_replay: true })` / `chrome.storage.local.remove("kavach_demo_replay")`
(same for `kavach_record`). localStorage is shared by the popup and dev.html (same extension origin).
Note: replay plays the same Spanish-screenshot run whatever you paste — only use it on stage for that demo.
**Re-record from Node:** `RECORD=agent/demo_run.json node agent/test/run_deep.mjs 1 es-screenshot` (writes only if
the case passes and no real value is in the file). From Chrome: record flag on → run → Download recording →
replace `agent/demo_run.json`.

## Recommendation: demo on Brev (with hosted fallback on)
Same verdicts as hosted, 2–4× faster and steadier on text, no shared rate limits, and it shows a self-hosted NIM.
`NVIDIA_API_KEY` must stay in server/.env so vision and the fallback work. If Brev misbehaves during rehearsal,
set `NIM_BACKEND=hosted` and restart — nothing else changes.

## Demo-day checklist (Role 3)
1. **Brev:** `ssh modest-jade-panda 'curl -s -o /dev/null -w "%{http_code}" localhost:8000/v1/health/ready'` → 200
   (`kavach-llm` has `--restart unless-stopped`; else the command in "Brev container").
2. **Tunnel:** `brev port-forward <instance> -p 8000:8000` or `ssh -N -o ServerAliveInterval=15 -L 8000:localhost:8000 modest-jade-panda`.
3. **server/.env:** `NIM_BACKEND=brev`, `BREV_LLM_MODEL=nvidia/nemotron-3.5-lightning`, `NVIDIA_API_KEY` present, no `BREV_VL_URL`.
4. `cd server && npm start` → `brev (agent http://localhost:8000, vision hosted), hosted fallback on`.
5. **`cd server && npm run preflight`** → ✅ ALL GOOD (fix any ❌ with the line it prints).
6. Reload the extension; run the Spanish screenshot once in the popup (warms up). Run it again → instant (cache).
7. Keep `kavach_demo_replay` OFF. Network dies on stage → ON in the popup console, re-run, OFF afterwards.
8. Wi-Fi-off part of the demo = Quick Check (popup), not affected by the server.
Hosted-only plan B: `NIM_BACKEND=hosted` in .env, restart, skip 1–2. Tunnel drops mid-demo → nothing to do (hosted in ~1s).

## How to switch to Brev
1. Start the LLM NIM on Brev and `brev port-forward` it to `localhost:8000`.
2. In `server/.env`: `NIM_BACKEND=brev`, `BREV_LLM_MODEL=nvidia/nemotron-3.5-lightning` (`BREV_LLM_URL` if the port differs).
   Only set `BREV_VL_URL` if a VL NIM is really running on Brev — otherwise vision goes to hosted.
3. `npm run smoke -- brev`, then `npm start`. Log lines show `brev` / `hosted` per request, plus
   `(tool shim)` or `(brev … → hosted)` notes.

## Asks for teammates (current, re-checked 2026-11-08 after pulling main)
- **Role 1 (popup):**
  - After a Deep Check the verdict hides the checklist (`renderVerdict` sets `checklist-block.hidden = true`), so the
    5 live checks — the "agent at work" moment — vanish. Suggest keeping it under the verdict for deep results:
    `$("checklist-block").hidden = v.mode !== "deep" || !$("checklist").children.length;` (heading "Checks").
  - First switch to a language downloads the translation model (Hindi: minutes on a fresh profile); the popup stays
    English with no hint. When `prepareTranslation()` returns `"downloading"`, show e.g. "Downloading Hindi… (first time only)".
  - Machine-translated labels are off: "Why:" → es "porque:", "Call" → hi "बुलावा" (= summons), "← New check" →
    hi "नया चेक" (arrow lost), "Confidence: High" → hi "आत्मविश्वास: ऊंचा" (= self-confidence: tall), es "Confianza: Elevado". Use per-language labels from ui_strings.json first (see Role 4), translate() only as fallback.
  - Optional: `mode: "quick"` results could show `verdict.trace` as the checklist (today: reasons + status line — fine).
- **Role 2 (core):**
  - `core/tools.js:259` says "(and 1 more warning signs)" → say "1 more warning sign" when the count is 1 (singular), "N more warning signs" otherwise.
  - Still open (minor): `runQuickCheck("")` → safe/unsure; `checkLookalikeDomain("myUSCIS")` → fail (no dot).
- **Role 4 (data):**
  - `ui_strings.json`: add `es` / `hi` / `zh` versions of the ~30 labels (verdict words, Why, What to do, Call,
    Website, Ask family, New check, Deep check needs internet…) so the UI doesn't depend on machine translation.
  - Held-out set (10–20 new messages nobody tunes on) for an honest accuracy number.
  - Done ✓: data merged, guidance entries (20), "Hi mom" no longer flagged.
