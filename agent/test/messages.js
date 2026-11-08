// agent/test/messages.js — test messages shared by run_deep.mjs and dev.html.
// `secrets` = values that must NEVER appear in anything sent to the server.
export const TEST_MESSAGES = [
  {
    id: "es-uscis-whatsapp",
    expect: "scam",
    text:
      "USCIS: Su caso EAC2490123456 tiene un problema. Debe pagar $500 en tarjetas de regalo hoy o será deportado. " +
      "Llame al (469) 555-0187 o responda por WhatsApp.",
    secrets: ["EAC2490123456", "555-0187", "469"]
  },
  {
    id: "en-irs-giftcard",
    expect: "scam",
    text:
      "IRS NOTICE: You owe $1,200 in back taxes. A warrant will be issued for your arrest today unless you pay with " +
      "Google Play gift cards. Call 214-555-0143 immediately.",
    secrets: ["214-555-0143"]
  },
  {
    id: "hi-ice-threat",
    expect: "scam",
    text:
      "ICE चेतावनी: आपके खिलाफ निर्वासन का आदेश जारी हुआ है। गिरफ्तारी से बचने के लिए आज ही $800 के गिफ्ट कार्ड से जुर्माना भरें। " +
      "तुरंत 972-555-0199 पर कॉल करें।",
    secrets: ["972-555-0199"]
  },
  {
    id: "zh-uscis-lookalike",
    expect: "scam",
    text: "美国移民局通知：您的绿卡申请有问题，请在24小时内登录 uscis-gov-help.com 更新信息并支付处理费，否则申请将被取消。",
    secrets: []
  },
  {
    id: "en-uscis-safe",
    expect: "safe",
    text:
      "Reminder: Your biometrics appointment at the USCIS Application Support Center is on May 14 at 9:00 AM. " +
      "Bring your appointment notice and photo ID. You can check details by signing in to your myUSCIS account.",
    secrets: []
  }
];
