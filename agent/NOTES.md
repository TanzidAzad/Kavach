# Role 3 notes (agent/ + server/) — resume from here

## Done
- `server/index.js` — proxy (PRD 8.5): POST /api/chat only, logical models `agent` / `vision`, hosted + brev
  backends, Brev health check with hosted fallback, 30s timeout, 10 MB body limit, clean JSON errors.
  `server/scripts/smoke.js` proves the models work.
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
- Run `npm run smoke -- brev` once Brev NIMs are up; put real Brev model IDs in `BREV_LLM_MODEL` / `BREV_VL_MODEL`.
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

## Demo-day checklist for Role 3
1. Model backend — pick one:
   - Brev: start the NIMs, run `brev port-forward` (LLM → localhost:8000, VL → localhost:8001), `NIM_BACKEND=brev`
     in server/.env, then `npm run smoke -- brev`.
   - Or hosted: `NIM_BACKEND=hosted` (or remove the line) in server/.env.
2. `cd server && npm start` — log line says which backend.
3. Health check (curl above) → `choices` JSON. Then `node agent/test/run_deep.mjs 1 es-screenshot` → PASS.
4. Reload the extension; run the Spanish screenshot once in the popup (warms up the models).
5. Keep `kavach_demo_replay` OFF. If the network dies on stage: turn it ON in the popup console (above), re-run.
   Turn it OFF afterwards.
6. Wi-Fi-off part of the demo uses Quick Check (popup) — not affected by the server.

## How to switch to Brev
1. Start the NIMs on Brev and run `brev port-forward` so LLM is on `localhost:8000` and VL on `localhost:8001`.
2. In `server/.env`: `NIM_BACKEND=brev` (and `BREV_LLM_URL` / `BREV_VL_URL` if ports differ).
3. `npm run smoke -- brev` → note the model IDs; set `BREV_LLM_MODEL` / `BREV_VL_MODEL` if they differ.
4. `npm start`. Log lines show `brev` or `hosted` per request. The `vision` model may stay on hosted if
   there's no VL NIM on Brev — expected.

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
