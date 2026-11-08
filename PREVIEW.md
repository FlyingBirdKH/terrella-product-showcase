# 预览验收（非生产）

时间：2026-11-08 Asia/Shanghai（执行机 数据库搭建）

## 公开预览 URL（匿名 Netlify Drop，需在约 60 分钟内认领）

- Site：https://idyllic-sunshine-844d3d.netlify.app/
- Password：`My-Drop-Site`
- 内容：Ava `Terrella-multi-image-release-20261105.zip`（528 张已核压缩图 + 多图 gallery + 每款产品文件夹链接）
- **未**改生产 `https://terrella-product-showcase.vercel.app/`
- **未** merge / **未**推 528 张图进本仓库（避免再次触发 GitHub 上传审核拦截）

## 本分支有什么

- `index.html`：Ava 多图页（相对路径 `images/g-*.jpg`）。本分支 **不含** `images/` 二进制；完整带图预览请用上面 Netlify URL。
- 标签现状：`产品图` / `处理图` / 参考图（不是 PR#1 的「原图/AI 对照 + Prompt 版本」完整模型）。
- 空 gallery（16）：CAT-007/008/010/033/036/061–069/080/081。

## Bunny

- CDN 主机探测：`terralla-internal.b-cdn.net`（pullzone 5753300）可达；本批 528 张尚未上传。
- 上传脚本已备：`/workspace/terrella-bunny/upload-display-copies.sh`（需 vault `terralla-internal Bunny 上传` id 3614290 → 环境变量 `BUNNY_STORAGE_PASSWORD`，执行机侧 **无 Vault list 工具**）。
- 禁止使用 Nova 区密码。

## 相关

- 报告 PR（未上线）：https://github.com/FlyingBirdKH/terrella-product-showcase/pull/1
- Drive ZIP：`1ESbNCtHrJ318a7-f0HMvo55a2y1RQZ57`（本轮 DownloadFile 已成功，68MB）
- Supabase `terrella-product-db`：96 products / 172 assets（kind=thumb+original 各 86）；无多图资产行。

## PR
- 本预览分支 draft PR：https://github.com/FlyingBirdKH/terrella-product-showcase/pull/2
