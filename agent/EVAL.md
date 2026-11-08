# Kavach — how accurate is it? (Deep Check vs Quick Check)

_Measured 2026-11-08 with `node agent/test/eval_deep.mjs` on the self-hosted Nemotron (Brev, `nemotron-3.5-lightning`, int4)._

## Slide table (honest version: Deep Check measured before we changed anything)

| 40 test messages (en/es/hi/zh) | Exactly right | Scams flagged | Safe messages wrongly flagged | Typical time |
|---|---|---|---|---|
| **Deep Check** (AI agent, online) | **34/40 (85%)** | **20/20 (100%)** | 2/12 as "suspicious", 0/12 as "scam" | ~2.8 s |
| **Quick Check** (rules, offline) | 24/40 (60%) | 18/20 (90%) | 0/12 | instant |
| Baseline (count scam phrases) | 19/40 (48%) | 15/20 (75%) | 0/12 | instant |

"Scams flagged" means the message was called scam or suspicious, so the person gets warned. Deep Check called 20/20 scams an outright "scam".

## What was measured
- **Test set:** Role 4's 40 messages (`eval/test_messages.json` on the `data` branch): 20 scam, 8 suspicious, 12 safe, 10 per language. The team wrote them; they are not real-world data. Hindi and Chinese have not been checked by native speakers.
- **No held-out split.** Every message was used for scoring. Role 4 wrote both the red-flag list (which Quick Check and the baseline use) and these messages, so **Quick Check and baseline numbers are on the same set its rules were tuned on**.
- Quick Check and baseline use the `data` branch's `data/` (newer than `main`, not merged yet). On today's `main` data, Quick Check is 14/40 and baseline 12/40.
- **Small sample.** One safe message wrongly flagged moves that column by 8 points; one missed scam moves recall by 5 points. Treat differences under ~10 points as noise.
- Deep Check ran 3 messages at a time, text only. Screenshots are tested separately (`run_deep.mjs`).

## Blind run vs after fixes (read before quoting 100%)
The slide numbers come from the **first run, before any change** (two runs: 34/40 and 33/40).
That run exposed problems, and we fixed them:
1. **Bug:** general "USCIS never asks you to pay fees…" advice counted as a failed check, so "Hi mom, I landed safe" came back "suspicious". Advice no longer counts, and payment advice is hidden when the message asks for no money.
2. **Weak spot:** when all the tools passed, the model said "safe" even for "a warrant will be issued for your arrest". The prompt now tells it to judge threats, requests for SSN or date of birth, callback numbers and unofficial helpers itself. In code, a threat of arrest or deportation is never "safe".
3. **Rule:** a failed check plus 2+ independent warning signs means "scam", with high confidence.

**After the fixes, on the same 40 messages: 40/40 in both runs** (data branch data; the old pre-merge `main` data gave 36/40).
**Re-run on merged `main` (2026-11-07, Role 4's data + UI merged, Brev): unchanged** — Deep 40/40, 20/20 scams called scam,
0/12 safe flagged; Quick Check 24/40, 18/20; baseline 19/40, 15/20 (`node eval/run_eval.js` agrees on Quick/baseline).
Median 3.0 s, p90 4.7 s, max 6.1 s, 0 fallbacks, 0/97 Brev→hosted. These numbers were **tuned on this set**, so they are optimistic. Don't put 100% on the slide. A fair claim is "85% before tuning, and every scam caught".

## Speed and reliability (Deep Check, 6 full runs = 240 checks)
- Median **2.8–3.0 s**, slowest 10% (p90) **3.3–5.3 s**, slowest single check 6.2 s. All were under the 15 s budget.
- **Fallbacks: 0.** No check fell back to Quick Check, none had to be finished locally, and 0 of ~560 model calls went from Brev to hosted.
- Rule checks held every time: "safe" never came with high confidence, and "scam" never came with "unsure".

## Where Deep Check still struggles (blind run)
- **"Unlicensed helper / consultant" (3–4 of the 8 suspicious messages):** it called them safe. Fixed by the prompt (see 2).
- **SSA impersonation in Hindi with no payment request:** sometimes only "suspicious".
- **Look-alike link with no payment words** (t-zh-05, t-es-03): "suspicious" instead of "scam". The person is still warned.

## How to re-run
```bash
cd server && npm start                         # Brev or hosted, see agent/NOTES.md
node agent/test/eval_deep.mjs --json /tmp/eval.json   # uses eval/test_messages.json from this checkout
# other data/: CODE_ROOT=<folder with agent/ core/ data/> node agent/test/eval_deep.mjs
```
