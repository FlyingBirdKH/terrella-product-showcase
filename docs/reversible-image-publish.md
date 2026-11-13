# 单张图片的可逆上架 / 下架（尚未接通）

这是实现说明，不是已上线的网站操作。当前展示页不能上架，也不能下架。

## 现在仓库里实际有什么

- 公开页面是 `index.html`，不要求登录。勾选由服务器写入 terrella-product-db 的 `public.product_image_selections`，读回成功后才算保存。复制清单每次只包含当前这一个产品。`internal-preview.json` 不是真源，接口不会写它。crm-core 的 `internal_preview` 也不是这条路径，不要再接。
- 图是否出现在展示页，由页面内嵌的 `publicCopyApproved`、`contentVerified`、`byteVerified`、`assignedSku` 决定。这只说明展示页可以显示这张图，不是目标网站已经上架。
- 持久证据文件是 `image-availability.json`。当前 `records` 为空。没有记录就不是已放行，也不是已同步。
- 本仓库没有目标网站的写入接口，也没有把单张图从 `terralla.com` 画廊撤下的实现。`http://terralla.com` 只是草稿目标，不是授权。公开目录不登录。勾选走服务器接口，不代表正式商城可以上架。
- 原图在 Bunny / Drive。下架若将来发生，也只针对目标画廊里的那一张图，不删除原件，不删除整个产品。

## 勾选存在哪里（terrella-product-db，不是 crm-core）

图片文件仍在 Bunny 的 `products/{series}/{SKU}/ai/`。不要把图片文件同步进 Supabase。

勾选写入已经存在的 terrella-product-db（ref `wwsfmfxwhktglgmeukgr`）表 `public.product_image_selections`。本仓库不创建、不修改这张表，也不写 crm-core。`384a994`、`3e32522`、`f640c146` 那条 crm-core `internal_preview` 事件表、自定义角色和 Auth cookie 路径不要再接。仓库里不再带那份迁移。

表已经有这些列，名字不要改：`id`、`product_id`、`image_sha256`、`created_at`、`updated_at`。`product_id` 引用 `public.products(id)`，并和 `image_sha256` 唯一。RLS 已开启，anon 和 authenticated 没有策略。浏览器不能拿密钥。服务器只用这两个环境变量：

- `TERRELLA_PRODUCT_DB_URL`：terrella-product-db 的项目 URL，不是 crm-core。
- `TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY`：只放在服务器上。不要写成 `NEXT_PUBLIC_`，不要放进页面、测试夹具或日志。

不需要 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 或 crm-core 的密钥。公开产品册仍直接读 `products.json`，不要求登录。勾选的读写只走 `/api/internal-preview`。

CAT-001 / TR260002 在这张库里的商品 UUID 是 `0f057213-b8af-4982-9e44-582a2a1d3469`。正式商城商品 ID `426bf18c-8649-4aa5-939c-f0b33eca95f8` 不能当表的键。CAT-001 仍只接受原来的四条完整 SHA-256。其他 SKU 按 terrella-product-db 的 `products.sku` 或 `products.id` 查找已有行；找不到就拒绝，不猜测 ID，不插入商品行，也不改用别的编码。

勾选插入 `(product_id, image_sha256)`。取消勾选只删除这一对。不删除 Bunny 文件，不删除商品行。成功文案只在响应同时带 `saved`、`durable` 和 `store: terrella-product-db` 时出现。

`image-availability.json` 仍是正式放行和同步账本。这一步不往里面写。

这一次提交不合并 main，不部署到 Vercel、常用目录地址或 terralla.com。

## 后续正式同步（尚未执行，不能把勾选当商城）

图片版本已批准的数量是 CAT-001 四张、CAT-003 五张、CAT-006 四张。勾选可以按已有的 `products.sku` / `products.id` 落到 terrella-product-db。没有查到的 SKU 保持拒绝。禁止猜测 ID，禁止自动建行，也禁止改用 CAT-013/TR2605002。

正式同步仍要另一次独立终验和 Kevin 的 GO。到那时才做这些事，而且不在这一次里做：

1. 只用确认过的目标商品，按完整 SHA 逐张写入目标画廊字段。
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
