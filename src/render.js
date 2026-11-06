import { VIEWS, listVersions, pairFor, traceAsset } from "./model.js";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function figure(title, asset, emptyText) {
  if (asset?.local_uri) {
    return `<figure class="pair-fig">
      <figcaption>${escapeHtml(title)}</figcaption>
      <img src="${escapeHtml(asset.local_uri)}" alt="${escapeHtml(title)}" />
    </figure>`;
  }
  const detail = asset
    ? `${emptyText} 状态：${asset.image_presence}。${asset.source_file_id ? `来源文件 ${asset.source_file_id}。` : ""}${asset.notes || ""}`
    : emptyText;
  return `<figure class="pair-fig missing">
    <figcaption>${escapeHtml(title)}</figcaption>
    <div class="missing-box" role="note">${escapeHtml(detail)}</div>
  </figure>`;
}

export function renderDetail(catalog, state) {
  const productId = state.productId;
  const view = state.view || "hero";
  const product = productId === "FIXTURE-STRUCTURE" ? catalog.fixture : catalog.products[productId];
  if (!product) {
    return `<div class="detail-card"><p role="alert">没有这个产品编号：${escapeHtml(productId)}</p></div>`;
  }
  const versions = listVersions(catalog, productId, view);
  const version = state.version || versions[0] || null;
  const pair = pairFor(catalog, productId, view, version);
  const trace = pair.ai ? traceAsset(catalog, pair.ai.id) : null;
  const real = productId !== "FIXTURE-STRUCTURE";
  const title = real ? `${product.name || product.sku} · ${product.sku}` : product.label;
  const viewButtons = VIEWS.map((item) => {
    const active = item.key === view ? " active" : "";
    return `<button type="button" class="choice${active}" data-product="${escapeHtml(productId)}" data-view="${item.key}" data-version="${escapeHtml(version || "")}">${item.label}</button>`;
  }).join("");
  const versionButtons = (versions.length ? versions : ["待补"]).map((item) => {
    const active = item === version ? " active" : "";
    return `<button type="button" class="choice${active}" data-product="${escapeHtml(productId)}" data-view="${escapeHtml(view)}" data-version-pick="${escapeHtml(item)}">${escapeHtml(item)}</button>`;
  }).join("");
  const prompt = pair.prompt;
  const promptBlock = prompt
    ? `<section class="prompt-block">
        <h3>Prompt · ${escapeHtml(prompt.version_label)}</h3>
        <p class="storage">存放：<code>${escapeHtml(prompt.storage_location)}</code></p>
        <p>正文状态：${escapeHtml(prompt.body_status)}。镜头对应：${escapeHtml(prompt.lens_resolution)}。</p>
        <pre class="prompt-body">${escapeHtml(prompt.body)}</pre>
      </section>`
    : `<section class="prompt-block"><h3>Prompt</h3><p role="note"><strong>待补</strong>：没有该视角的 Prompt 记录，未倒填正文。</p></section>`;
  const traceBlock = `<section class="trace-block">
    <h3>追溯</h3>
    <dl>
      <dt>产品稳定 ID</dt><dd>${escapeHtml(productId)}</dd>
      <dt>图源标识</dt><dd>${escapeHtml(real ? (product.directory_source || "待补") : "合成样例，无图源")}</dd>
      <dt>原图资产</dt><dd>${escapeHtml(pair.original?.id || "待补")}</dd>
      <dt>原图链接</dt><dd>${real && product.original_link ? `<a href="${escapeHtml(product.original_link)}" target="_blank" rel="noopener noreferrer">打开已记录的原图链接</a>` : "待补"}</dd>
      <dt>目录缩略</dt><dd>${escapeHtml(real ? (product.thumb || "缺失") : pair.original.local_uri)}</dd>
      <dt>AI 资产</dt><dd>${escapeHtml(pair.ai?.id || "待补")}</dd>
      <dt>AI 来源文件</dt><dd>${escapeHtml(pair.ai?.source_file_id || "无")}</dd>
      <dt>Prompt 记录</dt><dd>${escapeHtml(prompt?.id || "待补")}</dd>
      <dt>生成任务</dt><dd>${escapeHtml(prompt?.gen_task_id || pair.ai?.gen_task_id || "待补")}</dd>
      <dt>模型</dt><dd>${escapeHtml(prompt?.model_name_status || UNKNOWN_STATUS(real))}</dd>
      <dt>模型版本</dt><dd>${escapeHtml(prompt?.model_version_status || UNKNOWN_STATUS(real))}</dd>
      <dt>API 参数</dt><dd>${escapeHtml(prompt?.api_parameters_status || UNKNOWN_STATUS(real))}</dd>
      <dt>生成时间</dt><dd>${escapeHtml(prompt?.generated_at_status || UNKNOWN_STATUS(real))}</dd>
      <dt>seed</dt><dd>${escapeHtml(prompt?.seed_status || UNKNOWN_STATUS(real))}</dd>
      <dt>同视角说明</dt><dd>${escapeHtml(pair.original_view_status || "")}</dd>
    </dl>
    ${trace?.source_original ? `<p>从 AI 记录回到原图资产：<code>${escapeHtml(trace.source_original.id)}</code></p>` : ""}
  </section>`;
  const notes = real && product.notes ? `<p class="kept-notes">原备注：${escapeHtml(product.notes)}</p>` : "";
  const banner = real
    ? ""
    : `<p class="fixture-banner" role="note">这是合成验收样例。色块和 Prompt 都不是真实产品或真实生成。</p>`;
  return `<article class="detail-card" id="detail-${escapeHtml(productId)}" data-product="${escapeHtml(productId)}">
    ${banner}
    <h2>${escapeHtml(title)}</h2>
    <p class="detail-meta">${escapeHtml(real ? `${product.category || ""} · ${product.product_type || ""} · ${product.code || "无编码"}` : "不计入 96 款产品")}</p>
    ${notes}
    <div class="choices" role="group" aria-label="视角">${viewButtons}</div>
    <div class="choices" role="group" aria-label="版本">${versionButtons}</div>
    <div class="pair">
      ${figure(real ? "原图侧 · 目录缩略" : "原图侧", real ? pair.thumb : pair.original, real ? "原图缩略缺失。" : "样例缺失。")}
      ${figure(pair.ai?.role === "ai" ? "AI 侧" : "AI 侧 · 待补", pair.ai?.role === "ai" ? pair.ai : null, "AI 成图未在本仓库。")}
    </div>
    ${promptBlock}
    ${traceBlock}
  </article>`;
}

function UNKNOWN_STATUS(real) {
  return real ? "unknown" : "not_applicable_fixture";
}
