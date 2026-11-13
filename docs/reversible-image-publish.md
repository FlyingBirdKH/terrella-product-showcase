# 单张图片的可逆上架 / 下架（尚未接通）

这是实现说明，不是已上线的网站操作。当前展示页不能上架，也不能下架。

## 现在仓库里实际有什么

- 公开页面是 `index.html`，打开目录不需要登录。持久勾选只有一条真源：terrella-product-db 的 `public.product_image_selections`。`internal_preview` 事件表不是这条路径，不要创建，也不要再接。`internal-preview.json` 也不是真源。
- 图是否出现在展示页，由页面内嵌的 `publicCopyApproved`、`contentVerified`、`byteVerified`、`assignedSku` 决定。这只说明展示页可以显示这张图，不是目标网站已经上架。
- 持久证据文件是 `image-availability.json`。当前 `records` 为空。没有记录就不是已放行，也不是已同步。
- 本仓库没有目标网站的写入接口，也没有把单张图从 `terralla.com` 画廊撤下的实现。`http://terralla.com` 只是草稿目标，不是授权。预览访问口令只保护勾选写入，不代表正式商城可以上架。
- 原图在 Bunny / Drive。下架若将来发生，也只针对目标画廊里的那一张图，不删除原件，不删除整个产品。

## 勾选真源（只有 product_image_selections）

图片字节仍在 Bunny 的 `products/{series}/{SKU}/ai/`。不要把文件上传到 Supabase。

勾选只写已经存在的 terrella-product-db（ref `wwsfmfxwhktglgmeukgr`）表 `public.product_image_selections`，列是 `product_id` 和 `image_sha256`。这张表已创建，RLS 开着，anon 和 authenticated 没有策略。本仓库不新建表，也不执行迁移。

下面两条都不要再接，它们和这张表是互相排斥的第二套方案：

- crm-core，以及正式商城商品 ID `426bf18c-8649-4aa5-939c-f0b33eca95f8`。
- `internal_preview` 事件表、匿名密钥、`app_metadata` 声明。`987ffbc` 走的是这条，不再作为真源。仓库里不再保留那份迁移。

CAT-001 / TR260002 的商品 UUID 是 `0f057213-b8af-4982-9e44-582a2a1d3469`。CAT-001 仍只接受原来的四条完整 SHA-256。其他 SKU 只有在 `products.sku` 或 `products.id` 已经有行时才写入。找不到就拒绝，不猜测 ID，不插入商品，不改 `products.status`，不写 `product_assets`。

勾选插入这一对。取消勾选只删除这一对。不删除 Bunny 文件，不删除商品行。成功文案只在响应同时带 `saved`、`durable` 和 `store: terrella-product-db` 时出现。刷新和另一个浏览器看到的是同一张表里的行，不是 `localStorage`。

`image-availability.json` 仍是正式放行和同步账本。这一步不往里面写。

## 访问保护（应用层失败关闭；部署保护目前没有打开）

服务角色密钥不能对未授权请求使用。选择接口先核对 HttpOnly cookie，通过之后才用服务器上的数据库密钥。页面上的标志、CORS 和伪造请求头都不能代替这道门。

预览环境需要这三个名字，都只放在预览，不放进生产，也不写进仓库：

- `TERRELLA_PRODUCT_DB_URL`
- `TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY`
- `TERRELLA_PREVIEW_ACCESS_SECRET`

前两个名字已经只存在于预览环境。第三个口令还没有配置。缺这个口令时，读取和写入都返回 `access-not-configured`，不会调用数据库。口令由服务器比对，成功后发一个 12 小时、HttpOnly、`SameSite=Lax` 的 cookie。cookie 不是口令本身。浏览器写入还要 `Content-Type: application/json`，并且 `Sec-Fetch-Site: same-origin`、`Origin` 和 Host 一致。

项目的 `ssoProtection` 现在是 null。不能把预览地址当成已经受部署保护。命令行有 `--sso` 和 `--password`，当前方案是否允许还没有确认，所以本仓库不调用它们，也不假设它们已经生效。接受这个预览之前，由父流程打开只针对预览的部署保护。生产访问控制保持原样。

`84f8ab7` 的预览地址现在是 `404 DEPLOYMENT_NOT_FOUND`，原因不明。`84f8ab7` 和 `987ffbc` 都没有 GitHub checks。那不是 CI 通过的证据。这一提交不合并，也不部署。

## 后续正式同步（尚未执行，不能把勾选当商城）

图片版本已批准的数量是 CAT-001 四张、CAT-003 五张、CAT-006 四张。勾选可以按已有的 `products.sku` / `products.id` 写入。没有查到的 SKU 保持拒绝。禁止猜测 ID，禁止自动建行，也禁止改用 CAT-013/TR2605002。

正式同步仍要另一次独立终验和 Kevin 的 GO。到那时才做这些事，而且不在这一次里做：

1. 只用原库 `public.products` 里确认过的商品 ID，按完整 SHA 逐张写入目标画廊字段。正式商城仍不是这个预览库。
2. 写入后读回同一张图仍在画廊里，才把证据追加到 `image-availability.json`。没有读回就保持未同步。
3. 撤回只从目标画廊去掉这一张图的关联。不删除 Bunny 原件，不删除商品，不修改 `status`，也不把 `paused` 改成公开。
4. 每一张使用新的事件号和上一代 revision。重复事件号且内容相同则幂等；revision 冲突则放弃这次写入并重新读回。
5. 不合并 main，不改常用生产别名，不合 storefront PR 36。

## 页面现在怎么读

只读 `image-availability.json`。成功徽章必须同时满足 SKU、完整 SHA-256 和目标：

- `已放行 · 目标`：`approval.state` 为 `approved`，且 `approval.evidence` 非空。
- `已同步 · 目标`：`sync.state` 为 `verified`，且 `sync.evidence` 非空。仅有放行、下载、复制或勾选，不会显示已同步。
- `revoked` 显示为已撤回，不是成功。同一目标上如果另一侧仍有成功证据，已撤回照样显示，不让成功徽章盖住撤回。冲突或失败的同步不显示已同步。
- 文件标了 `example: true`、JSON 损坏、或第一次读取失败：不显示成功徽章。
- 已经读到记录之后再次读取失败：保留上一次读到的记录，并说明失败，不把失败写成已同步。

同一 SKU、完整 SHA 和目标的多行按单调 `revision` 合并；没有 `revision` 时按文件顺序合并，后一行只覆盖它写明的放行或同步。相同 `revision` 内容不一致，或 `eventId` 重复但内容不同，或版本号不是安全整数，该目标失败关闭，不显示成功徽章。相同事件重复追加是幂等的。不同目标互不影响。

Ava 可以追加记录，不要改写已有行。建议的一行：

```json
{
  "eventId": "可选，同一事件重复必须完全相同",
  "revision": 1,
  "sku": "CAT-001",
  "sha256": "64位小写十六进制",
  "target": "Kevin 确认后的目标名",
  "approval": { "state": "approved", "evidence": "非空证据" },
  "sync": { "state": "verified", "evidence": "目标网站读回证据" }
}
```

`state` 只接受 `approved`、`revoked`、`pending`，同步另加 `verified` 和 `failed`。未知字段可以以后再加。本页不代写 CAT-001 那四张图的放行或同步。

## 将来的管理人流程（未实现）

公开勾选不能授权。只有已授权的管理人能提出意图。意图、放行证据、目标网站实际状态分开保存。

1. 管理人写下期望：某个 SKU + 完整 SHA + 明确目标，动作是上架或下架这一张图。
2. 期望先保存，此时还不能显示已同步。
3. 另一步对目标网站执行，并读回这一张图是否真的在画廊里。
4. 只有读回与期望一致，才写下确认后的实际状态。保存失败、读回失败、身份不一致，确认状态保持不变。
5. 下架只撤下该目标上的这一张图。原件和整个产品保留。
6. 每次确认带上一代版本号。旧版本的并发写入拒绝。失败后用新的读回可以重试。
7. 新设备刷新时只读确认后的记录，不读某一次浏览器里的勾选。

`tests/image-availability-sim.mjs` 用夹具演示上述状态转换。文件头标明它不是后端，也不是 `terralla.com` 的读回。页面不会加载它。

## 还缺的一个决定

Kevin 需要指定：真正的目标网站，以及哪一个已授权管理人用什么既有通道执行并读回单张图。在此之前，页面上的「上架/下架」保持禁用。
