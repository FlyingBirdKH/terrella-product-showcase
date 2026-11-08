# 预览验收（非生产）· CDN 多图

时间：2026-11-08 Asia/Shanghai

## CDN

- Base：https://terralla-internal.b-cdn.net/showcase/multi-image-20261108/
- Bunny 上传：ok=564 fail=0
- `index.html` / `products.json` 图片地址已改为上述 CDN（本地 `images/`、`g-`、`ai-`、`CAT-` 文件引用：0）

## 部署范围

- 仅 Preview 分支 `preview/ava-multi-image-20261108`（draft PR #2）
- 生产未动：https://terrella-product-showcase.vercel.app/
- 未合并 main，未做 production deploy
