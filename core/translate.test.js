// core/translate.test.js — Role 2 (Core Engine)
// Tests core/translate.js in Node using a FAKE Chrome Translator, so we can check
// caching and English fallback without a browser. Run from the repo root:
//   node core/translate.test.js
// (Real translations can only be checked in Chrome.)

let passed = 0;
let failed = 0;
const check = (ok, line) => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${line}`);
};

// Fake API: Spanish is ready, Hindi needs a download, Chinese is broken.
let translateCalls = 0;
globalThis.Translator = {
  async availability({ targetLanguage }) {
    return { es: "available", hi: "downloadable", zh: "available" }[targetLanguage] ?? "unavailable";
  },
  async create({ targetLanguage }) {
    if (targetLanguage === "hi") return new Promise(() => {}); // download never finishes
    return {
      async translate(text) {
        translateCalls++;
        if (targetLanguage === "zh") throw new Error("model crashed");
        return `[es] ${text}`;
      }
    };
  }
};

const { translate, prepareTranslation } = await import("./translate.js");

check(await translate("Scam", "en") === "Scam", "English stays English");
check(await translate("Scam", "es") === "[es] Scam", "Spanish is translated");
await translate("Scam", "es");
check(translateCalls === 1, `same phrase translated only once (calls=${translateCalls})`);
check(await translate("Scam", "fr") === "Scam", "unsupported language → English");
check(await translate("", "es") === "", "empty text is fine");

const start = Date.now();
check(await translate("Scam", "hi") === "Scam", "language still downloading → English");
check(Date.now() - start < 4000, `first phrase waits at most 3s (${Date.now() - start}ms)`);
const start2 = Date.now();
check(await translate("Why:", "hi") === "Why:", "next phrase → English");
check(Date.now() - start2 < 100, `next phrase does not wait again (${Date.now() - start2}ms)`);

check(await translate("Scam", "zh") === "Scam", "translator error → English");

check(await prepareTranslation("es") === "ready", "prepare: Spanish ready");
check(await prepareTranslation("hi") === "downloading", "prepare: Hindi downloading");
check(await prepareTranslation("fr") === "unavailable", "prepare: French unavailable");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
process.exit();
