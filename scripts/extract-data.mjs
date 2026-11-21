// 把 index.html 里内嵌的 GALLERY / AI_GALLERY 抽成 data/*.json
// 用法: node scripts/extract-data.mjs [--write]
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const HTML = path.join(ROOT, "index.html");
const DATA = path.join(ROOT, "data");
const WRITE = process.argv.includes("--write");

function extractConst(file, name) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const idx = lines.findIndex((l) => l.startsWith(`const ${name} = `));
  if (idx < 0) throw new Error("找不到 const " + name);
  const line = lines[idx];
  const s = line.indexOf("{"); let d = 0, e = s;
  for (let k = s; k < line.length; k++) { if (line[k] === "{") d++; else if (line[k] === "}") { d--; if (!d) { e = k + 1; break; } } }
  return { lines, idx, start: s, end: e, value: JSON.parse(line.slice(s, e)) };
}

const gal = extractConst(HTML, "GALLERY");
const aig = extractConst(HTML, "AI_GALLERY");
const out = {
  meta: {
    extractedFrom: "index.html",
    extractedAt: new Date().toISOString(),
    note: "真源改为本 JSON；改完跑 node scripts/apply-data.mjs 注回 index.html，再跑 validate-data.mjs 校验",
  },
  gallery: gal.value,
  aiGallery: aig.value,
};

const skus = Object.keys(out.gallery).length;
let aiCount = 0;
for (const k of Object.keys(out.aiGallery)) aiCount += (out.aiGallery[k].images || []).length;
console.log(`GALLERY: ${skus} 个 SKU；AI_GALLERY: ${Object.keys(out.aiGallery).length} 个 SKU / ${aiCount} 张`);

if (WRITE) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, "catalog.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log("已写出 data/catalog.json");
}
