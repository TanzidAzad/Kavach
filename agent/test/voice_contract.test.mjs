// agent/test/voice_contract.test.mjs — Role 3. No browser/server needed: node agent/test/voice_contract.test.mjs
// Checks the side panel contract: `await startVoice()` rejects when live voice can't connect, resolves on stopVoice(),
// and `level` reaches the grounded facts.
globalThis.AudioContext = class { close() {} };
globalThis.fetch = async () => { throw new Error("offline"); };
const v = await import("../voice.js");
const { buildVoiceInstruction } = await import("../voicePrompt.js");
let ok = 0, bad = 0;
const check = (name, cond) => { cond ? ok++ : bad++; console.log((cond ? "PASS " : "FAIL ") + name); };
const verdict = { verdict: "scam", confidence: "high", reasons: ["Asks for gift cards"], steps: ["Do not pay"] };

check("exports", ["startVoice", "stopVoice", "speakFallback", "updateVerdict"].every((k) => typeof v[k] === "function") && Array.isArray(v.VOICE_LANGUAGES));
let rejected = false;
try { await v.startVoice({ verdict, level: "highly_likely", lang: "es", text: "hi" }); } catch { rejected = true; }
check("await startVoice rejects when it can't connect", rejected);

globalThis.fetch = () => new Promise(() => {}); // hangs
const s = v.startVoice({ verdict, lang: "en" });
setTimeout(() => v.stopVoice(), 50);
let resolved = false; try { await s; resolved = true; } catch {}
check("stopVoice() ends the talk and await resolves", resolved && s.state === "ended");

const ins = await buildVoiceInstruction({ verdict: { ...verdict, level: "highly_likely" }, lang: "en" });
check("level in facts", ins.includes("What the screen shows: highly likely a scam"));
const ins2 = await buildVoiceInstruction({ verdict: { ...verdict, level: "bogus" }, lang: "en" });
check("bad level ignored", !ins2.includes("What the screen shows"));
console.log(`${ok}/${ok + bad} passed`); process.exit(bad ? 1 : 0);
