# 单张图片的可逆上架 / 下架（尚未接通）

这是实现说明，不是已上线的网站操作。当前展示页不能上架，也不能下架。

## 现在仓库里实际有什么

- 公开页面是 `index.html`。除 CAT-001 内部预览以外，勾选仍在内存里的 `releasePicks`，复制到剪贴板，刷新就没了。CAT-001 的勾选只在共享 Supabase 记录读回成功后才算保存。`internal-preview.json` 不是真源，接口不会写它。
- 图是否出现在展示页，由页面内嵌的 `publicCopyApproved`、`contentVerified`、`byteVerified`、`assignedSku` 决定。这只说明展示页可以显示这张图，不是目标网站已经上架。
- 持久证据文件是 `image-availability.json`。当前 `records` 为空。没有记录就不是已放行，也不是已同步。
- 本仓库没有目标网站的写入接口，也没有把单张图从 `terralla.com` 画廊撤下的实现。`http://terralla.com` 只是草稿目标，不是授权。内部预览有单独的已有账号登录，不代表正式商城可以上架。
- 原图在 Bunny / Drive。下架若将来发生，也只针对目标画廊里的那一张图，不删除原件，不删除整个产品。

## 内部预览（共享记录，不是正式商城）

`384a994e` 把 EXECUTE 授给不存在的数据库角色，不能实施。`f640c146` 的标准角色授权可以保留，但不要把那一版迁移原文打到原库：它写成 crm-core，并写死商品 ID `426bf18c-8649-4aa5-939c-f0b33eca95f8`。原库 `terrella-product-db`（ref `wwsfmfxwhktglgmeukgr`）的 `public.products` 里，CAT-001 / code TR260002 的 id 是 `0f057213-b8af-4982-9e44-582a2a1d3469`，status 是 `candidate`。`426bf18c…` 在这张表里不存在。

现在的设计按 [Supabase JWT 字段](https://supabase.com/docs/guides/auth/jwt-fields) 和 [密码登录](https://supabase.com/docs/guides/auth/passwords)：用户令牌的 `role` 只能是 `authenticated`，`sub` 是用户 UUID。写入只认 `app_metadata.terrella_brand_admin = terralla`。读取同时接受这个写入声明，或分开的 `app_metadata.terrella_brand_reader = terralla`。`user_metadata` 不参与判断。supplier 的 `admin` / `sourcing_manager` 也不参与判断。这些声明要由操作者在 Supabase 控制台改已有用户；本仓库不改 metadata。

登录请求是 `POST /auth/v1/token?grant_type=password`。访问令牌 cookie 的 Max-Age 用 Auth 返回的 `expires_in`（通常 3600 秒）。刷新 cookie 不照抄这个数，绝对会话最长 12 小时，刷新只使用剩余时间，不会把会话重新延长。页面遇到 401 会自动刷新一次并重试原请求，失败就停，不循环，也不把令牌写进页面。退出会清掉访问、刷新和到期 cookie。

同源检查按 Fetch Metadata：浏览器请求必须带 `Sec-Fetch-Site: same-origin`、`Content-Type: application/json`，并且 `Origin` 和 Host 一致。浏览器请求缺 `Origin` 会拒绝。没有 Fetch Metadata、也没有 `Origin` 的服务端 JSON 请求可以继续。跨站、表单内容类型都会拒绝。

本地 `tests/preview-rest-gateway.mjs` 是假的 Auth 和 PostgREST，只用于回归。它不是 `wwsfmfxwhktglgmeukgr`，也不能代替真实 Supabase 登录。

验收一个已部署的 SHA 时，先确认该部署的 Git SHA 就是要验的提交，再确认服务端已有 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`，以及测试账号的 `app_metadata` 已分别有 admin 或 reader 声明。用两个浏览器登录：admin 写入一张图，reader 只能读回，不能改。退出后 cookie 清除。没有真实会话和已确认的 Vercel 项目时，不能把这一步报成线上可用。

登录用已有账号的密码授权，对应官方 `POST /auth/v1/token?grant_type=password`，请求头只带 anon key。成功后访问令牌和刷新令牌放在 `HttpOnly`、`SameSite=Lax` 的 cookie，HTTPS 上再加 `Secure`。JSON 响应不返回令牌。页面不把 JWT 放进 `sessionStorage`，也不提供粘贴框。没有注册、邀请或修改 `auth` 用户元数据的接口。

公开产品册仍直接读 `products.json`，不要求登录。内部预览接口单独失败关闭。

CAT-001（`public.products.id` `0f057213-b8af-4982-9e44-582a2a1d3469`，SKU CAT-001，货号 TR260002，status `candidate`）的勾选按完整 SHA-256 写入 `terrella-product-db` 的 schema `internal_preview`。`actor` 是 `auth.uid()`。这一步不改 `products`、`product_assets`、`product_image_selections`，也不改 status。迁移还没有在原库执行。

- 表开启 RLS 且不授权给 `anon`、`authenticated`、`service_role` 直接读写。写入只经过 private schema 里的 security definer 函数；公开函数是 security invoker，只把 EXECUTE 授给已有的 `authenticated`。
- 缺 `sub`、`sub` 和 `auth.uid()` 不一致、`role` 不是 `authenticated`、或 `app_metadata.terrella_brand_admin` 不是 `terralla`，都拒绝。只在 `user_metadata` 里放同样的声明也拒绝。
- 登录成功但没有该声明时，页面说明账号已登录、预览没有保存。不能把这说成预览可用。
- 成功文案只在响应同时带 `saved`、`durable` 和 `store: supabase` 时出现。
- 取消勾选追加一条 `selected: false`。Bunny 原件和商品记录还在。
- `image-availability.json` 仍是正式放行和同步账本。这一步不往里面写。

匿名读取正式商品的条件保持原样：`deleted_at` 为空，且 `status` 属于 `shortlisted`、`ready_for_shopify`、`live`。本迁移不改这条。

服务端配置只需要这两个名字：`SUPABASE_URL`（`https://wwsfmfxwhktglgmeukgr.supabase.co` 这一项目）、`SUPABASE_ANON_KEY`。不要配置 `SUPABASE_SERVICE_ROLE_KEY`。

还缺一个非秘密前置：某个已经存在的 Auth 用户，其 `app_metadata.terrella_brand_admin` 被设为 `terralla`。本仓库不写这个声明。没有它时，标准登录可以完成，预览写入仍然失败关闭。这个环境没有真实会话，也看不到 Vercel 项目，不能报线上可用。

迁移：`supabase/migrations/20261112160000_internal_preview_shared.sql`。回滚：`supabase/rollbacks/20261112160000_internal_preview_shared_down.sql`。回滚只删除这次创建的函数、事件表和 schema。本仓库不执行生产迁移。

## 后续 13 张正式同步（尚未执行，不能把预览当商城）

图片版本已批准的数量是 CAT-001 四张、CAT-003 五张、CAT-006 四张。当前共享预览只接受 CAT-001 那四条完整 SHA 和原库商品 ID `0f057213-b8af-4982-9e44-582a2a1d3469`。CAT-003/TR260004 与 CAT-006/TR260007 还没有在这张 `public.products` 表里确认到行，禁止猜测 ID，禁止自动建行，也禁止改用 CAT-013/TR2605002。

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
