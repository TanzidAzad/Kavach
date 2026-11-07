// core/data.js — Role 2 (Core Engine)
// Loads the JSON files in data/ so the tools can use them.
// Works in both places our code runs:
//   - the Chrome extension: fetches the file bundled inside the extension (works offline)
//   - Node (tests, eval/run_eval.js): reads the file from disk
// Each file is read once and then cached.

const cache = new Map();

export function loadData(fileName) {
  if (!cache.has(fileName)) {
    const pending = readJson(fileName).catch((err) => {
      cache.delete(fileName); // allow a retry next time
      throw err;
    });
    cache.set(fileName, pending);
  }
  return cache.get(fileName);
}

async function readJson(fileName) {
  const url = new URL(`../data/${fileName}`, import.meta.url);
  if (url.protocol === "file:") {
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(url, "utf8"));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load data/${fileName}`);
  return res.json();
}
