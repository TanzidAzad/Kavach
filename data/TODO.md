# Role 4 — Data, Demo & Pitch: TODO

Owner of `data/`, `demo/`, `eval/`, `README.md`, Devpost, slides, video.
Branch: `data`. Source: PRD section 9 (Role 4), in order.

**Goal:** every number in the product and pitch has a source, and the video is uploaded.

## Deadlines
- **11:00 PM Sat** — team registered on Devpost
- **10:00 AM Sun** — demo video recorded
- **11:00 AM Sun** — final submit (12:00 PM hard deadline)

## Tasks
- [ ] 1. **Register the team on Devpost before 11 PM Sat.** Select tracks: NVIDIA, T-Mobile (sponsor), Best Design (HackUTD).
- [ ] 2. `data/official_contacts.json`: USCIS, IRS, ICE, FTC, SSA. Every phone number and URL copied from the agency's own .gov site, with the source URL. No numbers from memory or from AI.
- [ ] 3. `data/guidance.json`: 15–20 short facts from official scam pages (USCIS scams page, FTC immigration scams, IRS impersonation page), each with a source URL.
- [ ] 4. `data/red_flags.json`: ~15 phrases per language (en, es, hi, zh). Have native speakers check es/hi/zh.
- [ ] 5. `data/demo_messages.json`: 8 messages
  - [ ] 5 scams: USCIS/WhatsApp (Spanish), IRS gift card (English), fake lawyer/"notario" (Spanish), ICE threat (Hindi), lookalike link (Chinese)
  - [ ] 1 suspicious
  - [ ] 2 real/safe ones
- [ ] 6. `demo/`: 2–3 realistic phone screenshots (WhatsApp/SMS style) of the demo scams. Made-up numbers/names only.
- [ ] 7. `data/ui_strings.json`: every UI label in English (get the final list from Role 1).
- [ ] 8. `eval/run_eval.js`: run Quick Check (and Deep Check on ~50 if time) on T-Mobile's synthetic set; write accuracy vs their baseline to `eval/results.md`. Be honest about what was measured.
- [ ] 9. Devpost write-up, 5-slide deck (problem + stats → demo → how it works → accuracy → what's next), demo script.
- [ ] 10. Record the ≤2-min demo video **by 10 AM Sun**.

## Milestones that need my work
- **7:00 PM Sat** — contacts + demo messages v1
- **10:00 PM Sat** — Integration 1 (Quick Check end to end, offline)
- **8:00 AM Sun** — feature freeze
