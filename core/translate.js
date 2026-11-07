// core/translate.js — Role 2 (Core Engine)
// translate(text, targetLang) → Promise<string>
//   Translates English text into "es", "hi" or "zh" using Chrome's on-device
//   Translator API. Nothing is sent to the internet.
//   If the language isn't ready, or anything fails, returns the English text.
//   Results are cached, so each phrase is translated only once.
//
// prepareTranslation(targetLang) → Promise<"ready" | "downloading" | "unavailable">
//   Optional, for the popup (Role 1): call it when the user picks a language.
//   The first time, Chrome must download that language (needs internet once,
//   and must be started by a click/selection, which is why the popup calls it).
//   After that, translation works offline.

const SUPPORTED = ["es", "hi", "zh"];
const CREATE_TIMEOUT_MS = 3000; // don't make the popup wait on a download

const translators = new Map(); // lang → Promise<Translator | null>
const cache = new Map();        // "lang|text" → Promise<string>
const slow = new Set();         // languages still downloading: skip the wait, use English

const hasApi = () => typeof Translator !== "undefined";

// Debug messages for developers only (right-click popup → Inspect → Console). Users never see these.
const log = (...args) => console.info("[Kavach translate]", ...args);

function timeout(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}

// Gets (or starts creating) the translator for a language. Returns null if not usable.
function getTranslator(lang) {
  if (!translators.has(lang)) {
    const pending = (async () => {
      const options = { sourceLanguage: "en", targetLanguage: lang };
      const availability = await Translator.availability(options);
      log(`en → ${lang}: ${availability}`);
      if (availability === "unavailable") return null;
      const translator = await Translator.create({
        ...options,
        monitor(m) {
          m.addEventListener("downloadprogress", (e) =>
            log(`downloading ${lang}: ${Math.round(e.loaded * 100)}%`)
          );
        }
      });
      log(`en → ${lang}: ready`);
      return translator;
    })().catch((err) => {
      log(`en → ${lang}: could not start (${err?.name || err})`);
      return null;
    });
    translators.set(lang, pending);
    // When ready, stop skipping. If it failed, forget it so we can try again later.
    pending.then((t) => {
      slow.delete(lang);
      if (!t) translators.delete(lang);
    });
  }
  return translators.get(lang);
}

export async function prepareTranslation(targetLang) {
  if (!SUPPORTED.includes(targetLang) || !hasApi()) return "unavailable";
  try {
    const availability = await Translator.availability({ sourceLanguage: "en", targetLanguage: targetLang });
    if (availability === "unavailable") return "unavailable";
    getTranslator(targetLang); // starts the download if needed
    return availability === "available" ? "ready" : "downloading";
  } catch {
    return "unavailable";
  }
}

export async function translate(text, targetLang = "en") {
  const source = String(text ?? "");
  if (!source.trim() || targetLang === "en" || !SUPPORTED.includes(targetLang)) {
    return source;
  }
  if (!hasApi()) {
    log("Translator API not available in this Chrome (needs Chrome 138+)");
    return source;
  }
  if (slow.has(targetLang)) return source; // still downloading — don't make the user wait again

  const key = `${targetLang}|${source}`;
  if (!cache.has(key)) {
    const pending = (async () => {
      const TIMED_OUT = Symbol();
      const translator = await Promise.race([
        getTranslator(targetLang),
        timeout(CREATE_TIMEOUT_MS).then(() => TIMED_OUT)
      ]);
      if (translator === TIMED_OUT) {
        log(`${targetLang} not ready after 3s (still downloading) → showing English for now`);
        slow.add(targetLang);
        throw new Error("still downloading");
      }
      if (!translator) throw new Error("not ready");
      return translator.translate(source);
    })();
    cache.set(key, pending);
    // Don't remember failures, so it works once the language finishes downloading.
    pending.catch(() => cache.delete(key));
  }

  try {
    return await cache.get(key);
  } catch {
    return source; // English fallback
  }
}
