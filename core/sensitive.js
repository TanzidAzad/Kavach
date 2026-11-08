// core/sensitive.js — Role 2 (Core Engine)
// Finds messages that ASK for private details: card number, CVC/CVV, card PIN,
// card expiry date, Social Security number, bank account/routing number,
// password / online-banking login, one-time / verification code.
// Works in English, Spanish, Hindi and Chinese. Offline, no data files needed.
//
//   findSensitiveRequests(text) → [{ id, label }]   (one entry per KIND asked for)
//   checkSensitiveInfo(text)    → Promise<ToolResult> (PRD 8.1), tool "check_sensitive_info"
//
// Scoring (done in quickcheck.js): each kind asked for = 1 warning sign,
// so 1 kind → at least "suspicious", 2+ kinds → "scam / high".
//
// To keep false alarms low, an item only counts when:
//   1. an "asking" word is in the same sentence or the 4 sentences before it
//      ("send", "need", "envíe", "भेजें", "提供"…), AND
//   2. that sentence is not a warning like "we will NEVER ask for your PIN", AND
//   3. the item isn't just being shown to you ("your code is 482913", "card ending 1234").

// ---------- what counts as a private detail ----------

// Each kind: English label (used in the reason) + patterns in all 4 languages.
const KINDS = [
  {
    id: "card_number",
    label: "card number",
    patterns: [
      /\b(?:credit|debit|bank|atm)?\s?card\s?(?:number|no\.?|#|details|info(?:rmation)?|digits)/i,
      /\byour (?:credit|debit|bank|atm) card\b/i,
      /\b16[- ]digit/i,
      /n[úu]mero de (?:la |su |tu )?tarjeta|(?:datos|informaci[oó]n) de (?:la |su |tu )?tarjeta|(?:su|tu) tarjeta de (?:cr[eé]dito|d[eé]bito)/i,
      /कार्ड (?:नंबर|नम्बर|संख्या|की जानकारी|का नंबर|डिटेल)|क्रेडिट कार्ड|डेबिट कार्ड/,
      /卡号|信用卡|银行卡信息|借记卡/
    ]
  },
  {
    id: "cvc",
    label: "CVC/CVV code",
    patterns: [
      /\b(?:cvc|cvv|csc)2?\b/i,
      /card security code|security code on the (?:back|card)|\b(?:3|three)[- ]digit (?:security )?(?:code|number)|(?:numbers|digits) on the back/i,
      /c[oó]digo de seguridad de (?:la |su |tu )?tarjeta|(?:3|tres) d[ií]gitos (?:de atr[aá]s|del reverso)/i,
      /सीवीवी|सीवीसी/,
      /安全码|背面.{0,4}(?:三位|3位)/
    ]
  },
  {
    id: "pin",
    label: "card PIN",
    patterns: [
      /\bPIN\b/, // capital letters only, so "pin the message" doesn't count
      /\b(?:pin (?:number|code)|(?:atm|card|debit) pin)\b/i,
      /\bNIP\b|clave (?:de (?:la |su |tu )?tarjeta|del cajero)/i,
      /पिन/,
      /PIN码|取款密码|银行卡密码|卡密码|支付密码/i
    ]
  },
  {
    id: "expiry",
    label: "card expiry date",
    needsCard: true, // "passport expiration date" is fine; only card expiry counts
    patterns: [
      /\b(?:expiration|expiry|exp\.?) date\b|\bexpiry\b|\bmm\s?\/\s?yy\b/i,
      /fecha de (?:vencimiento|expiraci[oó]n|caducidad)/i,
      /एक्सपायरी|समाप्ति (?:तिथि|तारीख)/,
      /有效期|到期日|过期日/
    ]
  },
  {
    id: "ssn",
    label: "Social Security number",
    patterns: [
      /\bsocial security (?:number|no\.?|#)|\bssn\b|\bss ?#/i,
      /\byour social security\b(?! (?:benefits?|administration|office|payments?|account|statement|check))/i,
      /n[úu]mero de(?:l)? seguro social/i,
      /सोशल सिक्योरिटी (?:नंबर|नम्बर)|सामाजिक सुरक्षा (?:संख्या|नंबर)|एसएसएन/,
      /社会安全号|社安号|社会保障号|社保号/
    ]
  },
  {
    id: "bank",
    label: "bank account details",
    patterns: [
      /\b(?:bank )?account (?:number|no\.?|#)|\brouting (?:number|no\.?|#)|\baba number\b/i,
      /\bbank (?:details|info(?:rmation)?|account(?! statement)|login|credentials)\b/i,
      /n[úu]mero de (?:su |tu |la )?cuenta|cuenta bancaria|datos bancarios|n[úu]mero de ruta|\bclabe\b/i,
      /(?:खाता|अकाउंट|एकाउंट) (?:संख्या|नंबर|नम्बर)|बैंक खाता|बैंक अकाउंट|बैंक डिटेल|रूटिंग नंबर|IFSC/,
      /银行账号|银行账户|账户号码|帐号|账号|路由号|银行信息/
    ]
  },
  {
    id: "password",
    label: "password or online banking login",
    patterns: [
      /\bpassword\b|\bpasscode\b/i,
      /\b(?:online|internet|mobile) banking (?:login|password|credentials|details|username)|\blog-?in (?:details|credentials|info(?:rmation)?)|\busername and password|\bsign-?in (?:details|credentials)/i,
      /contrase[ñn]a|clave de acceso|usuario y clave|datos de acceso/i,
      /पासवर्ड|पासकोड|लॉगिन (?:डिटेल|जानकारी)/,
      /(?<!一次性|取款|卡|支付)密码|登录信息|网银/
    ]
  },
  {
    id: "otp",
    label: "one-time verification code",
    otp: true, // "enter the code" is normal for sign-in codes; only "give it to us" counts
    patterns: [
      /\b(?:one[- ]time|verification|(?<!card )security|confirmation|authentication|2fa|two[- ]factor|login|access|sms)\s?(?:pass)?code\b/i,
      /\botp\b|\bone[- ]time (?:password|pin)\b|\b(?:4|5|6|8|four|five|six|eight)[- ]digit (?:code|number)\b/i,
      /\bcode (?:that )?(?:we|i|you) (?:just )?(?:sent|texted|received|got)\b/i,
      /c[oó]digo (?:de )?(?:verificaci[oó]n|confirmaci[oó]n|acceso|un solo uso)|c[oó]digo de seguridad(?! de (?:la |su |tu )?tarjeta)|c[oó]digo que (?:le |te )?(?:enviamos|envi[eé]|lleg[oó])/i,
      /ओटीपी|वेरिफिकेशन कोड|सत्यापन कोड/,
      /验证码|动态码|校验码|短信码|一次性密码/
    ]
  }
];

// Phrases that contain the words above but are NOT private details.
// "Green Card number" is a USCIS document, "gift card" is caught by the payment rules,
// "USCIS online account number" and "IP PIN" are normal on real government sites.
const NOT_SENSITIVE = [
  /green\s?card|tarjeta verde|ग्रीन कार्ड|绿卡/gi,
  /gift\s?cards?|tarjetas? de regalo|गिफ्ट कार्ड|礼品卡|购物卡/gi,
  /online account (?:number|no\.?|#)/gi,
  /\b(?:ip pin|identity protection pin)\b/gi,
  /social security card/gi
];

// Card context for the expiry date ("card expiry" yes, "passport expiry" no).
const CARD_WORD = /\bcard\b|tarjeta|कार्ड|卡/i;

// ---------- asking vs. warning ----------

// "Asking" words. GIVE = asking you to hand it over. ENTER = asking you to type it somewhere.
const GIVE_CUES = [
  /\b(?:need|needs|needed|require[sd]?|send|sent me|provide|give|share|tell|reply|respond|forward|read (?:me|out|it)|text (?:me|us|it|back)|let (?:me|us) know|what(?:'s| is| are) (?:your|the)|i want|we want)\b/i,
  /\benv[ií](?:e|ar|ame|enos)\b|\bm[aá]nd(?:e|ame|enos|ar)\b|\bd[eé]me\b|\bdame\b|\bd[eé]nos\b|\bproporcion(?:e|ar|ar[nm]e)\b|\bnecesit(?:o|amos|a|an)\b|\bfacilite\b|\bindique\b|\brespond(?:a|er)\b|\bcompart(?:a|ir)\b|\bd[ií]ga(?:me|nos)\b|\bcu[aá]l es (?:su|tu)\b|\bp[aá]se(?:me|nos)\b|\breenv[ií]e\b|\brequer/i,
  /भेज|बता|दें|दीजिए|दीजिये|चाहिए|शेयर|प्रदान|दे दो|दो।/,
  /提供|发送|发给|发我|告诉|需要|回复|报给|给我|说一下|是多少/
];
const ENTER_CUES = [
  /\b(?:enter|type|input|confirm|verify|update|submit|fill (?:in|out)|complete|re-?enter|validate)\b/i,
  /\bingres(?:e|ar)\b|\bintroduzca\b|\bescrib(?:a|ir)\b|\bconfirm(?:e|ar)\b|\bverifi(?:que|car)\b|\bactualic(?:e|ar)\b|\bcomplete\b/i,
  /डालें|दर्ज|कन्फर्म|पुष्टि|वेरिफाई|अपडेट|लिखें/,
  /输入|填写|确认|验证|核实|提交|更新/
];

// Warnings and reassurance: "IRS will never ask for…", "no comparta su NIP", "请勿泄露验证码".
const NEGATIONS = [
  /\bnever\b/i,
  /\b(?:not|n't)\s+(?:\w+\s+){0,3}?(?:ask|request|initiate|share|give|send|disclose|reveal|provide|tell|reply|respond|contact|call|email|text|need|require)/i,
  /\bno one\b|\bnobody\b|\bbeware\b|\bkeep (?:it|this|them|your \w+(?: \w+)?) (?:private|secret|safe)\b/i,
  /\bnunca\b|\bjam[aá]s\b|\bnadie\b|\bno (?:le |te |les )?(?:pedir|pide|pedimos|solicit|compart|env[ií]|d[eé]|proporcion|respond|revele)/i,
  /कभी नहीं|कभी भी|न दें|ना दें|न बताएं|न बताएँ|मत |नहीं मांग|नहीं माँग|नहीं पूछ|किसी को भी|किसी के साथ/,
  /不会|绝不|从不|不要|切勿|请勿|千万别|勿|不得|任何人/
];

// The detail is being SHOWN, not asked for: "code is 482913", "account number ending 1234", "123456 is your code".
const VALUE_AFTER = /^\s*(?:is|was|are|:|：|#|es|是|为|है)?\s*(?:[\d*xX•·]{3,}|[A-Z]{2,3}\d)|^\s*(?:ending|ends|que termina|terminad[ao])\b/i;
const VALUE_BEFORE = /\d{4,}\s*(?:is|es|是|为)?\s*(?:your|su|tu|您的|你的)?\s*$|尾号\s*\d*\s*$/i;

// Split into sentences / lines (also the Hindi "।" and Chinese "。").
function segments(text) {
  return String(text ?? "")
    .split(/[.!?。！？;；।\n]+|\s-\s/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const any = (list, s) => list.some((re) => re.test(s));

// True if the pattern appears in the segment as a REQUEST (not followed/preceded by its value).
function asksFor(re, seg) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const m of seg.matchAll(g)) {
    const after = seg.slice(m.index + m[0].length, m.index + m[0].length + 20);
    const before = seg.slice(Math.max(0, m.index - 16), m.index);
    if (!VALUE_AFTER.test(after) && !VALUE_BEFORE.test(before)) return true;
  }
  return false;
}

// ---------- public functions ----------

export function findSensitiveRequests(text) {
  let clean = String(text ?? "");
  for (const re of NOT_SENSITIVE) clean = clean.replace(re, " ");
  const segs = segments(clean);
  const negated = segs.map((s) => any(NEGATIONS, s));

  const found = [];
  for (const kind of KINDS) {
    const hit = segs.some((seg, i) => {
      if (negated[i]) return false;
      if (!kind.patterns.some((re) => asksFor(re, seg))) return false;
      // Look for an asking word in this sentence and up to 4 before it
      // (so lists like "Send us:\n- card number\n- CVV" work). Stop at a warning sentence.
      const window = [seg];
      for (let j = i - 1; j >= Math.max(0, i - 4) && !negated[j]; j--) window.push(segs[j]);
      const joined = window.join(" ");
      if (kind.needsCard && !CARD_WORD.test(joined)) return false;
      return any(GIVE_CUES, joined) || (!kind.otp && any(ENTER_CUES, joined));
    });
    if (hit) found.push({ id: kind.id, label: kind.label });
  }
  return found;
}

// "card number", "card number and CVC/CVV code", "a, b, and c"
function listWords(words) {
  if (words.length <= 1) return words.join("");
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}

export async function checkSensitiveInfo(text) {
  const TOOL = "check_sensitive_info";
  const LABEL = "Private details";
  try {
    const found = findSensitiveRequests(text);
    if (found.length === 0) {
      return { tool: TOOL, status: "pass", label: LABEL, detail: "The message does not ask for card, bank, or login details" };
    }
    const those = found.length === 1 ? "this" : "these";
    return {
      tool: TOOL,
      status: "fail",
      label: LABEL,
      detail: `It asks for your ${listWords(found.map((f) => f.label))}. Real banks and agencies never ask for ${those} in a message`
    };
  } catch {
    return { tool: TOOL, status: "unknown", label: LABEL, detail: "Could not run this check" };
  }
}
