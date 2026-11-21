// 把 data/catalog.json 注回 index.html 的 GALLERY / AI_GALLERY 两行
// 单一真源 = data/catalog.json；index.html 只是产物，不要手改那两行。
// 用法: node scripts/apply-data.mjs [--check]
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const HTML = path.join(ROOT, "index.html");
const DATA = path.join(ROOT, "data", "catalog.json");
const CHECK = process.argv.includes("--check");

if (!fs.existsSync(DATA)) { console.error("缺 data/catalog.json，先跑 extract-data.mjs --write"); process.exit(2); }
const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
if (!data.gallery || !data.aiGallery) { console.error("data/catalog.json 结构不对（需要 gallery / aiGallery）"); process.exit(2); }

function replaceConst(lines, name, value) {
  const idx = lines.findIndex((l) => l.startsWith(`const ${name} = `));
  if (idx < 0) throw new Error("找不到 const " + name);
  const line = lines[idx];
  const s = line.indexOf("{");
  let d = 0, e = s;
  for (let k = s; k < line.length; k++) { if (line[k] === "{") d++; else if (line[k] === "}") { d--; if (!d) { e = k + 1; break; } } }
  const before = line.slice(0, s);
  const after = line.slice(e);
  return { idx, line: before + JSON.stringify(value) + after };
}

const src = fs.readFileSync(HTML, "utf8");
const lines = src.split("\n");
const g = replaceConst(lines, "GALLERY", data.gallery);
lines[g.idx] = g.line;
const a = replaceConst(lines, "AI_GALLERY", data.aiGallery);
lines[a.idx] = a.line;
const next = lines.join("\n");

if (CHECK) {
  const same = next === src;
  console.log(same ? "index.html 与 data/catalog.json 一致" : "index.html 与 data/catalog.json 不一致（请跑 node scripts/apply-data.mjs）");
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(HTML, next, "utf8");
console.log("已把 data/catalog.json 注回 index.html");
