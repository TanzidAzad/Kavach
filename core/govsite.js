// core/govsite.js — "Is the page the user is ON a real U.S. government website?"
//
// Real government pages (reportfraud.ftc.gov, uscis.gov/scams…) are full of scam words ("gift card",
// "arrest", "fraud"), so checking their TEXT gives false alarms. Only the U.S. government can register
// .gov / .mil addresses, so when the LIVE PAGE's own address is .gov / .mil (or one of the websites in
// data/official_contacts.json), Kavach skips the text check and says "not a scam".
//
// Use this ONLY for the address of the page the user is on (location.hostname / the tab's URL).
// Never for links found inside a message: a pasted email that mentions irs.gov is still checked as usual.
//
//   checkGovSite(urlOrHost) → Promise<{ verified: boolean, host: string, reason: string }>
//   isGovHost(host)         → true for *.gov / *.mil (no data needed, synchronous)
//   govSiteVerdict(host)    → a Verdict (PRD 8.2): safe, reason "This is a real U.S. government website…"

import { loadData } from "./data.js";

export function hostOf(input) {
  let s = String(input ?? "").trim();
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return "";
    return u.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

export function isGovHost(host) {
  const h = String(host ?? "").toLowerCase().replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(gov|mil)$/.test(h) && !h.split(".").some((p) => p.startsWith("xn--"));
}

const sameOrSub = (host, domain) => host === domain || host.endsWith("." + domain);

export async function checkGovSite(urlOrHost) {
  const host = hostOf(urlOrHost);
  if (!host) return { verified: false, host: "", reason: "" };
  const tld = host.endsWith(".mil") ? ".mil" : ".gov";
  if (isGovHost(host)) {
    return { verified: true, host, reason: `This is a real U.S. government website (ends in ${tld}).` };
  }
  try {
    const contacts = await loadData("official_contacts.json");
    for (const c of contacts || []) {
      const d = hostOf(c?.url).replace(/^www\./, "");
      if (d && sameOrSub(host, d)) {
        return { verified: true, host, reason: `This is the official ${c.agency} website.` };
      }
    }
  } catch {
    // data not readable → only the .gov/.mil rule applies
  }
  return { verified: false, host, reason: "" };
}

export function govSiteVerdict(site) {
  const reason = site?.reason || "This is a real U.S. government website (ends in .gov).";
  return {
    verdict: "safe",
    confidence: "high",
    reasons: [reason, "Kavach does not check the words on real government websites."],
    steps: ["If a message sent you here, you can still paste that message into Kavach to check it."],
    officialContact: null,
    trace: [{ tool: "check_gov_site", status: "pass", label: "Website address", detail: reason }],
    mode: "quick",
    govSite: true,
    familyMessage: ""
  };
}
