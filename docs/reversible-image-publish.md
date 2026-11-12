# 单张图片的可逆上架 / 下架（尚未接通）

这是实现说明，不是已上线的网站操作。当前展示页不能上架，也不能下架。

## 现在仓库里实际有什么

- 公开页面是 `index.html`。除 CAT-001 内部预览以外，勾选仍在内存里的 `releasePicks`，复制到剪贴板，刷新就没了。CAT-001 的勾选只在共享 Supabase 记录读回成功后才算保存。`internal-preview.json` 不是真源，接口不会写它。
- 图是否出现在展示页，由页面内嵌的 `publicCopyApproved`、`contentVerified`、`byteVerified`、`assignedSku` 决定。这只说明展示页可以显示这张图，不是目标网站已经上架。
- 持久证据文件是 `image-availability.json`。当前 `records` 为空。没有记录就不是已放行，也不是已同步。
- 本仓库没有目标网站的写入接口，没有管理人登录，也没有把单张图从 `terralla.com` 画廊撤下的实现。`http://terralla.com` 只是草稿目标，不是授权。
- 原图在 Bunny / Drive。下架若将来发生，也只针对目标画廊里的那一张图，不删除原件，不删除整个产品。

## 内部预览（共享记录，不是正式商城）

CAT-001（产品编号 `426bf18c-8649-4aa5-939c-f0b33eca95f8`，SKU CAT-001，货号 TR260002，handle `eastern-heritage-tr260002`，brand `terralla`）的勾选按完整 SHA-256 写入 crm-core schema `internal_preview`。状态保持暂停、非公开。这一步没有连接生产库，也没有改商品状态。

鉴权契约，沿用 Terrella 商品表已有的 JWT role，不新建登录，不读 `auth.users`，不创建管理员：

- 写入：JWT `role` 是 `kevin_admin` 或 `terralla_admin`，并且这一行的 `brand_id` 固定为 `terralla`。
- 只读：`terralla_team` 可以读，不能写。
- 拒绝：`anon`、普通 `authenticated`、`service_role`，以及 supplier `product_images` 用的 `current_app_role()` / `is_internal_editor()` 下的 `admin`、`sourcing_manager`。本迁移不调用这两个函数，也不放宽它们。
- 尚未核到有用户会话带 `kevin_admin` 或 `terralla_admin`。没有该会话时接口拒绝，页面不显示已保存。

匿名读取正式商品的条件保持原样：`deleted_at` 为空，且 `status` 属于 `shortlisted`、`ready_for_shopify`、`live`。本迁移不扩大这个白名单，也不把 `paused` 加进去。

- 展示页和 `cat-001-internal-preview.html` 都通过 `/api/internal-preview` 读写同一张事件表。成功文案只在响应同时带 `saved`、`durable` 和 `store: supabase` 时出现。读失败会清空勾选，不会显示「已读回」。
- 浏览器不保存图片选择，也不持有 service role。本仓库不发行 JWT。
- 匿名请求、角色不符、短 SHA、其他 productId 都会拒绝。同一 `eventId` 且内容相同是幂等的；内容不同或 `baseRevision` 过期返回冲突，页面重新读取，不覆盖。
- 取消勾选追加一条 `selected: false` 的事件，只解除内部预览关联。Bunny 地址还在页面数据里，商品记录还在。
- `image-availability.json` 仍是正式放行和同步账本。这一步不往里面写。

服务端配置只需要这两个名字，值由原部署者填写。本环境看不到该 Vercel 项目的环境变量：

- `SUPABASE_URL`：crm-core 的 API 地址，只放服务端。
- `SUPABASE_ANON_KEY`：只放服务端。

不要配置 `SUPABASE_SERVICE_ROLE_KEY`，尤其不要放进浏览器。没有这两个变量，或 JWT role 不对时，接口返回失败，`saved` 为 false。

迁移文件：`supabase/migrations/20261112160000_internal_preview_shared.sql`。回滚文件：`supabase/rollbacks/20261112160000_internal_preview_shared_down.sql`。回滚只删除 `internal_preview` 和两个公开函数，不改 `terralla_skus`、商品状态或 Bunny。本仓库不执行生产迁移。crm-core 上的 `kevin_admin`、`terralla_admin`、`terralla_team` 角色需要已经存在；迁移不会创建登录用户。

本机没有上述两个变量时，`node scripts/serve-with-internal-preview.mjs` 只会打开失败关闭的页面。这不是部署，也不是正式商城。

## 后续 13 张正式同步（尚未执行，不能把预览当商城）

图片版本已批准的数量是 CAT-001 四张、CAT-003 五张、CAT-006 四张。当前共享预览只接受 CAT-001 那四条完整 SHA 和已确认的商品 ID `426bf18c-8649-4aa5-939c-f0b33eca95f8`。按 sku、handle、external_id 精确查询，CAT-003/TR260004 与 CAT-006/TR260007 都是空的。完全不同的编码还没有排除，所以禁止猜测 ID，禁止自动建行，也禁止改用 CAT-013/TR2605002。

正式同步仍要另一次独立终验和 Kevin 的 GO。到那时才做这些事，而且不在这一次里做：

1. 只用确认过的 crm-core 商品 ID，按完整 SHA 逐张写入目标画廊字段。
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
