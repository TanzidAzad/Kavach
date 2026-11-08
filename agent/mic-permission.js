// agent/mic-permission.js — Role 3. The side panel / popup can't show Chrome's microphone prompt, so voice.js
// opens this page in a normal tab once. Permission is per extension, so after "Allow" the side panel can use the
// mic too. We tell voice.js over a BroadcastChannel and close the tab.
const $ = (id) => document.getElementById(id);
const bc = new BroadcastChannel("kavach-mic");

async function ask() {
  $("status").textContent = "Waiting for you to click Allow…";
  $("status").className = "";
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    bc.postMessage({ granted: true });
    $("status").textContent = "Done ✓ You can go back to Kavach and talk.";
    $("status").className = "ok";
    $("allow").hidden = true;
    setTimeout(() => window.close(), 1500);
  } catch (e) {
    const blocked = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
    $("status").innerHTML = "";
    const msg = document.createElement("span");
    msg.textContent = e && e.name === "NotFoundError"
      ? "No microphone was found. Kavach can still speak to you."
      : blocked
        ? "The microphone is blocked. Click the icon at the left of the address bar, set Microphone to Allow, then click the button again."
        : "Something went wrong. Please try again.";
    $("status").append(msg);
    $("status").className = "bad";
    if (!blocked) bc.postMessage({ granted: false });
  }
}

$("allow").addEventListener("click", ask);
ask(); // a normal tab can show the prompt right away
