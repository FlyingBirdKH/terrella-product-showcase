// 门禁校验：数据完整性 / 页面与数据一致 / 禁止项 / 缩略图存在 / 已删图不得补回
// 用法: node scripts/validate-data.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const problems = [];
const warnings = [];

// 1) JSON 可解析
const DATA_PATH = path.join(ROOT, "data", "catalog.json");
if (!fs.existsSync(DATA_PATH)) { console.error("✗ 缺 data/catalog.json"); process.exit(1); }
let data;
try { data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8")); } catch (e) { console.error("✗ data/catalog.json 解析失败: " + e.message); process.exit(1); }

// 2) 必填字段
const AI_REQUIRED = ["assignedSku", "integrityMethod", "sourceSha256", "sourceHashMeaning", "byteVerified", "byteLength", "imageWidth", "imageHeight", "path"];
let aiTotal = 0, missingDims = 0, notSpec = 0, missingField = 0;
const specSamples = [];
for (const [sku, block] of Object.entries(data.aiGallery || {})) {
  for (const img of block.images || []) {
    aiTotal++;
    for (const f of AI_REQUIRED) {
      if (img[f] === undefined || img[f] === null || img[f] === "") { problems.push(`AI 图缺字段 ${f}: ${sku} ${img.path || "(无 path)"}`); missingField++; }
    }
    if (!img.imageWidth || !img.imageHeight) { missingDims++; }
    else if (Math.max(img.imageWidth, img.imageHeight) < 1000 || Math.max(img.imageWidth, img.imageHeight) > 1600) {
      notSpec++;
      const legacyOk = img.legacySize === true;
      if (!img.specIssues && !legacyOk) problems.push(`AI 图长边不在 1000–1600 且无 specIssues／legacy 标注: ${sku} ${String(img.path).split("/").pop()} (${img.imageWidth}×${img.imageHeight})`);
      if (legacyOk && !img.legacyReason) problems.push(`标记 legacySize 但缺 legacyReason: ${sku} ${String(img.path).split("/").pop()}`);
      if (specSamples.length < 8) specSamples.push(`${sku}:${img.imageWidth}×${img.imageHeight}`);
    }
    if (img.assignedSku && img.assignedSku !== sku) problems.push(`assignedSku 与所在 SKU 不一致: ${sku} 内标 ${img.assignedSku}`);
    if (img.path && !String(img.path).includes(`/${sku}/`)) problems.push(`图片路径不含 SKU: ${sku} ${img.path}`);
  }
}
if (missingDims) problems.push(`有 ${missingDims} 张 AI 图缺宽高字段（规范必填）`);

// 3) 页面与数据一致
const HTML_PATH = path.join(ROOT, "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");
const { execFileSync } = await import("node:child_process");
try {
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "apply-data.mjs"), "--check"], { stdio: "pipe" });
} catch {
  problems.push("index.html 与 data/catalog.json 不一致（请跑 node scripts/apply-data.mjs 并提交）");
}

// 4) 禁止项：本地面板代码不得进发布包
for (const bad of ["local-sync-panel.js", "127.0.0.1:8790"]) {
  if (html.includes(bad)) problems.push(`发布页面出现本地面板痕迹: ${bad}`);
}

// 5) 缩略图引用必须存在
const thumbsDir = path.join(ROOT, "thumbs");
const manifestPath = path.join(thumbsDir, "manifest.js");
if (fs.existsSync(manifestPath)) {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const m = raw.match(/window\.THUMB_MANIFEST = (\{[\s\S]*\});?\s*$/);
  if (!m) problems.push("thumbs/manifest.js 结构无法解析");
  else {
    let man;
    try { man = JSON.parse(m[1]); } catch (e) { problems.push("thumbs/manifest.js JSON 解析失败: " + e.message); }
    if (man) {
      let checked = 0, missing = 0;
      for (const [url, entry] of Object.entries(man)) {
        for (const v of entry.variants || []) {
          const rel = v.path;
          if (!rel) continue;
          checked++;
          if (!fs.existsSync(path.join(ROOT, rel))) { missing++; if (missing <= 5) problems.push(`缩略图缺文件: ${rel}`); }
        }
      }
      if (missing > 5) problems.push(`缩略图共缺 ${missing} 个文件（共检查 ${checked}）`);
    }
  }
}

// 6) 已删除图片不得被补回（image-availability.json 记录删除清单）
const availPath = path.join(ROOT, "image-availability.json");
if (fs.existsSync(availPath)) {
  const avail = JSON.parse(fs.readFileSync(availPath, "utf8"));
  const deleted = new Set();
  for (const [url, st] of Object.entries(avail)) if (st && st.status === "deleted") deleted.add(url);
  for (const [sku, block] of Object.entries(data.gallery || {})) {
    for (const img of block.images || []) {
      if (deleted.has(img.path)) problems.push(`已删图仍在页面引用: ${sku} ${img.path}`);
    }
  }
}

// 汇总
console.log(`AI 图: ${aiTotal} 张 | 缺字段: ${missingField} | 缺宽高: ${missingDims} | 尺寸不符: ${notSpec}${specSamples.length ? "（" + specSamples.join(", ") + "）" : ""}`);
if (warnings.length) { console.log("\n提醒:"); warnings.forEach((w) => console.log("  · " + w)); }
if (problems.length) { console.log("\n错误（必须修）:"); problems.forEach((p) => console.log("  ✗ " + p)); process.exit(1); }
console.log("\n校验通过：字段齐全、页面与 JSON 一致、无本地面板痕迹、缩略图文件存在、已删图未被引用。");
