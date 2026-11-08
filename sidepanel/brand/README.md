# Kavach logos — use these everywhere

| File | What it is | Use it for |
|---|---|---|
| `logo-header.png` | shield + "kavach", dark ink, transparent | on white: popup, side panel, page cards |
| `logo-light-transparent.png` | same, bigger | docs, README, anything on a light background |
| `logo-light.png` | shield + "kavach" on cream (3200×1200) | slides, Devpost, light backgrounds |
| `logo-dark.png` | shield + "kavach" on black (3200×1200) | slides, video title card, dark backgrounds |
| `mark-dark.png` | shield only, dark, transparent | small spots on light backgrounds (content-script card) |
| `mark-cream.png`, `mark-cream-large.png` | shield only, cream, transparent | small spots on dark backgrounds |
| `app-icon.png` | cream shield on black tile (2400×1600) | Devpost thumbnail / social |
| `icon16/32/48/128.png` | cream shield on black rounded tile | Chrome toolbar + extensions page (set in manifest.json) |

From a content script (Role 2's card), load the shield with:
`chrome.runtime.getURL("sidepanel/brand/mark-dark.png")` — already allowed for Gmail, Outlook, WhatsApp Web
in `manifest.json` → `web_accessible_resources`.

Colors in the logo: ink `#111111`, cream `#F5F4EF`, greys `#4B4B4B` / `#CFCFCF`. Don't recolor or stretch it.
