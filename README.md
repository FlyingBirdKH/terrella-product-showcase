# Terrella 产品展示库

独立公开展示页，对应 `terrella-product-db`（Supabase ref `wwsfmfxwhktglgmeukgr`）。不是正式店 `terralla-storefront`。合并正式站需要 Kevin 另一次 GO。本分支不切换生产站，也不自动合并。

基线提交：`2124d3470dd993fdedee8e4b57223ea5d1361871`（`ava/showcase-source-label-20261104`）。原有 `products.json`、`images/` 缩略图和单图卡片都保留。

## 现在实际有什么

- 96 条产品记录，稳定编号是 `CAT-001`–`CAT-096`。86 条沿用仓库里已有的目录缩略图，10 条仍缺图：`CAT-033`、`CAT-061`–`CAT-069`。
- 原图链接、目录 `source`、备注和原先的待核标注都还在 `products.json`，页面卡片仍会显示。
- 东方 32 款、五行 5 款的 Prompt 正文按 Slack Canvas 收录进 `data/eastern-prompts.json`、`data/wuxing-prompts.json`，并由构建写入 `data/catalog.json`。每条 Prompt 有自己的 id、版本和存放位置 `data/catalog.json#/prompts/<id>`，对应一个视角记录。
- 五行 25 张 AI 成图只记录了 Canvas 上的 Slack 文件编号。图片字节没有复制进本仓库，也没有上传 Bunny。
- 东方 Canvas 有逐视角 Prompt，没有逐视角成图文件。这些记录的角色是 `prompt_only_view`，成图状态是待补。
- 模型、模型版本、seed、API 参数、精确生成时间在来源里没有字段。全部标 `unknown`，没有倒填。
- 鎏金未命名文件夹 6/7 没有稳定产品编号，放在 `unbound`，不并进 96 款。
- Ava 所说的多图补丁包没有随任务传入。Slack 文件 `F0CFVBR7ZQQ` 本次读取结果是 `file_too_large`。该包曾被审核拒绝，本分支没有解压、没有换渠道重传，也没有改写现有图片。

页面上的「结构验收样例」是仓库里的合成色块，用来检查并排和版本切换。它不是产品，也不是真实生成记录。

## 数据库开发责任

数据库开发责任人是 **Cursor**。

本变更没有连接生产库，也没有改 `products` / `product_assets`。Supabase 连接器本次需要重新授权，所以没有复核线上行数。Slack 旧记录里提到该项目已有 `products` 与 `product_assets`；那是历史回执，不是这次查询结果。

建议的新增结构（只加表，不删旧表、不改旧行）：

- `schema/001_prompt_trace.sql`：`prompt_documents`、`asset_records`
- `schema/001_prompt_trace_rollback.sql`：只删除这两张新表

运行：

1. 先在暂存库核对现有 `\d products` 和 `\d product_assets`。不要对生产库直接执行。
2. 做备份。
3. 审阅 `schema/001_prompt_trace.sql` 后，在暂存库执行该文件。
4. 页面当前读的是仓库里的 `data/catalog.json`，不是这条 SQL。把 JSON 导入新表属于另一次批准后的动作。
5. `node scripts/migration-guard.mjs` 只会说明未执行。即使加上 `--apply`，脚本也没有数据库客户端，会以状态码 2 拒绝写入。

回滚：

1. 确认要撤回的是本次新增的两张表，而不是原有产品行。
2. 在同一暂存库执行 `schema/001_prompt_trace_rollback.sql`。
3. 展示页回滚到合并前的提交即可恢复旧单图页面。已存在于 Git 历史里的公开缩略图不会因为回滚网页而从历史中消失；本次没有新增产品图片字节。

## Bunny 迁移

没有执行任何 Bunny 上传。缺 Terrella 专用 storage zone、hostname 和 API key。不得用 Nova 区密码顶替，也不得把密钥写进仓库。

`data/catalog.json` 的 `migration` 列出每条资产：`executed` 都是 false。已在 GitHub Pages 的 86 张旧缩略图保持原处，不重传。`CAT-061`–`CAT-069` 在 `main` 上曾有另一来源的缩略图，本基线把它们标为编号未核完，这里不从那条分支把图拉回来。

被审核拒绝的私有图包 `F0CFVBR7ZQQ` 继续阻断，包括换代理、换托管、换账号和拆批。

## 本地查看与测试

```bash
npm test
npm run build
python3 -m http.server 8765
```

浏览器打开 `http://127.0.0.1:8765/`。点产品卡上的「原图 / AI 对照」，或打开 `#CAT-045`、`#FIXTURE-STRUCTURE`。这是桌面或模拟视口下的静态页，不是真机验收。

构建只重写 `data/catalog.json`。`npm test` 会核对这份清单与生成结果一致。
