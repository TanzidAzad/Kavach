# For Role 2: card restyle + drag (same look and feel as the floating Kavach panel)

1. Replace `content/detect.css` with `sidepanel/handoff/detect.css` (whole file).
   Liquid glass card, glassy buttons with a springy press, glass lightens under the mouse.
2. Make the card draggable by its header: paste `sidepanel/handoff/card-drag.js` into `content/detect.js` → `showCard()`,
   right after `head.append(close, logo, "Kavach");` (it uses the `head`, `card` and `box` variables already there).
