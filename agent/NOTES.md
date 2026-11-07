# Role 3 notes (agent/ + server/) — resume from here

## Done
- `server/scripts/smoke.js` — proves Nemotron works. 5/5 pass on hosted (2026-11-07).
- `server/index.js` — real proxy (PRD 8.5): POST /api/chat only, logical models `agent` / `vision`,
  hosted + brev backends, Brev health check with hosted fallback, 30s timeout, clean JSON errors.
- Tested with curl: `agent` → 200, `gpt-4` → 400, bad JSON → 400, GET → 404,
  brev mode with Brev down → falls back to hosted (200).

## Next
- **Agent loop**: `agent/toolSchemas.js`, `agent/prompts.js`, `agent/agent.js` (`runDeepCheck`), PRD 9 Role 3 tasks 3–5.
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

## Decisions
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

## How to switch to Brev
1. Start the NIMs on Brev and run `brev port-forward` so LLM is on `localhost:8000` and VL on `localhost:8001`.
2. In `server/.env`: `NIM_BACKEND=brev` (and `BREV_LLM_URL` / `BREV_VL_URL` if ports differ).
3. `npm run smoke -- brev` → note the model IDs it picks; set `BREV_LLM_MODEL` / `BREV_VL_MODEL` if they differ from the defaults.
4. `npm start`. Log lines show `brev` or `hosted` per request (hosted = Brev was down, fell back).

## Asks for teammates
- Role 1: `manifest.json` needs host permission `http://localhost:8787/*` (PRD 9 Role 1 task 1) — confirm it's there.
