// core/tools.js — Role 2 (Core Engine)
// Contract: PRD section 8.1 (ToolResult) and 8.3 (function names).
// SKELETON STUBS: each function returns a fixed mock ToolResult so other roles
// can build against the contract. Replace the bodies with real logic.
//
// Callers should `await` every tool. Most are synchronous today, but
// checkDomainAge needs the network, and real versions may load data/ JSON.

// ToolResult shape (8.1):
// { tool, status: "fail" | "pass" | "unknown", label, detail, source? }

export function checkOfficialContact({ claimedAgency, channel, paymentMethod } = {}) {
  return {
    tool: "check_official_contact",
    status: "fail",
    label: "Sender channel",
    detail: "USCIS does not contact people on WhatsApp",
    source: "https://www.uscis.gov/"
  };
}

export function validateCaseNumber(caseNumber) {
  return {
    tool: "validate_case_number",
    status: "fail",
    label: "Case number",
    detail: "Invalid format (needs 3 letters + 10 digits)",
    source: "https://www.uscis.gov/"
  };
}

export function checkLookalikeDomain(url) {
  return {
    tool: "check_lookalike_domain",
    status: "pass",
    label: "Website link",
    detail: "No lookalike government website found"
  };
}

export function findRedFlags(text, lang = "en") {
  return {
    tool: "find_red_flags",
    status: "fail",
    label: "Payment",
    detail: "Asks for payment with gift cards"
  };
}

export function searchGuidance(query) {
  return {
    tool: "search_guidance",
    status: "fail",
    label: "Official guidance",
    detail: "USCIS will never ask for payment by gift card",
    source: "https://www.uscis.gov/"
  };
}

// STRETCH — needs internet (RDAP).
export async function checkDomainAge(url) {
  return {
    tool: "check_domain_age",
    status: "unknown",
    label: "Website age",
    detail: "Could not check how old the website is"
  };
}
