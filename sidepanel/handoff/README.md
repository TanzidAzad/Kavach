# For Role 2: card restyle (same look as the floating Kavach panel)

Replace `content/detect.css` with `sidepanel/handoff/detect.css` (whole file). That's all.

- Frosted glass card, message in a white rounded tile, pill buttons (dark "Check it", white "Talk to Kavach").
- Your ✕ (class `close`) becomes a round white button on the **right** of the header, matching the floating
  panel's ✕. No JS change needed: the CSS places it with `order: 3`.
