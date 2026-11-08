// sidepanel/float.js — Role 1 (UI). Injected into the page by background.js (chrome.scripting).
// Shows Kavach as a floating panel over the page (like macOS Control Center), instead of the side panel.
// The panel itself is sidepanel/sidepanel.html?float=1 in an iframe, so all features stay the same.
// Closes with its ✕, the Esc key, or a click anywhere outside it. Running this again just keeps it open.

(() => {
  const ID = "kavach-float-host";
  if (document.getElementById(ID)) return; // already open: the panel picks up the new check by itself

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
        transition: height 180ms ease;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 26px;
        overflow: hidden;
        background: rgba(242, 242, 245, 0.82);
        -webkit-backdrop-filter: blur(28px) saturate(1.6);
        backdrop-filter: blur(28px) saturate(1.6);
        box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.35), 0 6px 16px -4px rgba(0, 0, 0, 0.16);
        transform-origin: top right;
        animation: kv-open 220ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .frame.closing { animation: kv-close 160ms ease-in forwards; }
      iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: light; }
      @keyframes kv-open { from { opacity: 0; transform: scale(0.94) translateY(-8px); } }
      @keyframes kv-close { to { opacity: 0; transform: scale(0.96) translateY(-6px); } }
      @media (prefers-reduced-motion: reduce) { .frame, .frame.closing { animation: none; transition: none; } }
    </style>
    <div class="frame" role="dialog" aria-label="Kavach">
      <iframe allow="microphone; autoplay; clipboard-write" title="Kavach"></iframe>
    </div>`;
  const frame = root.querySelector(".frame");
  const iframe = root.querySelector("iframe");
  iframe.src = panelUrl;

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    removeEventListener("keydown", onKey, true);
    removeEventListener("mousedown", onOutside, true);
    removeEventListener("message", onMessage);
    frame.classList.add("closing");
    setTimeout(() => host.remove(), 170);
  }
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const onOutside = (e) => { if (!e.composedPath().includes(host)) close(); };
  // Messages from the panel (only from our own iframe).
  const onMessage = (e) => {
    if (e.source !== iframe.contentWindow || e.origin !== origin) return;
    if (e.data?.kavach === "close") close();
    if (e.data?.kavach === "size" && Number.isFinite(e.data.height)) {
      frame.style.height = `${Math.min(Math.max(e.data.height, 160), innerHeight - 24)}px`;
    }
  };

  addEventListener("keydown", onKey, true);
  addEventListener("mousedown", onOutside, true);
  addEventListener("message", onMessage);
  (document.body || document.documentElement).append(host);
})();
