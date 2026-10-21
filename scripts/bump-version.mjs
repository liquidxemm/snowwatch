// Stamps every local module import (and the app.js tag in index.html) with ?v=<version>,
// so browsers never mix cached old modules with new ones. Run before committing UI changes:
//   node scripts/bump-version.mjs
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const version = Date.now().toString(36);
const files = ["index.html", "app.js", "util.js", "snow.js", "archive.js", "plan.js", "map.js", "season.js"];

for (const f of files) {
  const url = new URL(f, root);
  const src = await readFile(url, "utf8");
  const out = src
    .replace(/(from\s+["']\.\/[\w-]+\.js)(\?v=[\w]+)?(["'])/g, `$1?v=${version}$3`)
    .replace(/(src="app\.js)(\?v=[\w]+)?(")/g, `$1?v=${version}$3`);
  if (out !== src) await writeFile(url, out);
}
console.log("version", version);
