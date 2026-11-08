# Kavach logos in the extension

Source of truth: **`kavach-logo-kit/`** (repo root): final logos, colors, SVGs, Devpost thumbnail, backdrop.
Everything in this folder is copied or cut from that kit. Don't draw or recolor logos anywhere else.

| File here | From the kit | Used for |
|---|---|---|
| `icon16/32/48/128.png` | `extension-icons/` (as-is) | toolbar + extensions page (manifest.json), tab icon, notification |
| `logo-header.png` | `logo/kavach-logo-transparent-for-light.png`, trimmed, 96px tall | popup + side panel header (full logo: shield + name) |
| `mark-dark.png` | `icon/kavach-shield-on-light.png`, trimmed, 128px tall | shield alone on light backgrounds (Role 2's page card) |
| `mark-cream.png` | `icon/kavach-shield-on-dark.png`, trimmed, 128px tall | shield alone on dark backgrounds |

From a content script: `chrome.runtime.getURL("sidepanel/brand/mark-dark.png")` (allowed on all sites in manifest.json).

Slides / Devpost / video: use the kit directly: `logo/`, `devpost/kavach-thumbnail-3x2.png`, `backdrop/`.
Kit rules: full logo wherever there's room; shield alone only in square spots; no recoloring, glows or outlines.
