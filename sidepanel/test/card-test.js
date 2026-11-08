// sidepanel/test/card-test.js — Role 1 (UI). TEST ONLY, runs on https://example.com.
// Shows a small card with two buttons that send KAVACH_CHECK exactly like Role 2's
// content/detect.js card will. Used to prove the side panel can open from a click on a web page.
// Remove from manifest.json once content/detect.js is in.

(() => {
  const card = document.createElement("div");
  card.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:12px 14px;border:1px solid #dadce0;" +
    "border-radius:14px;background:#fff;color:#202124;font:16px system-ui,sans-serif;display:flex;gap:8px;align-items:center";
  card.textContent = "Kavach test card ";

  const make = (text, mode) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.cssText = "padding:8px 12px;border:0;border-radius:999px;background:#202124;color:#fff;font:inherit;cursor:pointer";
    b.addEventListener("click", () => {
      chrome.runtime.sendMessage(
        {
          type: "KAVACH_CHECK",
          mode,
          url: location.href,
          text: "USCIS: Your case IOE1234567 is suspended. Pay $500 in Google Play gift cards today or you will be deported. WhatsApp +1 555 010 0199."
        },
        (res) => {
          const ok = res?.opened;
          console.log("[Kavach test] side panel opened from page click:", ok);
          result.textContent = ok ? "✓ opened" : "✗ blocked → fallback";
        }
      );
    });
    return b;
  };

  const result = document.createElement("span");
  card.append(make("Check", "check"), make("Talk", "talk"), result);
  document.documentElement.append(card);
})();
