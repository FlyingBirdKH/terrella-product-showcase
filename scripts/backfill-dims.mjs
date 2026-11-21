// 回填 AI 图宽高：从 Bunny 源站读取真实尺寸，写入 data/catalog.json
// 用法: node scripts/backfill-dims.mjs [--write] [--limit N]
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "data", "catalog.json");
const WRITE = process.argv.includes("--write");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : 9999;

const data = JSON.parse(fs.readFileSync(DATA, "utf8"));

// 读本机 Bunny key（不进仓库）
const KEY_CANDIDATES = [
  process.env.BUNNY_KEY,
  "C:/Users/whs92/Documents/deepseek-harness/default-workspace/tools/sync-selections/.bunny-key.txt",
];
let KEY = "";
for (const c of KEY_CANDIDATES) {
  if (!c) continue;
  if (c.startsWith("http") || /^[A-Za-z0-9-]{20,}$/.test(c)) { KEY = c; break; }
  try { KEY = fs.readFileSync(c, "utf8").trim(); break; } catch {}
}
if (!KEY) { console.error("找不到 Bunny 存储 key"); process.exit(2); }

const HOST = "https://sg.storage.bunnycdn.com";
const ZONE = "terralla-internal";
const CDN = "https://terralla-internal.b-cdn.net";

function imageDims(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: "png" };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), format: "jpeg" };
      }
      i += 2 + len;
    }
    return null;
  }
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") {
    const kind = buf.slice(12, 16).toString("ascii");
    if (kind === "VP8X") return { width: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1, height: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1, format: "webp" };
    if (kind === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, format: "webp" };
    if (kind === "VP8L") { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, format: "webp" }; }
  }
  return null;
}

const todo = [];
for (const [sku, block] of Object.entries(data.aiGallery || {})) {
  for (const img of block.images || []) {
    if (!img.imageWidth || !img.imageHeight) todo.push({ sku, img });
  }
}
console.log(`需要回填: ${todo.length} 张（本次处理 ${Math.min(LIMIT, todo.length)}）`);

let ok = 0, fail = 0;
for (const { sku, img } of todo.slice(0, LIMIT)) {
  const url = String(img.path);
  const rel = url.startsWith(CDN + "/") ? url.slice(CDN.length + 1) : url.replace(/^https?:\/\/[^/]+\//, "");
  try {
    const res = await fetch(`${HOST}/${ZONE}/${rel}`, { headers: { AccessKey: KEY }, signal: AbortSignal.timeout(90000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const dims = imageDims(buf);
    if (!dims) throw new Error("无法识别尺寸");
    img.imageWidth = dims.width;
    img.imageHeight = dims.height;
    img.byteLength = buf.length;
    const issues = [];
    if (dims.width !== 1600 || dims.height !== 1600) issues.push(`尺寸 ${dims.width}×${dims.height}，规范要求 1600×1600`);
    if (buf.length > 3 * 1024 * 1024) issues.push(`文件 ${(buf.length / 1024 / 1024).toFixed(1)}MB，建议 ≤ 3MB`);
    if (issues.length) img.specIssues = issues; else delete img.specIssues;
    ok++;
    console.log(`  ✓ ${sku} ${url.split("/").pop()} → ${dims.width}×${dims.height} (${(buf.length / 1024).toFixed(0)}KB)`);
  } catch (e) {
    fail++;
    console.log(`  ✗ ${sku} ${url.split("/").pop()}: ${String(e.message).slice(0, 60)}`);
  }
}
console.log(`完成：成功 ${ok} / 失败 ${fail}`);
if (WRITE && ok) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log("已写回 data/catalog.json");
} else if (ok) {
  console.log("（未加 --write，未保存）");
}
