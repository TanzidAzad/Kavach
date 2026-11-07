# Role 3 notes (agent/ + server/) — resume from here

## Done
- `server/scripts/smoke.js` — proves Nemotron works. 5/5 pass on hosted (2026-11-07).
- `server/index.js` — real proxy (PRD 8.5): POST /api/chat only, logical models `agent` / `vision`,
  hosted + brev backends, Brev health check with hosted fallback, 30s timeout, clean JSON errors.
- Tested with curl: `agent` → 200, `gpt-4` → 400, bad JSON → 400, GET → 404,
  brev mode with Brev down → falls back to hosted (200).

- **Deep Check (text path)** — PRD 9 Role 3 tasks 3–5:
  - `agent/toolSchemas.js`: schemas for 5 tools + `submit_verdict` (`getToolSchemas()` is async: the
    `officialAgency` enum is built from `data/official_contacts.json` + `"none"`). `TOOL_RUNNERS` maps names → core/tools.js.
  - `agent/prompts.js`: system prompt + nudges.
  - `agent/agent.js`: `runDeepCheck` — mask → tool loop (max 6 turns, parallel tool calls, dedupe) → `submit_verdict`
    → rules enforced in code. Falls back to `runQuickCheck` on offline / error / 15s timeout. Never throws.
  - `agent/test/run_deep.mjs` (Node harness, checks no secrets in request bodies) and `agent/test/dev.html` (Chrome).
  - 12/12 passing across 3 rounds (see Results).

## Next
- Screenshot path: `imageDataUrl` → `vision` model → extracted text → same loop (agent.js has a TODO; image-only input currently falls back to Quick Check).
- Run `npm run smoke -- brev` once Brev NIMs are up; put the real Brev model IDs in `MODELS.brev` (or BREV_LLM_MODEL / BREV_VL_MODEL in .env).
- `agent/demoReplay.js` (task 6).

## Models (picked by smoke.js from the live /v1/models list)
| Logical | Hosted model ID | Smoke latency |
|---|---|---|
| agent | `nvidia/nemotron-3.5-lightning-30b-a3b` | chat ~1.1s, tool call ~1.6s, summary 4–5s |
| vision | `nvidia/nemotron-3.5-super-vl-120b-a12b` | ~1.0–1.7s on a 64×64 image |

Both passed: tool call returned `validate_case_number` with valid JSON args; Spanish and Hindi scams summarized
correctly in one English line.

## Quirks
- Nemotron 3.x models **reason first** (`message.reasoning_content`) and those tokens count against `max_tokens`.
  With `max_tokens` 50–200 the `content` came back empty. Use **≥1024** for agent turns.
- `/no_think` in the system prompt does not fully disable reasoning on 3.5-lightning (summaries still 4–5s).
  If latency is a problem in the 15s budget, try `nvidia/nemotron-3.5-bolt-e4b` (pong in ~0.2s, no reasoning) — tool quality untested.
- Many listed IDs return 404 on hosted (nemotron-3-super-120b, nemotron-nano-3-30b, llama-3.1-nemotron-51b/70b/ultra).
  The list ≠ what's actually callable; always smoke test.
- `nemotron-3-ultra-550b` also works (tool call ~2.5s) — backup agent model.
- `nemotron-3-nano-omni-30b-a3b-reasoning` also reads images — backup vision model.
- Strip `<think>…</think>` from content just in case.

## Results (hosted, thinking off, 3 rounds × 4 messages — all deep mode, no leaks)
| Message | Verdict | # steps | ms (3 runs) |
|---|---|---|---|
| es-uscis-whatsapp (receipt EAC2490123456 + phone) | scam/high ×3 | 5 | 3907 · 3672 · 2617 |
| en-irs-giftcard | scam/high ×3 | 5 | 2425 · 3264 · 3272 |
| zh-uscis-lookalike (uscis-gov-help.com) | scam/high ×2, scam/medium ×1 | 5 | 5231 · 3232 · 2316 |
| en-uscis-safe (biometrics reminder) | safe/unsure ×3 | 4–5 | 5488 · 3131 · 3411 |
With thinking ON every turn: same verdicts mostly, but 7–15s and the safe message timed out twice → why it's off.

## Decisions
- **Thinking off** (`chat_template_kwargs.enable_thinking: false`, `CONFIG.thinkFirstTurn/thinkLaterTurns` in agent.js).
  Turn latency ~0.3–1s vs 1.5–14s. Harness: `THINK=first,later node agent/test/run_deep.mjs` to compare.
- Per-call timeout 6s + one retry if ≥3s left; 15s total then Quick Check.
- `find_red_flags` takes only `lang`; the agent passes the full original text locally (model doesn't copy the message → faster, nothing missed).
- If the model submits without running `find_red_flags` / `search_guidance`, the agent runs them locally before returning (complete checklist).
- If the model submits with zero checks, it is told once to run checks first.
- Tool results sent back to the model are re-masked (known real values → their placeholders; anything new → `[HIDDEN]`). Only status/label/detail are sent (no source URLs).
- Model optional fields like `"unknown"`/`"none"` are treated as empty. `check_lookalike_domain` only runs on strings with a dot (model once passed "myUSCIS" → false alarm).
- Verdict rules in code: max 3 reasons/steps; links → "the website", phones → "that number", placeholders removed;
  any step with "ignore" → "Do not reply. Verify through the official channel"; safe → confidence `unsure`;
  safe but ≥2 different tools failed → `suspicious/medium`; officialContact `{agency,url,phone}` only from data/official_contacts.json.
- `agent/package.json` = `{"type":"module"}` so Node loads agent/ as ES modules (Chrome ignores it).
- Extension sends `model: "agent"` or `"vision"`; server maps to real IDs (MODELS config at top of index.js). Anything else → 400.
- Server forces `stream: false` so responses are always plain JSON.
- Brev health cached 30s per backend; if Brev not ready and key exists → hosted.
- Optional env `BREV_LLM_MODEL` / `BREV_VL_MODEL` override the Brev model IDs (default = hosted IDs).

## How to run the server
```bash
cd server
npm install
cp .env.example .env        # then put your key in .env (never commit it)
npm start                   # http://localhost:8787 — one log line per request
npm run smoke               # optional: checks the models still work (hosted)
```
Test: `curl -s localhost:8787/api/chat -H 'Content-Type: application/json' -d '{"model":"agent","max_tokens":512,"messages":[{"role":"user","content":"hi"}]}'`

## How to test Deep Check
**Node:** `cd server && npm start` (one terminal), then from repo root: `node agent/test/run_deep.mjs 3` (3 rounds) or
`node agent/test/run_deep.mjs 1 es-uscis-whatsapp` (one message). Prints each step with timestamp, verdict, ms, privacy check, PASS/FAIL.
**Chrome:** server running → `chrome://extensions` → Developer mode → Load unpacked (repo root) or reload →
copy the extension ID → open `chrome-extension://<ID>/agent/test/dev.html` → pick a sample → "Run Deep Check".
Steps appear one by one; status line shows mode/verdict/ms. "fell back" = server not reachable.

## How to switch to Brev
1. Start the NIMs on Brev and run `brev port-forward` so LLM is on `localhost:8000` and VL on `localhost:8001`.
2. In `server/.env`: `NIM_BACKEND=brev` (and `BREV_LLM_URL` / `BREV_VL_URL` if ports differ).
3. `npm run smoke -- brev` → note the model IDs it picks; set `BREV_LLM_MODEL` / `BREV_VL_MODEL` if they differ from the defaults.
4. `npm start`. Log lines show `brev` or `hosted` per request (hosted = Brev was down, fell back).

## Asks for teammates
- **Role 1 (popup):** `import { runDeepCheck } from "../agent/agent.js"` (already in popup.js) — call
  `runDeepCheck({ text, imageDataUrl: null }, onStep)`; it never throws. If the result has `mode: "quick"`, show "Deep check needs internet".
  Add `"host_permissions": ["http://localhost:8787/*"]` to manifest.json (works today via server CORS, but the permission makes it reliable).
- **Role 4 (data):** (1) more agencies in `official_contacts.json` (SSA, ICE, DHS, FBI, FTC) — each becomes a valid `officialAgency`
  and the model's channel/payment check works for it; (2) USCIS `channels` lacks "text message"/"email"/"phone call" —
  if USCIS really sends text/email appointment reminders, add them, otherwise real reminders get a "Sender channel" fail;
  (3) guidance entries need ≥2 keyword hits — add entries for "website link fake domain", "deportation threat", "processing fee",
  "biometrics appointment"; (4) red_flags zh/es/hi have 1 phrase each — add urgency/threat phrases (e.g. zh "24小时内", "取消", es "será deportado").
- **Role 2 (core):** `checkLookalikeDomain("myUSCIS")` → fail (contains "uscis"). Agent guards it (needs a dot), but Quick Check may hit it too.
