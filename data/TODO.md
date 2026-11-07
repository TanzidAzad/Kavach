# Role 4 — Data, Demo & Pitch: TODO

Owner of `data/`, `demo/`, `eval/`, `README.md`, Devpost, slides, video.
Branch: `data`. Source: PRD section 9 (Role 4), in order.

**Goal:** every number in the product and pitch has a source, and the video is uploaded.

## Deadlines
- **11:00 PM Sat** — team registered on Devpost
- **10:00 AM Sun** — demo video recorded
- **11:00 AM Sun** — final submit (12:00 PM hard deadline)

## Tasks
- [x] 1. **Register the team on Devpost before 11 PM Sat.** Select tracks: NVIDIA, T-Mobile (sponsor), Best Design (HackUTD).
- [x] 2. `data/official_contacts.json`: USCIS, IRS, ICE, FTC, SSA. Every phone number and URL copied from the agency's own .gov site, with the source URL. No numbers from memory or from AI.
  - [x] Follow-up: SSA phone filled in by hand from ssa.gov
- [x] 3. `data/guidance.json`: 15–20 short facts from official scam pages (USCIS scams page, FTC immigration scams, IRS impersonation page), each with a source URL.
- [x] 4. `data/red_flags.json`: ~15 phrases per language (en, es, hi, zh). Have native speakers check es/hi/zh.
  - [ ] Native speaker check: es, hi, zh phrases (ask on the team or at the event)
- [x] 5. `data/demo_messages.json`: 8 messages
  - [x] 5 scams: USCIS/WhatsApp (Spanish), IRS gift card (English), fake lawyer/"notario" (Spanish), ICE threat (Hindi), lookalike link (Chinese)
  - [x] 1 suspicious
  - [x] 2 real/safe ones
  - [ ] Native speaker check: hi-ice-threat and zh-lookalike-link wording
- [ ] 6. `demo/`: 2–3 realistic phone screenshots (WhatsApp/SMS style) of the demo scams. Made-up numbers/names only.
- [ ] 7. `data/ui_strings.json`: every UI label in English (get the final list from Role 1).
- [ ] 8. `eval/run_eval.js`: run Quick Check (and Deep Check on ~50 if time) on T-Mobile's synthetic set; write accuracy vs their baseline to `eval/results.md`. Be honest about what was measured.
- [ ] 9. Devpost write-up, 5-slide deck (problem + stats → demo → how it works → accuracy → what's next), demo script.
- [ ] 10. Record the ≤2-min demo video **by 10 AM Sun**.

## Milestones that need my work
- **7:00 PM Sat** — contacts + demo messages v1
- **10:00 PM Sat** — Integration 1 (Quick Check end to end, offline)
- **8:00 AM Sun** — feature freeze
