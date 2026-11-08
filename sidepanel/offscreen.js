// sidepanel/offscreen.js — Role 1 (UI). Runs in a hidden "offscreen document" that background.js opens.
// Web pages often block sound until the user clicks; this hidden extension page isn't blocked.
const ping = new Audio(chrome.runtime.getURL("sidepanel/sound/ping.wav"));
ping.volume = 0.6; // noticeable, not startling

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "KAVACH_PING" || msg.target !== "offscreen") return;
  ping.currentTime = 0;
  ping.play().then(
    () => sendResponse({ played: true }),
    (err) => sendResponse({ played: false, error: String(err?.message || err) })
  );
  return true;
});
