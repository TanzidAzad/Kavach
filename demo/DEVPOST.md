# Devpost write-up — Kavach

Copy each section into the matching Devpost field.
**Before submitting:** check every sentence against what actually works at feature freeze (8 AM Sun). Cut anything that doesn't work. Fill every `[bracket]`.

---

## Tagline (one line)
Catches scam messages in any language, explains them in yours, and tells you what to do next. Works offline.

## Inspiration
Scammers impersonate USCIS, ICE and the IRS, and fake immigration lawyers ("notarios") prey on people who can't easily check whether a message is real.

- Government-impersonation complaints to the FBI nearly doubled in a year: 17,367 in 2024 to 32,424 in 2025, with losses rising from $406M to $798M (FBI IC3 2025 Internet Crime Report).
- Immigration scam complaints to the FTC went from about 960 a year to nearly 2,000 in 2025 (ProPublica analysis of FTC complaints, April 2026).
- About 25 million people in the US speak English less than "very well" (US Census Bureau, American Community Survey 2019).

Most scam checkers are English-only and send your messages to the cloud. We wanted one that works in your language and keeps your details on your device.

## What it does
Kavach is a Chrome extension. Paste a message or upload a screenshot, then tap **Check**.

- **Quick Check** runs instantly and offline, inside the extension. Nothing leaves your device.
- **Deep Check** (optional, one tap) sends a masked copy to an NVIDIA Nemotron agent. It plans which checks to run, calls our tools, and you watch a checklist tick in line by line.
- Every result is a clear verdict (**Scam / Suspicious / Looks safe**), up to 3 reasons and up to 3 next steps, **in the language you choose**: English, Spanish, Hindi or Chinese.
- **Safe next steps:** the official contact for the agency, copied from its .gov website (never written by the AI), plus an **Ask family** button that copies a short message to send to someone you trust.
- Kavach never says "safe" with high confidence, and never says "ignore this". It always points you to the official channel.

## How we built it
- **Chrome extension, Manifest V3, plain JavaScript.** One popup, one screen.
- **Tools written once:** sender-channel check, USCIS case-number format check, lookalike-website check, scam phrases in 4 languages, and search over official guidance. Quick Check calls them directly. In Deep Check, Nemotron decides which ones to call and the extension runs them.
- **NVIDIA Nemotron** via NVIDIA NIM: [agent model ID] for the investigation, [vision model ID] to read screenshots. A tiny Node + Express server holds the API key.
- **Privacy by design:** before anything is sent, personal details become placeholders. A case number becomes `[RECEIPT_1]`. When Nemotron asks to validate `[RECEIPT_1]`, the extension looks up the real value locally. **Nemotron never sees your case number, but can still check it.** Screenshots are sent as images, and we tell the user.
- **Translation** with Chrome's on-device Translator API, for every label too.
- **Verified data:** official contacts for USCIS, IRS, ICE, FTC and SSA, plus 20 guidance facts, all copied from .gov pages with source links.

## Accuracy (be honest)
We tested Quick Check on 40 messages we wrote ourselves: 20 scam, 8 suspicious, 12 safe, 10 in each language. Many of the scams deliberately avoid the exact phrases our tool looks for.
- Exactly right: [__/40]. Scams caught: [__/20]. False alarms on safe messages: [__/12].
- A simple phrase-matching baseline catches 15/20 scams with 0 false alarms, but never identifies a "suspicious" message.
- This is not real-world data, we didn't use a T-Mobile data set, and Deep Check isn't measured. Reproduce it with `node eval/run_eval.js`.

## Challenges we ran into
[Fill in from the team, e.g. getting the agent to call tools reliably, the Translator API, masking without breaking the checks, finding official phone numbers on sites that block bots.]

## Accomplishments that we're proud of
- It works with Wi-Fi off.
- The agent can check your case number without ever seeing it.
- Every phone number and link the user sees comes from a .gov page, with a source.
- [one more from the team]

## What we learned
[Fill in from the team.]

## What's next for Kavach
- Phones: check a text straight from the share menu, where most scams arrive.
- More languages: Vietnamese, Tagalog, Arabic and more.
- Test on real scam reports, with permission.

## Built with
javascript · chrome-extension · manifest-v3 · nvidia-nemotron · nvidia-nim · node.js · express · chrome-translator-api

## Tracks
NVIDIA (Nemotron Beyond a Chatbot) · T-Mobile (scams & fraud) · Best Design

## Sources
- FBI IC3 2025 Internet Crime Report: https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf (figures as reported by Nextgov, Apr 6 2026: https://www.nextgov.com/cybersecurity/2026/04/government-official-impersonation-scam-complaints-doubled-2025-fbi-report-shows/412656/)
- ProPublica, "Fear and Opportunity: Immigration Scams Surged…", Apr 29 2026: https://www.propublica.org/article/trump-immigration-scams-complaints-doubled-ice
- US Census Bureau, Language Use in the United States: 2019 (ACS-50): https://www.census.gov/content/dam/Census/library/publications/2022/acs/acs-50.pdf (67.8M people speak a language other than English at home, 38% of them English less than "very well", about 25.8M)
- Official contacts and guidance: see `data/official_contacts_sources.md` and `data/guidance.json`
