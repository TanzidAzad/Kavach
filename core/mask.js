// core/mask.js — Role 2 (Core Engine)
// mask(text)  → { masked, map }   e.g. "EAC1234567890" → "[RECEIPT_1]"
// unmask(placeholder, map) → the real value, looked up locally.
// SKELETON STUB: returns the text unchanged with an empty map.
// Real version patterns: USCIS receipt, A-number (A\d{8,9}), US phone, email, SSN.

export function mask(text) {
  return { masked: text ?? "", map: {} };
}

export function unmask(placeholder, map = {}) {
  return Object.prototype.hasOwnProperty.call(map, placeholder) ? map[placeholder] : placeholder;
}
