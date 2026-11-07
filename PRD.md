# Kavach — Product Requirements Doc (HackUTD 2026: ZeroDay)

> A Chrome extension that catches scam messages in any language, explains them in **your** language, and tells you what to do next.
> **Quick Check** works offline, on-device. **Deep Check** uses a Nemotron agent that investigates the message step by step.

**Tracks:** NVIDIA (Nemotron Beyond a Chatbot) · T-Mobile (scams & fraud) · Best Design (HackUTD track) · Overall (automatic)

**Hard deadlines**
- **11:00 PM Sat** — team registered on Devpost
- **12:00 PM Sun** — final submission (no edits after). Needs: repo link, description, ≤2-min demo video

---

## 1. Problem

Scammers impersonate government agencies (USCIS, ICE, IRS) and fake immigration lawyers. They target people who can't easily check if a message is real: people with limited English, and people unfamiliar with how US agencies actually contact you.

- FBI: government-impersonation complaints nearly doubled, 17,367 (2024) → 32,424 (2025); losses $406M → $798M.
- FTC: immigration scam complaints went from ~960/year to nearly 2,000 in 2025.
- 25M+ people in the US have limited English proficiency.
- Most scam tools are English-only and send your messages to the cloud.

## 2. Solution in one paragraph

User pastes a message or uploads a screenshot. **Quick Check** runs instantly inside the extension using rule-based tools (no internet, nothing leaves the device). Optionally the user taps **Deep Check**: personal details are masked, and a Nemotron agent plans which checks to run, calls tools, and returns a verdict with evidence. Every result is explained in the user's chosen language and ends with safe next steps (official contact, "Ask family" message).

## 3. Pitch pillars (everything we build serves one of these)

1. **Any language in, your language out** — screenshot or text in Spanish/Hindi/Chinese/English, explanation in the user's language.
2. **Watch it investigate** — Deep Check shows a simple checklist of what the agent checked, ticking in one by one.
3. **Safe next steps** — official contacts from our verified directory (never AI-generated), "Ask family" message, FTC report link.
4. **Privacy line** — local by default; cloud only on tap; personal details masked before sending. Works offline.

## 4. Scope

**MVP (must work in the demo)**
- Paste text → Quick Check (offline) → verdict + reasons + next steps in user's language
- Deep Check → Nemotron agent with 5 tools → live checklist → verdict
- Screenshot upload → Nemotron VL reads it → Deep Check
- Language picker: English, Spanish, Hindi, Chinese (Simplified)
- "Ask family" button (copies a short message in the user's language)
- Offline fallback: if no internet/API fails, show Quick Check result + "Deep check needs internet"
- PII masking before anything is sent

**Stretch (only after MVP works end to end)**
- Right-click "Check with Kavach" on highlighted text
- RDAP domain-age tool
- Nemotron embeddings for guidance search
- T-Mobile accuracy numbers (script output → one slide, NOT a UI dashboard)
- Gemini Nano for offline AI

**Out of scope (do not build)**
- Accounts, login, history, databases
- Scanning Gmail/WhatsApp automatically
- Phone-number lookup, lawyer verification
- Any settings page, tabs, dashboards, onboarding flows

## 5. UI — CLEAN AND SIMPLE

**One popup. One screen. No tabs, no settings page, no dashboard.**

```
┌──────────────────────────────────┐
│ 🛡 Kavach            [English ▾] │  ← name + language dropdown (that's all the settings)
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ Paste a message…             │ │  ← textarea
│ └──────────────────────────────┘ │
│ 📎 Upload screenshot             │  ← small text link
│                                  │
│ [          Check           ]     │  ← one big button
└──────────────────────────────────┘
```

**After Check:**

```
┌──────────────────────────────────┐
│ 🛡 Kavach            [Español ▾] │
├──────────────────────────────────┤
│ ● ESTAFA         Confianza: Alta │  ← big colored verdict line
│                                  │
│ Por qué:                         │
│ • USCIS no usa WhatsApp          │  ← max 3 reasons
│ • El número de caso no es válido │
│ • Piden tarjetas de regalo       │
│                                  │
│ Qué hacer:                       │
│ 1. No pague ni llame a ese número│  ← max 2–3 steps
│ 2. Revise su caso en my.uscis.gov│
│                                  │
│ [ Ask family ]  [ Deep check → ] │  ← two buttons max
│                       offline ○  │  ← tiny grey status
└──────────────────────────────────┘
```

**During Deep Check:** the reasons area is replaced by a simple checklist that fills in line by line:

```
 Checking…
 ✗ Sender channel — USCIS doesn't use WhatsApp
 ✗ Case number — invalid format
 ✗ Payment — gift cards requested
 … Searching official guidance
```

**Design rules**
- White background, system font, 14px body / 20px verdict.
- Colors: red `#D93025` scam, amber `#F29900` suspicious, green `#188038` looks safe, grey for everything else. **No other colors. No gradients. No shadows heavier than 1px.**
- Popup width 380px, no scrolling in the normal case.
- Only animation: checklist lines fade in. Nothing else moves.
- Max 3 reasons, max 3 steps, max 2 buttons. If it doesn't fit, cut it.
- All UI text goes through translation (labels too), so a Hindi user sees Hindi everywhere.
- Never show raw JSON, model names, or error stacks to the user.

## 6. Architecture

```
Chrome Extension (Manifest V3, plain JS, no build step)
 ├─ popup/        UI (Role 1)
 ├─ core/         tools, rules, masking, translation (Role 2)
 ├─ agent/        Nemotron agent loop, runs in extension (Role 3)
 └─ data/         JSON content: contacts, red flags, guidance, demo messages (Role 4)
        │
        │ masked text only (screenshots sent as image to VL)
        ▼
server/  tiny Node + Express proxy — holds NVIDIA API key, forwards to NIM (Role 3)
        ▼
NVIDIA NIM API (OpenAI-compatible): https://integrate.api.nvidia.com/v1/chat/completions
```

**Key design decision:** tools are written ONCE in JS in `core/`. Quick Check calls them directly. In Deep Check, Nemotron decides which tool to call and the **extension** runs it. The server only holds the API key.

**Privacy trick:** before sending, the extension replaces personal details with placeholders (`[RECEIPT_1]`, `[PHONE_1]`). When Nemotron calls `validate_case_number("[RECEIPT_1]")`, the extension looks up the real value locally. **Nemotron never sees your case number but can still check it.**

**Translation:** both modes produce reasons/steps in English; the extension translates to the user's language with Chrome's on-device Translator API. One translation path for everything.

## 7. Repo structure

```
kavach/
├─ PRD.md
├─ CLAUDE.md
├─ manifest.json
├─ popup/          popup.html, popup.css, popup.js                 ← Role 1
├─ core/           tools.js, quickcheck.js, mask.js, translate.js  ← Role 2
├─ agent/          agent.js, prompts.js, toolSchemas.js, demoReplay.js ← Role 3
├─ server/         index.js, package.json, .env.example            ← Role 3
├─ data/           official_contacts.json, red_flags.json,
│                  guidance.json, demo_messages.json, ui_strings.json ← Role 4
├─ demo/           demo screenshots (PNG)                           ← Role 4
└─ eval/           run_eval.js, results.md                          ← Role 4
```

**Rule: you only edit your own folders.** Need a change elsewhere? Ask the owner in the group chat.

## 8. Shared contracts (FROZEN — change only if all 4 agree)

### 8.1 Tool result
```js
{
  tool: "validate_case_number",     // tool id
  status: "fail" | "pass" | "unknown",  // fail = red flag found
  label: "Case number",             // short English label for the checklist
  detail: "Invalid format (needs 3 letters + 10 digits)", // English, one sentence
  source: "https://www.uscis.gov/..." // optional, official URL
}
```

### 8.2 Verdict (output of BOTH Quick Check and Deep Check)
```js
{
  verdict: "scam" | "suspicious" | "safe",
  confidence: "high" | "medium" | "unsure",
  reasons: ["USCIS does not contact people on WhatsApp", ...], // English, max 3
  steps: ["Do not pay or call that number", ...],              // English, max 3
  officialContact: { agency: "USCIS", url: "...", phone: "..." } | null, // ONLY from data/official_contacts.json
  trace: [ /* ToolResult[] in the order they ran */ ],
  mode: "quick" | "deep",
  familyMessage: "I got this message that says it's from USCIS..." // English
}
```
The popup translates `reasons`, `steps`, `familyMessage`, and checklist labels at display time.

### 8.3 Tool functions (`core/tools.js`)
All return a ToolResult (8.1). All work offline unless marked.
```js
checkOfficialContact({ claimedAgency, channel, paymentMethod })
validateCaseNumber(caseNumber)          // USCIS receipt: 3 letters + 10 digits
checkLookalikeDomain(url)               // compare against real .gov domains
findRedFlags(text, lang)                // phrase list from data/red_flags.json
searchGuidance(query)                   // keyword search over data/guidance.json
checkDomainAge(url)                     // STRETCH, needs internet (RDAP)
```

### 8.4 Popup ↔ engine
```js
// popup calls:
runQuickCheck(text)                         → Promise<Verdict>
runDeepCheck({ text, imageDataUrl }, onStep) → Promise<Verdict>
// onStep(toolResult) is called each time a tool finishes → popup adds a checklist line
```

### 8.5 Server
```
POST http://localhost:8787/api/chat
body: standard OpenAI chat-completions body (model, messages, tools, …)
→ forwards to NVIDIA NIM with the API key from .env, returns the response unchanged.
Model allowlist in server config. No other endpoints.
```

### 8.6 Data file formats (`data/`)
```js
// official_contacts.json
[{ "agency": "USCIS", "channels": ["mail", "myUSCIS account"], "neverAsksFor": ["gift cards", "crypto", "wire transfer"],
   "url": "https://www.uscis.gov/...", "phone": "VERIFIED NUMBER", "source": "https://..." }]

// red_flags.json
{ "en": [{ "phrase": "gift card", "reason": "Government agencies never take gift cards" }],
  "es": [...], "hi": [...], "zh": [...] }

// guidance.json
[{ "id": "uscis-gift-cards", "text": "USCIS will never ask for payment by gift card.", "keywords": ["gift card","uscis"], "source": "https://..." }]

// demo_messages.json
[{ "id": "es-uscis-whatsapp", "lang": "es", "text": "...", "expected": "scam", "notes": "..." }]

// ui_strings.json — every English UI label, so it can be translated
{ "check": "Check", "pasteMessage": "Paste a message…", ... }
```

---

## 9. Roles

### Role 1 — UI / Popup Lead (owns `popup/`, `manifest.json`)
**Goal:** the clean one-screen popup in section 5. You own Best Design.

Tasks, in order:
1. `manifest.json` (MV3): popup, permissions `storage`, `contextMenus` (stretch), host permission for `http://localhost:8787/*`.
2. Build the popup exactly like section 5 using a **hardcoded mock Verdict** so you don't wait on anyone.
3. Language dropdown (en/es/hi/zh), saved with `chrome.storage.local`.
4. Wire translation: call `core/translate.js` for every displayed string (use `ui_strings.json`).
5. Result card: verdict color, confidence, ≤3 reasons, ≤3 steps, two buttons.
6. Deep Check checklist: append one line per `onStep` call, fade in.
7. "Ask family" → copy translated `familyMessage` to clipboard, show "Copied ✓" for 2s.
8. Screenshot upload → read file as data URL → pass to `runDeepCheck`.
9. Offline pill: `navigator.onLine`; if offline, hide Deep check button, show grey "offline".
10. Polish pass: spacing, alignment, every state (empty, loading, result, error) looks intentional.

**Done when:** a stranger can check a message without any explanation, in all 4 languages.
**Mocks you use:** fake `runQuickCheck`/`runDeepCheck` that return a sample Verdict after 1s (deep one calls `onStep` 4 times).

### Role 2 — Core Engine Lead (owns `core/`)
**Goal:** offline Quick Check + all tools + masking + translation.

Tasks, in order:
1. `core/tools.js`: implement every function in 8.3, returning ToolResults. Pure JS, no network (except `checkDomainAge`).
   - `validateCaseNumber`: regex `^[A-Z]{3}\d{10}$`, also handle "missing/none found" → `unknown`.
   - `checkLookalikeDomain`: extract domain, compare with list of real domains (uscis.gov, irs.gov, ice.gov, ftc.gov, …) — flag anything containing "uscis"/"irs" that isn't the real domain.
   - `findRedFlags`: case-insensitive phrase match from `red_flags.json`; return matched phrases.
2. `core/quickcheck.js` → `runQuickCheck(text)`: detect language (Chrome Language Detector API, fallback: assume en), extract URLs / case numbers / agency names / payment words with regex, run tools, score:
   - 2+ fails → scam/high · 1 fail → suspicious/medium · 0 fails → safe/unsure (never "safe/high")
   - Build reasons from failed tool `detail`s, steps from `official_contacts.json`, `familyMessage` template.
3. `core/mask.js`: `mask(text) → { masked, map }` and `unmask(placeholder, map)`. Patterns: USCIS receipt, A-number (`A\d{8,9}`), US phone, email, SSN.
4. `core/translate.js`: `translate(text, targetLang)` using Chrome Translator API; cache results; if unavailable or target is en, return English.
5. Unit-test every tool against `data/demo_messages.json` (simple test page or node script).

**Done when:** every demo message gets the expected verdict in Quick Check with Wi-Fi off.
**Mocks you use:** write a few sample JSON entries yourself until Role 4 delivers data.

### Role 3 — Agent & Backend Lead (owns `agent/`, `server/`)
**Goal:** Nemotron Deep Check that visibly investigates. You own the NVIDIA track.

Tasks, in order:
1. **FIRST HOUR:** get an NVIDIA API key at build.nvidia.com. In a node script, make one chat call and one tool call to a Nemotron model. Check current model IDs on build.nvidia.com and pick: one Nemotron model for the agent, one Nemotron VL model for screenshots. Test one Spanish/Hindi message.
2. `server/index.js`: Express proxy per 8.5. Key in `.env` (gitignored), `.env.example` committed. CORS for the extension.
3. `agent/toolSchemas.js`: OpenAI function schemas for the tools in 8.3 + a final `submit_verdict` tool whose args match the Verdict shape (minus `trace`, `mode`).
4. `agent/prompts.js`: system prompt — "You are a scam investigator. Plan which checks to run. Call tools. Never write phone numbers or URLs yourself. Finish by calling submit_verdict. Write reasons/steps in English."
5. `agent/agent.js` → `runDeepCheck({ text, imageDataUrl }, onStep)`:
   - If image: call VL model → extracted text.
   - `mask()` the text.
   - Loop (max 6 turns): call `/api/chat` → for each tool call, unmask args, run the tool from `core/tools.js`, call `onStep(result)`, send result back. Run independent tool calls in parallel.
   - On `submit_verdict`: attach `trace`, set `mode: "deep"`, replace `officialContact` with the entry from `official_contacts.json` (never trust model-written contacts).
   - On any error/timeout (15s): fall back to `runQuickCheck(text)`.
6. `agent/demoReplay.js`: save one successful Deep Check run to JSON; a hidden flag replays it with realistic timing if the API is down on stage.

**Done when:** the Spanish WhatsApp demo screenshot goes through Deep Check and shows ≥4 checklist steps in under 15s.
**Mocks you use:** stub tools that return fixed ToolResults until Role 2's are ready.

### Role 4 — Data, Demo & Pitch Lead (owns `data/`, `demo/`, `eval/`, Devpost, slides, video)
**Goal:** make everything true, testable, and presentable. This role decides whether we look real or look like a larp.

Tasks, in order:
1. **Register the team on Devpost before 11 PM.** Select tracks: NVIDIA, T-Mobile (sponsor), Best Design (HackUTD).
2. `data/official_contacts.json`: USCIS, IRS, ICE, FTC, SSA. **Every phone number and URL copied from the agency's own .gov site**, with the source URL. No numbers from memory, no numbers from the AI.
3. `data/guidance.json`: 15–20 short facts from official scam pages (USCIS scams page, FTC immigration scams, IRS impersonation page), each with source URL.
4. `data/red_flags.json`: ~15 phrases per language (en, es, hi, zh). Get native speakers on the team or at the event to check es/hi/zh.
5. `data/demo_messages.json`: 8 messages — 5 scams (USCIS/WhatsApp in Spanish, IRS gift card in English, fake lawyer/"notario" in Spanish, ICE threat in Hindi, lookalike-link in Chinese), 1 suspicious, 2 real/safe ones (to show we don't flag everything).
6. `demo/`: 2–3 realistic phone screenshots (WhatsApp/SMS style) of the demo scams. Use made-up numbers/names.
7. `data/ui_strings.json`: every UI label in English (Role 1 tells you the list).
8. `eval/run_eval.js`: run Quick Check (and Deep Check on a sample of ~50 if time) on T-Mobile's synthetic set; write accuracy vs their baseline to `eval/results.md`. Be honest about what was measured.
9. Devpost write-up, 5-slide deck (problem + stats → demo → how it works → accuracy → what's next), demo script.
10. Record the ≤2-min demo video **by 10 AM Sunday**.

**Done when:** every number in the product and pitch has a source, and the video is uploaded.

---

## 10. Timeline (Sat 3:30 PM → Sun 12:00 PM)

| Time | Milestone | Who |
|---|---|---|
| 4:30 PM | Repo up, skeleton folders, everyone's Claude Code running. NVIDIA API call works. | All / Role 3 |
| 7:00 PM | Popup with mock data · tools pass on sample data · proxy working · contacts + demo messages v1 | Each role |
| **10:00 PM** | **Integration 1: Quick Check works end to end, offline.** | All |
| 11:00 PM | Devpost registered | Role 4 |
| 2:00 AM | **Integration 2: Deep Check with live checklist works.** | All |
| 5:00 AM | Screenshots, masking, all 4 languages, fallback | All |
| 8:00 AM | **Feature freeze.** Only bug fixes and polish after this. | All |
| 10:00 AM | Video recorded, Devpost draft filled | Role 4 |
| 11:00 AM | Final submit (1 hour buffer) | Role 4 |

Sleep in shifts. Never let two people sleep during an integration milestone.

## 11. Git workflow (READ THIS — merge conflicts kill hackathon teams)

### Branches
| Role | Branch | Folders you may edit |
|---|---|---|
| 1 UI | `ui` | `popup/`, `manifest.json` |
| 2 Core | `core` | `core/` |
| 3 Agent | `agent` | `agent/`, `server/` |
| 4 Data | `data` | `data/`, `demo/`, `eval/`, `README.md` |

- **Nobody works directly on `main`.** `main` must always load in Chrome without errors.
- `PRD.md`, `CLAUDE.md`, `.gitignore` are shared — only change them after the team agrees in the group chat, in a commit that touches nothing else.
- Need something in a file you don't own (e.g. a permission in `manifest.json`)? Ask the owner. Don't edit it yourself.

### One-time setup (each person)
```bash
git clone https://github.com/TanzidAzad/Kavach.git
cd Kavach
git checkout -b core          # use YOUR branch name
git push -u origin core
```

### Start of every work session
```bash
git checkout core             # your branch
git pull origin main          # bring in everyone else's merged work
```

### While working (Claude Code does this automatically — see CLAUDE.md)
- **Commit after every small step that works** (every 15–30 min). Message format: `[core] add validateCaseNumber`.
- **Push your branch after every commit:** `git push`.
- Only `git add` files in your own folders. Never `git add .` blindly.

### Merging into main (at least every 2 hours, and at every integration milestone)
1. `git pull origin main` into your branch → fix anything that broke → test in Chrome.
2. Push your branch, then open a Pull Request `your-branch → main` on GitHub.
3. Post in the group chat: "PR up for core."
4. **Role 3 (integrator) merges PRs.** If Role 3 is asleep, the most awake person does it.
5. After any merge, everyone runs `git pull origin main` into their branch.

### Never
- `git push --force` (destroys teammates' work)
- Commit `.env`, API keys, or `node_modules/`
- Reformat, rename, or "clean up" files outside your folders
- Resolve a conflict in someone else's folder by guessing — ask them

### If you get a merge conflict
Stop. Don't let Claude pick a side blindly. If the conflict is only in your folders, resolve it and test. If it touches someone else's files, call them over.

## 12. Demo script (≈3 min)
1. **Hook:** the scary USCIS message on screen + the FBI doubling stat.
2. **Deep Check:** upload Spanish WhatsApp screenshot, language set to Hindi → checklist ticks in → SCAM, explained in Hindi.
3. **Offline:** turn Wi-Fi off → paste English IRS gift-card text → Quick Check catches it instantly.
4. **Ask family:** tap it, show the copied message.
5. **Safe message:** paste a real one → "Looks safe, unsure — verify on uscis.gov." Shows honesty.
6. **Proof + close:** accuracy slide, privacy line ("Nemotron never sees your case number"), next step: phones.

## 13. Non-negotiable rules
1. The AI never writes phone numbers or URLs. Official contacts only come from `data/official_contacts.json`.
2. Never say "ignore this message." Always "verify through the official channel."
3. Never output "safe" with high confidence.
4. API key lives only in `server/.env`.
5. Mask before sending. Be honest that screenshots are sent as images.
6. If it isn't working by feature freeze, cut it. A small thing that works beats a big thing that crashes.
