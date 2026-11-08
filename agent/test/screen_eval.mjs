// /api/screen against the LIVE server: 5 scams + 3 safe emails, masked on the device first (like detect.js).
// Run: node agent/test/screen_eval.mjs          (SERVER=http://localhost:8788 to use another server)
// Pass = every scam is "scam" or "suspicious" (card shows) AND every safe email is "safe" (no card).
import { mask } from "../../core/mask.js";

const SERVER = process.env.SERVER || "http://localhost:8787";
const CASES = [
  { want: "flag", text: "I need your cvc and credit card number" },
  { want: "flag", text: "USCIS NOTICE: Your green card application EAC2190012345 has been suspended. Call 214-555-0199 within 24 hours and pay the $450 fee with Google Play gift cards or ICE officers will come to your home." },
  { want: "flag", text: "IRS Final Warning: You owe back taxes. A warrant for your arrest will be issued today unless you send payment in Bitcoin to the wallet below. Do not tell anyone." },
  { want: "flag", text: "Social Security Administration: your SSN has been suspended due to suspicious activity. Reply with your full Social Security number and date of birth to reactivate it." },
  { want: "flag", text: "Your bank account is locked. Verify now at http://chase-secure-login.co/verify and enter the 6-digit code we just texted you." },
  { want: "safe", text: "U.S. Citizenship and Immigration Services\nAppointment Notice\nYour biometrics appointment is scheduled at the Dallas Application Support Center on November 20 at 9:00 AM. Bring this notice and your photo ID. To reschedule, sign in to your USCIS online account at uscis.gov. USCIS will never ask you to pay by gift card." },
  { want: "safe", text: "Hi mom, I landed safe. Call you tonight." },
  { want: "safe", text: "Hi team, the project meeting moved to Thursday at 3pm. Please bring your updated slides. Thanks, Priya" }
];

let right = 0;
const times = [];
for (const c of CASES) {
  const t0 = Date.now();
  let verdict = "ERROR", reason = "";
  try {
    const r = await fetch(SERVER + "/api/screen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: mask(c.text).masked }),
      signal: AbortSignal.timeout(7000)
    });
    const j = await r.json();
    verdict = j.verdict || `HTTP ${r.status} ${j.error}`;
    reason = j.reason || "";
  } catch (e) {
    verdict = "ERROR " + e.name;
  }
  const ms = Date.now() - t0;
  times.push(ms);
  const ok = c.want === "flag" ? verdict === "scam" || verdict === "suspicious" : verdict === "safe";
  if (ok) right++;
  const noDigits = !/\d|https?:/.test(reason);
  console.log(`${ok && noDigits ? "✅" : "❌"} ${String(ms).padStart(5)}ms ${c.want.padEnd(4)} → ${verdict.padEnd(10)} ${c.text.slice(0, 40).replace(/\n/g, " ")}… | ${reason}${noDigits ? "" : "  (NUMBER/LINK IN REASON)"}`);
}
times.sort((a, b) => a - b);
console.log(`accuracy ${right}/${CASES.length} · median ${times[Math.floor(times.length / 2)]}ms · max ${times[times.length - 1]}ms`);
process.exit(right === CASES.length ? 0 : 1);
