# Role 1 — UI / Popup TODO

Branch: `ui` only. Files: `popup/`, `manifest.json`. Source: PRD sections 5 + 9 (Role 1).

## Quick Check milestone (by 10 PM)
- [x] 1. `manifest.json`: add `storage` permission + host permission `http://localhost:8787/*`
- [ ] 2. Popup matches PRD section 5, running on the mock Verdict (check the empty + result screens)
- [ ] 3. Language dropdown (en/es/hi/zh) saved with `chrome.storage.local`, restored when the popup opens
- [ ] 4. Translate every label: load `data/ui_strings.json`, run each label through `core/translate.js`, redraw when the language changes (incl. error messages)
- [ ] 5. Result card: verdict color, confidence, ≤3 reasons, ≤3 steps, max 2 buttons, plus official contact if present
- [ ] 6. Loading state (disable Check while it runs) + a small "← New check" link to go back to the input
- [ ] 7. "Ask family" → copy translated `familyMessage`, show "Copied ✓" for 2s
- [ ] 8. Offline pill: `navigator.onLine`; offline → hide Deep check, show grey "offline"

## Deep Check milestone (by 2 AM)
- [ ] 9. Deep Check checklist: one line per `onStep`, fade in, lines stay in order
- [ ] 10. Deep Check errors don't leave the screen half-done (fall back to the reasons view + message)
- [ ] 11. Screenshot upload → data URL → `runDeepCheck`; show the chosen file name so the user knows it worked

## Polish (before 8:30 AM freeze)
- [ ] 12. Every state looks intentional: empty, loading, result, checklist, error, offline — in all 4 languages
- [ ] 13. Send Role 4 the final list of UI labels for `data/ui_strings.json`
- [ ] 14. Swap mocks for the real engine when Role 2 / Role 3 merge (pull main and retest)

## Stretch (only if all above works)
- [ ] 15. Right-click "Check with Kavach" (`contextMenus` permission + background script)
