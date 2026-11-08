# For Role 2: card restyle (same look as the floating Kavach panel)

1. Replace `content/detect.css` with `sidepanel/handoff/detect.css` (whole file).
2. In `content/detect.js` → `showCard()`: replace the "Not now" link with a round ✕ in the header:

```js
// was: head.append(logo, "Kavach");
const close = button("✕", "close", () => { hideCard(); onDone?.(); });
close.setAttribute("aria-label", "Close");
head.append(logo, "Kavach", close);

// delete the notNow button, and change:
// card.append(head, msg, actions, notNow);
card.append(head, msg, actions);
```
(`button()` is the helper already in showCard; move these lines below where it's defined.)
The ✕ does exactly what "Not now" did. `cardNotNow` in ui_strings.json is no longer used.
