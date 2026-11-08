# Demo script — Kavach

Two versions: the **≤2-minute video** for Devpost (record by **10 AM Sun**) and the **≈3-minute live pitch** (PRD section 12).

## Before you start (both)
- [ ] Extension loaded from the latest `main` (`chrome://extensions` → Reload)
- [ ] Server running and Deep Check works once. If the API is down, turn on the demo-replay flag (ask Role 3)
- [ ] Language set to **English** before starting
- [ ] Files ready: `demo/es-uscis-whatsapp.png`, and the text of `en-irs-giftcard` and `en-uscis-real` from `data/demo_messages.json`, ready to paste
- [ ] Clipboard empty. Close other tabs, turn off notifications.
- [ ] Popup zoomed so it's readable in the recording

---

## Video (≤ 2:00)

| Time | On screen | Say |
|---|---|---|
| 0:00–0:15 | The Spanish WhatsApp screenshot, full screen | "This message says it's from USCIS. It demands $480 in gift cards in 24 hours or you'll be deported. Government-impersonation scam complaints to the FBI nearly doubled last year, to over 32,000, with almost $800 million lost." |
| 0:15–0:25 | Kavach popup, empty | "Kavach is a Chrome extension that checks messages like this in any language and explains the answer in yours." |
| 0:25–0:55 | Switch language to **Hindi** → 📎 upload the screenshot → **Check**. The checklist ticks in. | "I'll set my language to Hindi and upload the screenshot. Deep Check uses an NVIDIA Nemotron agent. Watch it investigate: it checks how USCIS really contacts people, whether the case number is valid, and the payment method." |
| 0:55–1:05 | Verdict: SCAM, in Hindi | "Scam, explained in Hindi, with the official USCIS contact, copied from uscis.gov, never written by the AI." |
| 1:05–1:20 | Turn Wi-Fi **off** → language **English** → paste the IRS gift-card text → **Check** | "No internet? Quick Check runs entirely on your device. Same answer, instantly." |
| 1:20–1:30 | Tap **Ask family** → paste into a notes app | "One tap copies a message to send to someone you trust." |
| 1:30–1:45 | Paste the real USCIS update → **Check** → "Looks safe · Unsure" | "And it doesn't flag everything. A real USCIS update comes back 'looks safe, unsure — verify on uscis.gov'. We never say 'safe' with high confidence." |
| 1:45–2:00 | The "How it works" slide, then the last slide | "Before anything goes to the cloud, personal details are masked. Nemotron never sees your case number, but can still check it. Kavach: any language in, your language out." |

Stop at 2:00. If you're over time, cut the Ask-family step first.

---

## Live pitch (≈ 3 min) — follows the deck

1. **Hook (slide 1, 30s):** show the scary USCIS message, then the FBI doubling stat.
2. **Deep Check (slide 2, 60s):** upload the Spanish WhatsApp screenshot with the language set to Hindi → the checklist ticks in → SCAM, explained in Hindi.
3. **Offline (20s):** Wi-Fi off → paste the English IRS gift-card text → Quick Check catches it instantly.
4. **Ask family (10s):** tap it, show the copied message.
5. **Safe message (15s):** paste the real one → "Looks safe, unsure — verify on uscis.gov." Shows honesty.
6. **Proof + close (slides 3–5, 45s):** how it works, accuracy (say plainly what was measured), privacy line, next step: phones.

## If something breaks on stage
- **Deep Check hangs (>15s):** it falls back to Quick Check automatically. Say "it falls back to the offline check" and keep going.
- **API is down:** use the demo-replay flag (Role 3).
- **The translation doesn't appear:** switch to Spanish. Chrome may still be downloading the Hindi language pack.
- Never show raw errors. Close the popup and reopen it.
