    // ---- Drag the card by its header (anywhere except the ✕). Paste right after `head.append(close, logo, "Kavach");`
    // Moves the shadow host with the CSS "translate" property and stays inside the window.
    // While dragging, it listens on the whole page so a fast mouse move can't "lose" the card.
    let drag = null;
    const onMove = (e) => {
      if (!drag) return;
      const r = card.getBoundingClientRect();
      const [cx = 0, cy = 0] = (box.style.translate || "0px 0px").split(" ").map(parseFloat);
      const homeLeft = r.left - cx, homeTop = r.top - cy; // where it sits with no drag
      const x = Math.min(Math.max(drag.x0 + e.clientX - drag.sx, 8 - homeLeft), innerWidth - 8 - r.width - homeLeft);
      const y = Math.min(Math.max(drag.y0 + e.clientY - drag.sy, 8 - homeTop), innerHeight - 8 - r.height - homeTop);
      box.style.translate = `${x}px ${y}px`;
      e.preventDefault();
    };
    const onUp = () => {
      drag = null;
      card.classList.remove("dragging");
      removeEventListener("pointermove", onMove, true);
      removeEventListener("pointerup", onUp, true);
      removeEventListener("pointercancel", onUp, true);
    };
    head.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      const [x0 = 0, y0 = 0] = (box.style.translate || "0px 0px").split(" ").map(parseFloat);
      drag = { sx: e.clientX, sy: e.clientY, x0, y0 };
      card.classList.add("dragging");
      addEventListener("pointermove", onMove, true);
      addEventListener("pointerup", onUp, true);
      addEventListener("pointercancel", onUp, true);
      e.preventDefault();
    });
