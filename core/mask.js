// core/mask.js — Role 2 (Core Engine)
// Hides personal details before Deep Check sends text to Nemotron.
//
//   mask(text)               → { masked, map }
//       "Case EAC1234567890, call 214-555-0123"
//       → masked: "Case [RECEIPT_1], call [PHONE_1]"
//         map:    { "[RECEIPT_1]": "EAC1234567890", "[PHONE_1]": "214-555-0123" }
//   unmask(placeholder, map) → the real value, looked up locally (never sent anywhere).
//       Also works on a longer string that contains placeholders.
//   unmaskArgs(args, map)    → same, for a whole tool-call arguments object (helper for Role 3).
//
// The same value always gets the same placeholder.
// Order matters: emails and case numbers are replaced first so their digits
// aren't mistaken for phone numbers or SSNs.

const PATTERNS = [
  // email address
  { kind: "EMAIL", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  // USCIS receipt: EAC1234567890 or EAC-12-345-67890
  { kind: "RECEIPT", re: /\b[A-Z]{3}[-\s]?\d{2}[-\s]?\d{3}[-\s]?\d{5}\b/gi },
  // anything written after "case/caso/receipt…" that contains a digit, even if the format is wrong
  {
    kind: "RECEIPT",
    re: /(?:case|caso|receipt|recibo|expediente|केस|मामला|案件|案号|申请号|回执)\s*(?:number|no\.?|n[úu]mero|nº|#|号码|号|नंबर|संख्या)?\s*(?:is|es|:|：|#|-)?\s*([A-Z0-9][A-Z0-9-]{2,})/gi,
    group: 1,
    needsDigit: true
  },
  // A-number written with keyword: "A-Number: 123456789"
  {
    kind: "ANUM",
    re: /(?:a-?number|alien (?:registration )?number|n[úu]mero a|n[úu]mero de extranjero)\s*[:#]?\s*(A?[-\s]?\d{8,9})\b/gi,
    group: 1
  },
  // A-number on its own: A123456789, A-12345678
  { kind: "ANUM", re: /\bA[-\s#]?\d{8,9}\b/gi },
  // Social Security number: 123-45-6789
  { kind: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // SSN written with keyword: "SSN 123456789", "seguro social: 123 45 6789"
  {
    kind: "SSN",
    re: /(?:ssn|social security(?: number)?|seguro social)\s*(?:#|no\.?|number|n[úu]mero)?\s*[:#]?\s*(\d{3}[-\s]?\d{2}[-\s]?\d{4})\b/gi,
    group: 1
  },
  // US phone: (214) 555-0123, 214-555-0123, 214.555.0123, +1 214 555 0123, 2145550123
  { kind: "PHONE", re: /(?<![\w])(?:\+?1[-.\s]?)?(?:\(\d{3}\)\s?|\d{3}[-.\s]?)\d{3}[-.\s]?\d{4}(?!\d)/g }
];

const PLACEHOLDER_RE = /\[[A-Z]+_\d+\]/g;

export function mask(text) {
  let masked = String(text ?? "");
  const map = {};
  const byValue = new Map(); // real value → placeholder, so repeats reuse one label
  const counts = {};

  const placeholderFor = (kind, value) => {
    const key = `${kind}:${value}`;
    if (!byValue.has(key)) {
      counts[kind] = (counts[kind] || 0) + 1;
      const ph = `[${kind}_${counts[kind]}]`;
      byValue.set(key, ph);
      map[ph] = value;
    }
    return byValue.get(key);
  };

  for (const { kind, re, group, needsDigit } of PATTERNS) {
    masked = masked.replace(re, (match, ...rest) => {
      const value = group ? rest[group - 1] : match;
      if (!value || /^\[[A-Z]+_\d+\]$/.test(value)) return match; // already masked
      if (needsDigit && !/\d/.test(value)) return match;
      const ph = placeholderFor(kind, value);
      if (!group) return ph;
      const at = match.lastIndexOf(value);
      return match.slice(0, at) + ph + match.slice(at + value.length);
    });
  }

  return { masked, map };
}

export function unmask(placeholder, map = {}) {
  if (typeof placeholder !== "string") return placeholder;
  if (Object.prototype.hasOwnProperty.call(map, placeholder)) return map[placeholder];
  return placeholder.replace(PLACEHOLDER_RE, (ph) =>
    Object.prototype.hasOwnProperty.call(map, ph) ? map[ph] : ph
  );
}

// Unmasks every string inside a tool-call arguments object (or array).
// e.g. { caseNumber: "[RECEIPT_1]" } → { caseNumber: "EAC1234567890" }
export function unmaskArgs(args, map = {}) {
  if (typeof args === "string") return unmask(args, map);
  if (Array.isArray(args)) return args.map((a) => unmaskArgs(a, map));
  if (args && typeof args === "object") {
    return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, unmaskArgs(v, map)]));
  }
  return args;
}
