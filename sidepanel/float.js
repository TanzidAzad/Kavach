// sidepanel/float.js — Role 1 (UI). Injected into the page by background.js (chrome.scripting).
// Shows Kavach as a floating panel over the page (like macOS Control Center), instead of the side panel.
// The panel itself is sidepanel/sidepanel.html?float=1 in an iframe, so all features stay the same.
// Closes with its ✕, the Esc key, or a click anywhere outside it. Running this again just keeps it open.

(() => {
  const ID = "kavach-float-host";
  const toggle = window.__kavachToggle === true; // Kavach icon clicked: a second click closes it
  window.__kavachToggle = false;
  if (document.getElementById(ID)) {
    if (toggle) window.__kavachClose?.();
    return; // already open: the panel picks up a new check by itself
  }

  const panelUrl = chrome.runtime.getURL(`sidepanel/sidepanel.html?float=1&vh=${innerHeight - 24}`);
  const origin = new URL(panelUrl).origin;

  const host = document.createElement("div");
  host.id = ID;
  // Closed shadow root: the page's CSS can't touch us, and ours can't touch the page.
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .frame {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 2147483647;
        width: min(400px, calc(100vw - 24px));
        height: min(320px, calc(100vh - 24px)); /* grows to fit the panel's content */
        max-height: calc(100vh - 24px);
        transition: height 260ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 250ms ease, box-shadow 200ms ease;
        border: 1px solid rgba(255, 255, 255, 0.55);
        border-radius: 28px;
        overflow: hidden;
        /* Liquid glass: see-through, strongly blurred, with a bright top edge */
        background: rgba(244, 244, 248, 0.5);
        -webkit-backdrop-filter: blur(36px) saturate(1.9);
        backdrop-filter: blur(36px) saturate(1.9);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.8),
          inset 0 0 0 1px rgba(255, 255, 255, 0.25),
          0 24px 60px -12px rgba(0, 0, 0, 0.35),
          0 6px 16px -4px rgba(0, 0, 0, 0.14);
        transform-origin: top right;
        will-change: transform, opacity;
        animation: kv-open 380ms cubic-bezier(0.34, 1.4, 0.64, 1);
      }
      .frame:hover { background: rgba(250, 250, 253, 0.58); }  /* the glass lightens under the mouse */
      .frame.dragging { transition: none; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 32px 70px -12px rgba(0, 0, 0, 0.4), 0 8px 20px -4px rgba(0, 0, 0, 0.16); }
      .frame.closing { animation: kv-close 180ms cubic-bezier(0.4, 0, 1, 1) forwards; }
      iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: light; }
      @keyframes kv-open { from { opacity: 0; transform: scale(0.9) translateY(-10px); } 60% { opacity: 1; } }
      @keyframes kv-close { to { opacity: 0; transform: scale(0.94) translateY(-8px); } }
      @media (prefers-reduced-motion: reduce) { .frame, .frame.closing { animation: none; transition: none; } }
    </style>
    <div class="frame" role="dialog" aria-label="Kavach">
      <iframe allow="microphone; autoplay; clipboard-write" title="Kavach"></iframe>
    </div>`;
  const frame = root.querySelector(".frame");
  const iframe = root.querySelector("iframe");
  iframe.src = panelUrl;

  let closed = false;
  let pos = { x: 0, y: 0 };  // how far the user dragged the panel
  let start = null;          // pos when the current drag began

  // Move the frame with the CSS "translate" property (doesn't fight the open/close animations,
  // which use "transform"), kept inside the window.
  function startDrag(sx, sy) {
    start = { sx, sy, x: pos.x, y: pos.y };
    frame.classList.add("dragging");
    addEventListener("pointermove", onPageMove, true);
    addEventListener("pointerup", onPageUp, true);
  }
  function moveTo(screenX, screenY) {
    if (!start) return;
    const r = frame.getBoundingClientRect();
    const homeLeft = r.left - pos.x, homeTop = r.top - pos.y; // where it sits with no drag
    const x = Math.min(Math.max(start.x + screenX - start.sx, 8 - homeLeft), innerWidth - 8 - r.width - homeLeft);
    const y = Math.min(Math.max(start.y + screenY - start.sy, 8 - homeTop), innerHeight - 48 - homeTop);
    pos = { x, y };
    frame.style.translate = `${x}px ${y}px`;
  }
  function endDrag(tellPanel) {
    if (!start) return;
    start = null;
    frame.classList.remove("dragging");
    removeEventListener("pointermove", onPageMove, true);
    removeEventListener("pointerup", onPageUp, true);
    if (tellPanel) iframe.contentWindow?.postMessage({ kavach: "drag-ended" }, origin);
  }
  const onPageMove = (e) => moveTo(e.screenX, e.screenY);
  const onPageUp = () => endDrag(true);
  function close() {
    if (closed) return;
    closed = true;
    removeEventListener("keydown", onKey, true);
    removeEventListener("mousedown", onOutside, true);
    removeEventListener("message", onMessage);
    endDrag(false);
    frame.classList.add("closing");
    setTimeout(() => host.remove(), 190);
  }
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const onOutside = (e) => { if (!e.composedPath().includes(host)) close(); };
  // Messages from the panel (only from our own iframe).
  const onMessage = (e) => {
    if (e.source !== iframe.contentWindow || e.origin !== origin) return;
    if (e.data?.kavach === "close") close();
    // Dragging by the panel's top bar. Moves come from the panel (mouse over it) or from this page
    // (mouse left it on a fast move); both are in screen coordinates, so they agree.
    if (e.data?.kavach === "drag-start" && Number.isFinite(e.data.sx)) startDrag(e.data.sx, e.data.sy);
    if (e.data?.kavach === "drag-move" && start) moveTo(start.sx + e.data.dx, start.sy + e.data.dy);
    if (e.data?.kavach === "drag-end") endDrag(false);
    if (e.data?.kavach === "size" && Number.isFinite(e.data.height)) {
      frame.style.height = `${Math.min(Math.max(e.data.height, 160), innerHeight - 24)}px`;
    }
  };

  window.__kavachClose = close;
  addEventListener("keydown", onKey, true);
  addEventListener("mousedown", onOutside, true);
  addEventListener("message", onMessage);
  (document.body || document.documentElement).append(host);
})();
