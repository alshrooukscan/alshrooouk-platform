// Arabic dictionary check (run from the repo root): node scripts/i18n-check.js
// - keys used in t()/tx() that have no Arabic entry (they fall back to English)
// - the same English key translated differently in two area files
const fs = require("fs");
const path = require("path");

const arDir = path.join("lib", "i18n", "ar");
const dicts = {};
for (const f of fs.readdirSync(arDir)) {
  if (!f.endsWith(".js") || f === "index.js") continue;
  const src = fs.readFileSync(path.join(arDir, f), "utf8");
  const body = src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1);
  // eslint-disable-next-line no-new-func
  dicts[f.replace(".js", "")] = Function(`return (${body});`)();
}

const merged = {};
const conflicts = [];
for (const [area, d] of Object.entries(dicts)) {
  for (const [k, v] of Object.entries(d)) {
    if (merged[k] !== undefined && merged[k].v !== v) conflicts.push({ key: k, a: `${merged[k].area}: ${merged[k].v}`, b: `${area}: ${v}` });
    merged[k] = { v, area };
  }
}

function walk(d, out = []) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}
const files = ["app", "components", "lib"].flatMap((d) => walk(d)).filter((p) => !p.includes(`${path.sep}i18n${path.sep}`));
const re = /\b(?:t|tx)\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g;
const missing = {};
let used = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  let m;
  while ((m = re.exec(src))) {
    if (m[1] === "`" && m[2].includes("${")) continue;
    const key = m[2].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(["'`\\])/g, "$1").replace(/\\n/g, "\n");
    used++;
    if (merged[key] === undefined) (missing[f] = missing[f] || []).push(key);
  }
}

const missCount = Object.values(missing).reduce((n, a) => n + a.length, 0);
console.log(`dictionary entries: ${Object.keys(merged).length}, t()/tx() calls with literal keys: ${used}, missing Arabic: ${missCount}, conflicting duplicates: ${conflicts.length}`);
for (const [f, keys] of Object.entries(missing)) console.log(`  missing in ${f}: ${[...new Set(keys)].slice(0, 15).map((k) => JSON.stringify(k)).join(", ")}${keys.length > 15 ? " ..." : ""}`);
for (const c of conflicts.slice(0, 40)) console.log(`  conflict ${JSON.stringify(c.key)}  |  ${c.a}  |  ${c.b}`);
process.exitCode = 0;
