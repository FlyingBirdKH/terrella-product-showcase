# 预览验收（非生产）· v2 品类→子系列

时间：2026-11-08 Asia/Shanghai

## 带图预览 URL（匿名 Netlify Drop，约 60 分钟内认领）

- **新** Site：https://dainty-palmier-99e2e4.netlify.app/
- Password：`My-Drop-Site`
- 旧 Drop（v1 无子系列 UI）可忽略：https://idyllic-sunshine-844d3d.netlify.app/
- **未**改生产 https://terrella-product-showcase.vercel.app/

## v2 改动

- 从 Jenny 主表注入 `sub_series`（子系列）；筛选＝品类 → 子系列；列表按品类分组后再按子系列分组
- 卡片展示：品类 + 子系列 pill + 类别（product_type）pill
- 主表 96/96 均有子系列／类别；未猜归类
- 缺口见 `CLASSIFICATION-STATUS.md`、`subcat-field-gap.csv`（字段未进 main／Supabase，不是空分类）

## 本分支不含

- `images/` 二进制（仍在 Netlify Drop；Bunny 上传仍待 vault 钥）
