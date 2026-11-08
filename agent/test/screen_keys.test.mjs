// Tests the message-identity helpers in content/detect.js (Gmail hash / Outlook URL parsing).
// Run: node agent/test/screen_keys.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../../content/detect.js", import.meta.url), "utf8");
// window.top !== window → the content-script part returns at once; only the top-level helpers are defined.
const ctx = { window: { top: {} }, URL, console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { kavachGmailThreadId: tid, kavachGmailIsList: isList, kavachOutlookId: oid, kavachHash: hash } = ctx;

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) pass++;
  else { fail++; console.log(`❌ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const ID = "FMfcgzQXJWDsKmwlMjRrhNvvrXHBzBJX";

eq("inbox thread", tid("#inbox/" + ID), ID);
eq("search thread", tid("#search/rent+due/" + ID), ID);
eq("label thread", tid("#label/Work/" + ID), ID);
eq("nested label", tid("#label/Family%2FMom/" + ID), ID);
eq("category thread", tid("#category/promotions/" + ID), ID);
eq("legacy hex id", tid("#all/18c3f2a9b4d5e6f7"), "18c3f2a9b4d5e6f7");
eq("with ?compose", tid("#inbox/" + ID + "?compose=new"), ID);
eq("sent thread", tid("#sent/" + ID), ID);
eq("inbox list", tid("#inbox"), null);
eq("empty hash", tid(""), null);
eq("page 2", tid("#inbox/p2"), null);
eq("search results", tid("#search/averyveryverylongsearchword"), null);
eq("label list", tid("#label/Work"), null);
eq("two threads differ", tid("#inbox/" + ID) !== tid("#inbox/FMfcgzQXJWDsKmwlMjRrhNvvrXHBzBJY"), true);

eq("list: inbox", isList("#inbox"), true);
eq("list: p3", isList("#label/Work/p3"), true);
eq("list: search", isList("#search/rent"), true);
eq("list: thread is not list", isList("#inbox/" + ID), false);

eq("outlook path id", oid("https://outlook.live.com/mail/0/inbox/id/AQQkADAwATM0MDAAMS1hYjQ%3D"), "AQQkADAwATM0MDAAMS1hYjQ=");
eq("outlook ItemID", oid("https://outlook.office.com/mail/deeplink?ItemID=AAMkAGI2"), "AAMkAGI2");
eq("outlook no id", oid("https://outlook.live.com/mail/0/inbox"), null);

eq("hash stable", hash("hello"), hash("hello"));
eq("hash differs", hash("hello") !== hash("hellp"), true);

console.log(`${fail ? "❌" : "✅"} screen keys: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
