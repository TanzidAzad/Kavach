# Role 3 notes (agent/ + server/) — resume from here

## Done
- `server/index.js` — proxy (PRD 8.5): POST /api/chat only, logical models `agent` / `vision`, hosted + brev
  backends, Brev health check with hosted fallback, 30s timeout, 10 MB body limit, clean JSON errors.
  `server/scripts/smoke.js` proves the models work.
- **Brev (2026-11-07):** self-hosted NIM (vLLM, int4) `nvidia/nemotron-3.5-lightning` on `localhost:8000` via port-forward.
  Proxy now: per-request fallback to hosted (Brev unreachable / timeout 12s / 5xx / non-JSON → mark down, retry hosted
  in the same request); **vision always hosted** unless `BREV_VL_URL` is set and healthy; **tool-call shim** when the
  container has no tool parser (see Decisions). Smoke tests `enable_thinking:false` and prints the parser fix.
- Fixed (both backends): Chinese "processing fee" scam was told "USCIS never asks for gift cards". Added `other_fee`
  payment choice + stricter description; `search_guidance` results naming a payment method the message never
  mentions (gift card / crypto / wire, en/es/hi/zh words) are hidden.
- **Deep Check** (`agent/agent.js` → `runDeepCheck({ text, imageDataUrl }, onStep)`), PRD 9 Role 3 tasks 3–6:
  - **Text:** mask → tool loop (max 6 turns, parallel calls, dedupe) → `submit_verdict` → rules enforced in code.
  - **Screenshot:** downscale in the browser (≤1280px, JPEG 0.85) → `vision` model ("transcribe exactly") →
    `Read screenshot` step → extracted text + typed text → mask → same loop. Vision has its own 8s budget.
  - **Quality:** first-person family message (model's if clean, else a template from the verdict + agency);
    `agent/sanitize.js` replaces links/numbers/placeholders with natural phrases; only relevant checks are
    offered/shown; enum args for `check_official_contact`; a failed check means never "safe".
  - **Hardening:** input capped at 4000 chars; model slow / never submits → finish locally from the checks that ran
    (still `deep`); server down / offline → Quick Check (`quick`). Never throws.
  - **Demo replay/record:** `agent/demoReplay.js` + `agent/demo_run.json` (real run of the Spanish screenshot, masked).
- Tests: `agent/test/run_deep.mjs` (13 cases + sanitizer tests, pass/fail table), `agent/test/sanitize.test.mjs`,
  `agent/test/dev.html` (Chrome, with screenshot upload + "Download recording"),
  `agent/test/make_screenshot.html` (draws fake WhatsApp screenshots → `agent/test/*.png`, both committed).

## Next
- Verify in the real extension popup once Role 1 wires the screenshot upload (works in dev.html + headless Chrome).
- Re-record `agent/demo_run.json` the night before the demo (see Record below) so it matches final data.

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

## Demo-day startup order (Brev)
1. **Brev instance** up, `kavach-llm` running (it has `--restart unless-stopped`; if not, use the command in
   "Brev container" above). `ssh modest-jade-panda 'curl -s -o /dev/null -w "%{http_code}" localhost:8000/v1/health/ready'` → 200.
2. **Port-forward:** `brev port-forward <instance> -p 8000:8000` (LLM on localhost:8000). Check:
   `curl -s localhost:8000/v1/models` → shows `nvidia/nemotron-3.5-lightning`.
3. **server/.env:** `NIM_BACKEND=brev`, `BREV_LLM_MODEL=nvidia/nemotron-3.5-lightning`, `NVIDIA_API_KEY` present.
   Don't set `BREV_VL_URL`. Then `cd server && npm run smoke -- brev` → 5/5 PASS (tool call must PASS).
4. **`cd server && npm start`** → `brev (agent http://localhost:8000, vision hosted), hosted fallback on`.
5. **Health check:** curl above → `choices`; log line `agent brev 200`. Then
   `node agent/test/run_deep.mjs 1 es-screenshot` → PASS (log: `agent brev`, `vision hosted`).
6. Continue with the checklist below from step 4.
Hosted-only: `NIM_BACKEND=hosted` in .env, skip 1–2.

## Demo-day checklist for Role 3
1. Backend: see "Demo-day startup order" above (Brev) or set `NIM_BACKEND=hosted`.
2. `cd server && npm start` — log line says which backend.
3. Health check (curl above) → `choices` JSON. Then `node agent/test/run_deep.mjs 1 es-screenshot` → PASS.
4. Reload the extension; run the Spanish screenshot once in the popup (warms up the models).
5. Keep `kavach_demo_replay` OFF. If the network dies on stage: turn it ON in the popup console (above), re-run.
   Turn it OFF afterwards.
6. Wi-Fi-off part of the demo uses Quick Check (popup) — not affected by the server.

## How to switch to Brev
1. Start the LLM NIM on Brev and `brev port-forward` it to `localhost:8000`.
2. In `server/.env`: `NIM_BACKEND=brev`, `BREV_LLM_MODEL=nvidia/nemotron-3.5-lightning` (`BREV_LLM_URL` if the port differs).
   Only set `BREV_VL_URL` if a VL NIM is really running on Brev — otherwise vision goes to hosted.
3. `npm run smoke -- brev`, then `npm start`. Log lines show `brev` / `hosted` per request, plus
   `(tool shim)` or `(brev … → hosted)` notes.

## Asks for teammates
- **Role 1 (popup):**
  - Screenshot: read the file with `FileReader.readAsDataURL` and call `runDeepCheck({ text, imageDataUrl }, onStep)`
    (agent shrinks it). First checklist line will be "Read screenshot". Show a short note that screenshots are sent
    as images to read the text (PRD 13.5). Don't call Deep Check with empty text and no image.
  - Add `"host_permissions": ["http://localhost:8787/*"]` and (optional) `"permissions": ["storage"]` to manifest.json.
  - `mode: "quick"` from Deep Check = server unreachable → "Deep check needs internet".
  - Steps arrive in real time; just fade each in (no extra delays needed).
- **Role 4 (data):**
  - **`official_contacts.json` phones are still "TODO: copy verified number…"** — this text shows on screen in
    `officialContact.phone`. Please fill in the verified numbers before the demo.
  - Add ICE, SSA, DHS, FBI, FTC to `official_contacts.json` (Hindi ICE scam gets no official contact today).
  - `guidance.json` has only 2 gift-card entries, so the Hindi ICE scam shows "USCIS will never ask for payment by
    gift card" and the Chinese processing-fee scam also gets the gift-card advice. Add entries for ICE/deportation
    threats, fake website links, processing fees, biometrics appointments.
  - `red_flags.json` zh: "24小时内", "取消", "处理费" are not caught (zh-lookalike shows "No common scam phrases found").
- **Role 2 (core):**
  - `searchGuidance("uscis payment")` matches the gift-card entry on 2 generic keywords → wrong advice for scams
    without gift cards. Maybe require the entry's specific keyword (e.g. "gift card") to match.
  - `runQuickCheck("")` returns `safe/unsure` with 4 trace steps — maybe `suspicious/unsure` with a "nothing to check"
    reason, or Role 1 blocks empty input.
  - `checkLookalikeDomain("myUSCIS")` → fail (no dot). Agent guards it; Quick Check may hit it.
