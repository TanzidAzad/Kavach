# Role 1 — UI / Popup TODO

Branch: `ui` only. Files: `popup/`, `manifest.json`. Source: PRD sections 5 + 9 (Role 1).

## Quick Check milestone (by 10 PM)
- [x] 1. `manifest.json`: add `storage` permission + host permission `http://localhost:8787/*`
- [x] 2. Popup matches PRD section 5 (empty + result screens, checklist marks, hover/focus/disabled states)
- [x] 3. Language dropdown (en/es/hi/zh) saved with `chrome.storage.local`, restored when the popup opens; on change call `prepareTranslation(lang)` from `core/translate.js` (starts the language download — must run right after the user's selection)
- [x] 4. Translate every label: load `data/ui_strings.json`, run each label through `core/translate.js`, redraw when the language changes (incl. error messages). Protect URLs (e.g. `https://www.uscis.gov/` inside steps) so the translator can't change them — swap them out before translating and back in after
- [x] 5. Result card: verdict color, confidence, ≤3 reasons, ≤3 steps, max 2 buttons. Core already puts the official URL inside a step, so don't add a separate contact block — make the URL in the step a clickable link instead
- [x] 6. Loading state (disable Check while it runs) + a small "← New check" link to go back to the input
- [x] 7. "Ask family" → copy translated `familyMessage`, show "Copied ✓" for 2s
- [x] 8. Offline pill: `navigator.onLine`; offline → hide Deep check, show grey "offline"

## Deep Check milestone (by 2 AM)
- [x] 9. Deep Check checklist: one line per `onStep`, fade in, lines stay in order
- [x] 10. Deep Check errors don't leave the screen half-done (fall back to the reasons view + message)
- [x] 11. Screenshot upload → data URL → `runDeepCheck`; show the chosen file name so the user knows it worked

## Polish (before 8:30 AM freeze)
- [ ] 12. Every state looks intentional: empty, loading, result, checklist, error, offline — in all 4 languages
- [ ] 13. Send Role 4 the final list of UI labels for `data/ui_strings.json` — only missing key: `"screenshotNote": "Screenshots are sent as an image so the text can be read."` (popup uses English fallback until then)
- [x] 14a. Real Quick Check from Role 2 merged into `ui` (PR #1) — popup already imports it, no mock needed
- [ ] 14b. Real Deep Check from Role 3 when merged (pull main and retest)

## Stretch (only if all above works)
- [ ] 15. Right-click "Check with Kavach" (`contextMenus` permission + background script)
