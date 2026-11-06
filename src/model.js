export const VIEWS = [
  { key: "hero", label: "主视觉" },
  { key: "top", label: "俯视" },
  { key: "macro", label: "材质微距" },
  { key: "side", label: "侧轮廓" },
  { key: "editorial", label: "编辑静物" },
];

export const VIEW_BY_LABEL = Object.fromEntries(VIEWS.map((view) => [view.label, view.key]));

export const BLOCKED_PACKAGE_IDS = ["F0CFVBR7ZQQ"];

const UNKNOWN = "unknown";

function unknownFields() {
  return {
    model_name: null,
    model_name_status: UNKNOWN,
    model_version: null,
    model_version_status: UNKNOWN,
    api_parameters: null,
    api_parameters_status: UNKNOWN,
    generated_at: null,
    generated_at_status: UNKNOWN,
    seed: null,
    seed_status: UNKNOWN,
  };
}

export function decideUpload(request = {}, env = {}) {
  const reasons = [];
  const packageId = request.package_id || request.source_package_id || null;
  if (packageId && BLOCKED_PACKAGE_IDS.includes(packageId)) reasons.push("blocked_package");
  if (request.retries_blocked_package) reasons.push("retry_blocked_package");
  if (request.alternate_channel && (request.source_was_review_blocked || (packageId && BLOCKED_PACKAGE_IDS.includes(packageId)))) {
    reasons.push("alternate_channel_forbidden");
  }
  if (request.split_batch_of_blocked) reasons.push("split_batch_forbidden");
  if (request.private_bytes_rehost) reasons.push("private_bytes_rehost_forbidden");
  if (!request.source_verifiable) reasons.push("source_not_verifiable");
  if (!request.authorization) reasons.push("missing_authorization");
  if (request.overwrite_original || request.delete_history) reasons.push("would_destroy_history");
  if (request.write_production_database) reasons.push("production_db_write_forbidden");
  if (request.uses_nova_password_for_terrella) reasons.push("wrong_credential_scope");
  if (request.hardcoded_secret) reasons.push("hardcoded_secret_forbidden");
  if (!env.TERRELLA_BUNNY_STORAGE_ZONE || !env.TERRELLA_BUNNY_STORAGE_PASSWORD) {
    reasons.push("missing_terrella_bunny_credentials");
  }
  return {
    decision: reasons.length ? "blocked" : "eligible_dry_run",
    executed: false,
    uploaded: false,
    reasons,
    required_approval: reasons.length
      ? [
          "解除 F0CFVBR7ZQQ 审核拒绝前，不得换渠道、换代理、换服务或拆批重传",
          "Terrella Bunny storage zone、hostname、API key 需另行提供，且不得写入仓库、不得用 NOVA 区密码顶替",
          "逐张资产需来源可核验，并有明确上传授权",
        ]
      : [],
  };
}

export function executeUpload(request, env) {
  const decision = decideUpload(request, env);
  return { ...decision, executed: false, uploaded: false, network: "not_called" };
}

function promptRecord(fields) {
  return {
    storage_location: `data/catalog.json#/prompts/${fields.id}`,
    body_status: "recorded",
    real_generation: true,
    ...unknownFields(),
    ...fields,
  };
}

function assetRecord(fields) {
  return {
    bunny_status: "not_uploaded",
    bunny_executed: false,
    local_uri: null,
    superseded_by: null,
    ...fields,
  };
}

function wuxingBody(item, viewKey, wuxing) {
  const label = VIEWS.find((view) => view.key === viewKey).label;
  const lens = wuxing.lens_lines[viewKey];
  if (item.base_mode === "verbatim_wood") {
    return {
      body: `${wuxing.wood_base}\n原片要点：${item.points}\n镜头：${label}：${lens}`,
      lens_resolution: "verbatim_canvas_bullet",
    };
  }
  const macroNote = viewKey === "macro" && item.macro_parenthetical
    ? `材质微距括号为 Canvas 原文：${item.macro_parenthetical}。`
    : "";
  return {
    body: [
      `共用底原文：${item.base_recorded}`,
      `共用底参照（Canvas 写「同上」，指向木款 CAT-045，未改写）：${wuxing.wood_base}`,
      `原片要点：${item.points}`,
      `镜头原文：${item.lens_recorded}`,
      macroNote,
      `本视角镜头句按「同上五句」对应到：${label}：${lens}`,
    ].filter(Boolean).join("\n"),
    lens_resolution: "canvas_says_同上五句_resolved_to_CAT-045",
  };
}

export function buildCatalog({ products, eastern, wuxing, policy }) {
  if (!Array.isArray(products) || products.length !== 96) {
    throw new Error(`expected 96 products, got ${products?.length}`);
  }
  const prompts = [];
  const assets = [];
  const migration = [];
  const productRecords = {};

  for (const product of products) {
    const originalId = `asset:${product.sku}:original-drive`;
    const thumbId = product.thumb ? `asset:${product.sku}:thumb` : null;
    assets.push(assetRecord({
      id: originalId,
      product_id: product.sku,
      role: "original",
      view: null,
      version_label: "drive-link-from-products-json",
      source_uri: product.original || null,
      source_check_status: product.original ? "link_recorded" : "missing",
      image_presence: product.original ? "remote_link_only" : "missing",
      prompt_id: null,
      source_original_asset_id: null,
      gen_task_id: null,
      notes: "products.json 原有 Drive 原图链接。未把原图字节复制到 Bunny，也未覆盖。",
    }));
    if (thumbId) {
      assets.push(assetRecord({
        id: thumbId,
        product_id: product.sku,
        role: "thumb",
        view: null,
        version_label: "github-pages-thumb-existing",
        local_uri: product.thumb,
        source_uri: product.original || null,
        source_check_status: "already_in_repo",
        image_presence: "local_file",
        prompt_id: null,
        source_original_asset_id: originalId,
        gen_task_id: null,
        notes: "基线仓库已有的压缩缩略图。保留，不重传，不当作 AI 图。",
      }));
    }
    productRecords[product.sku] = {
      sku: product.sku,
      code: product.code ?? null,
      name: product.name ?? null,
      category: product.category ?? null,
      status: product.status ?? null,
      product_type: product.product_type ?? null,
      notes: product.notes ?? null,
      directory_source: product.source ?? null,
      original_link: product.original ?? null,
      thumb: product.thumb ?? null,
      asset_ids: [originalId, thumbId].filter(Boolean),
      prompt_ids: [],
      gen_task_id: null,
      ai_image_status: "待补",
      prompt_status: "待补",
    };
  }

  for (const item of eastern.products) {
    const product = productRecords[item.sku];
    if (!product) throw new Error(`eastern sku missing ${item.sku}`);
    const version = item.prompt_version;
    const genTaskId = `gen:${item.sku}:${version}`;
    product.gen_task_id = genTaskId;
    product.prompt_status = "已收录正文";
    product.ai_image_status = "待补";
    product.canvas_drive_folders = item.canvas_drive_folders;
    product.prompt_source = `${eastern.source_canvas_id} ${item.heading}`;
    for (const prompt of item.prompts) {
      const view = VIEW_BY_LABEL[prompt.view_label];
      if (!view) throw new Error(`bad view ${prompt.view_label}`);
      const promptId = `prompt:${item.sku}:${view}:${version}`;
      const assetId = `asset:${item.sku}:prompt-view:${view}:${version}`;
      prompts.push(promptRecord({
        id: promptId,
        product_id: item.sku,
        view,
        view_label: prompt.view_label,
        version_label: version,
        body: prompt.body,
        source_canvas_id: eastern.source_canvas_id,
        source_heading: item.heading,
        source_note: item.source_note,
        lens_resolution: "verbatim_per_view",
        gen_task_id: genTaskId,
        source_original_asset_id: `asset:${item.sku}:original-drive`,
        applies_to_asset_id: assetId,
      }));
      assets.push(assetRecord({
        id: assetId,
        product_id: item.sku,
        role: "prompt_only_view",
        view,
        version_label: version,
        source_uri: null,
        source_file_id: null,
        source_check_status: "prompt_recorded_image_absent",
        image_presence: "not_in_source",
        prompt_id: promptId,
        source_original_asset_id: `asset:${item.sku}:original-drive`,
        catalog_thumb_asset_id: product.thumb ? `asset:${item.sku}:thumb` : null,
        gen_task_id: genTaskId,
        notes: "东方 Canvas 有该视角 Prompt 正文，没有对应 AI 成图文件。不把缩略图文件编号当成成图。",
      }));
      product.prompt_ids.push(promptId);
      product.asset_ids.push(assetId);
    }
    for (const file of item.ancillary_files || []) {
      const assetId = `asset:${item.sku}:ancillary:${file.file_id}`;
      assets.push(assetRecord({
        id: assetId,
        product_id: item.sku,
        role: "ancillary",
        view: null,
        version_label: version,
        source_file_id: file.file_id,
        source_filename: file.filename,
        source_check_status: "unclassified",
        image_presence: "not_rehosted",
        prompt_id: null,
        source_original_asset_id: `asset:${item.sku}:original-drive`,
        gen_task_id: genTaskId,
        notes: "Canvas 里另有一张未归入五视角的图片。未重传，也不把它算作某一镜头的 AI 成图。",
      }));
      product.asset_ids.push(assetId);
    }
  }

  for (const item of wuxing.products) {
    const product = productRecords[item.sku];
    if (!product) throw new Error(`wuxing sku missing ${item.sku}`);
    const version = wuxing.prompt_version;
    const genTaskId = `gen:${item.sku}:${version}`;
    product.gen_task_id = genTaskId;
    product.prompt_status = "已收录正文";
    product.ai_image_status = "来源已登记，字节未迁";
    product.canvas_drive_folder = item.canvas_drive_folder;
    product.prompt_source = `${wuxing.source_canvas_id} ${item.element}｜${item.code}`;
    const draftId = `asset:${item.sku}:rejected-draft`;
    assets.push(assetRecord({
      id: draftId,
      product_id: item.sku,
      role: "rejected_draft",
      view: null,
      version_label: "not-a-deliverable",
      source_uri: item.rejected_draft_drive_file,
      source_check_status: "marked_non_deliverable",
      image_presence: "not_rehosted",
      prompt_id: null,
      source_original_asset_id: `asset:${item.sku}:original-drive`,
      gen_task_id: genTaskId,
      notes: "Canvas 写明 *-product-new.jpg 为废稿，非交付。不进入版本选择，不上传。",
    }));
    product.asset_ids.push(draftId);
    for (const view of VIEWS) {
      const built = wuxingBody(item, view.key, wuxing);
      const file = item.ai_files[view.key];
      const promptId = `prompt:${item.sku}:${view.key}:${version}`;
      const assetId = `asset:${item.sku}:ai:${view.key}:${version}`;
      prompts.push(promptRecord({
        id: promptId,
        product_id: item.sku,
        view: view.key,
        view_label: view.label,
        version_label: version,
        body: built.body,
        source_canvas_id: wuxing.source_canvas_id,
        source_heading: `${item.element}｜${item.code}`,
        source_note: wuxing.note,
        lens_resolution: built.lens_resolution,
        gen_task_id: genTaskId,
        source_original_asset_id: `asset:${item.sku}:original-drive`,
        applies_to_asset_id: assetId,
      }));
      assets.push(assetRecord({
        id: assetId,
        product_id: item.sku,
        role: "ai",
        view: view.key,
        version_label: version,
        source_file_id: file.file_id,
        source_filename: file.filename,
        source_check_status: "file_id_recorded_bytes_not_copied",
        image_presence: "blocked_not_rehosted",
        prompt_id: promptId,
        source_original_asset_id: `asset:${item.sku}:original-drive`,
        catalog_thumb_asset_id: `asset:${item.sku}:thumb`,
        gen_task_id: genTaskId,
        upload_block_reason: "私有成图不换渠道重传。多图补丁 F0CFVBR7ZQQ 曾被审核拒绝。",
        notes: "五行 Canvas 嵌有该视角成图。本仓库只保留文件编号，没有图片字节，Bunny 未上传。",
      }));
      product.prompt_ids.push(promptId);
      product.asset_ids.push(assetId);
    }
  }

  const unbound = [];
  for (const demo of wuxing.unbound_demonstrations) {
    for (const file of demo.files) {
      unbound.push(assetRecord({
        id: `unbound:${file.file_id}`,
        product_id: null,
        role: file.role === "ai" ? "ai" : "original",
        view: file.view,
        version_label: wuxing.prompt_version,
        source_file_id: file.file_id,
        source_filename: file.filename,
        source_check_status: "unbound",
        image_presence: "blocked_not_rehosted",
        prompt_id: null,
        source_original_asset_id: null,
        gen_task_id: null,
        label: demo.label,
        notes: `${demo.canvas_status}。${demo.prompt_note}`,
        prompt_body_status: demo.prompt_body_status,
      }));
    }
  }

  const fixtureVersion = ["fixture-v1", "fixture-v2"];
  const fixture = {
    id: "FIXTURE-STRUCTURE",
    real: false,
    label: "结构验收样例（合成色块，不是产品，不是真实生成记录）",
    view: "hero",
    versions: fixtureVersion,
    original_asset_id: "fixture:original",
    assets: [
      assetRecord({
        id: "fixture:original",
        product_id: "FIXTURE-STRUCTURE",
        role: "original",
        view: "hero",
        version_label: "fixture-original",
        local_uri: "fixtures/original.png",
        source_check_status: "synthetic",
        image_presence: "local_file",
        prompt_id: null,
        gen_task_id: "gen:FIXTURE-STRUCTURE",
        notes: "合成色块，用于验收并排，不是产品原图。",
      }),
      assetRecord({
        id: "fixture:ai:v1",
        product_id: "FIXTURE-STRUCTURE",
        role: "ai",
        view: "hero",
        version_label: "fixture-v1",
        local_uri: "fixtures/ai-v1.png",
        source_check_status: "synthetic",
        image_presence: "local_file",
        prompt_id: "prompt:FIXTURE-STRUCTURE:hero:fixture-v1",
        source_original_asset_id: "fixture:original",
        gen_task_id: "gen:FIXTURE-STRUCTURE",
        notes: "合成色块，不是真实 AI 出图。",
      }),
      assetRecord({
        id: "fixture:ai:v2",
        product_id: "FIXTURE-STRUCTURE",
        role: "ai",
        view: "hero",
        version_label: "fixture-v2",
        local_uri: "fixtures/ai-v2.png",
        source_check_status: "synthetic",
        image_presence: "local_file",
        prompt_id: "prompt:FIXTURE-STRUCTURE:hero:fixture-v2",
        source_original_asset_id: "fixture:original",
        gen_task_id: "gen:FIXTURE-STRUCTURE",
        notes: "合成色块的第二版，不是真实 AI 出图。",
      }),
    ],
    prompts: [
      promptRecord({
        id: "prompt:FIXTURE-STRUCTURE:hero:fixture-v1",
        product_id: "FIXTURE-STRUCTURE",
        view: "hero",
        view_label: "主视觉",
        version_label: "fixture-v1",
        body: "【非真实】结构验收样例 Prompt v1。只用于检查版本切换，不是产品生成记录。",
        body_status: "fixture",
        real_generation: false,
        source_canvas_id: null,
        source_note: "仓库内合成样例",
        lens_resolution: "fixture",
        gen_task_id: "gen:FIXTURE-STRUCTURE",
        source_original_asset_id: "fixture:original",
        applies_to_asset_id: "fixture:ai:v1",
        model_name_status: "not_applicable_fixture",
        model_version_status: "not_applicable_fixture",
        api_parameters_status: "not_applicable_fixture",
        generated_at_status: "not_applicable_fixture",
        seed_status: "not_applicable_fixture",
      }),
      promptRecord({
        id: "prompt:FIXTURE-STRUCTURE:hero:fixture-v2",
        product_id: "FIXTURE-STRUCTURE",
        view: "hero",
        view_label: "主视觉",
        version_label: "fixture-v2",
        body: "【非真实】结构验收样例 Prompt v2。只用于检查版本切换，不是产品生成记录。",
        body_status: "fixture",
        real_generation: false,
        source_canvas_id: null,
        source_note: "仓库内合成样例",
        lens_resolution: "fixture",
        gen_task_id: "gen:FIXTURE-STRUCTURE",
        source_original_asset_id: "fixture:original",
        applies_to_asset_id: "fixture:ai:v2",
        model_name_status: "not_applicable_fixture",
        model_version_status: "not_applicable_fixture",
        api_parameters_status: "not_applicable_fixture",
        generated_at_status: "not_applicable_fixture",
        seed_status: "not_applicable_fixture",
      }),
    ],
  };

  for (const asset of assets) {
    migration.push({
      asset_id: asset.id,
      product_id: asset.product_id,
      bunny_status: "not_uploaded",
      executed: false,
      decision: "blocked",
      reasons: asset.role === "thumb" && asset.image_presence === "local_file"
        ? ["already_on_github_pages", "missing_terrella_bunny_credentials", "no_production_go_in_this_change"]
        : ["bytes_not_approved_for_rehost", "missing_terrella_bunny_credentials", "no_production_go_in_this_change"],
    });
  }
  migration.push({
    asset_id: "package:F0CFVBR7ZQQ",
    product_id: null,
    bunny_status: "blocked",
    executed: false,
    decision: "blocked",
    reasons: ["blocked_package", "alternate_channel_forbidden", "file_too_large_for_reader"],
    required_approval: policy.blocked_packages[0].reason,
  });

  const byAsset = Object.fromEntries(assets.map((asset) => [asset.id, asset]));
  const byPrompt = Object.fromEntries(prompts.map((prompt) => [prompt.id, prompt]));

  return {
    schema_version: 1,
    responsibility: "Cursor",
    baseline_commit: "2124d3470dd993fdedee8e4b57223ea5d1361871",
    production_db_applied: false,
    bunny_uploads_executed: 0,
    ava_zip_applied: false,
    ava_zip_file_id: "F0CFVBR7ZQQ",
    products: productRecords,
    assets,
    prompts,
    unbound,
    fixture,
    migration,
    indexes: { byAsset, byPrompt },
    policy_id: policy.policy_id,
  };
}

export function listVersions(catalog, productId, view) {
  if (productId === "FIXTURE-STRUCTURE") return catalog.fixture.versions.slice();
  const product = catalog.products[productId];
  if (!product) return [];
  const versions = [];
  for (const promptId of product.prompt_ids) {
    const prompt = catalog.indexes.byPrompt[promptId];
    if (prompt.view === view && !versions.includes(prompt.version_label)) versions.push(prompt.version_label);
  }
  return versions;
}

export function pairFor(catalog, productId, view = "hero", versionLabel = null) {
  if (productId === "FIXTURE-STRUCTURE") {
    const version = versionLabel || "fixture-v1";
    const ai = catalog.fixture.assets.find((asset) => asset.version_label === version && asset.role === "ai");
    const original = catalog.fixture.assets.find((asset) => asset.role === "original");
    const prompt = catalog.fixture.prompts.find((item) => item.version_label === version);
    return {
      real: false,
      product_id: productId,
      view,
      version_label: version,
      original,
      ai,
      prompt,
      same_view: true,
      original_view_status: "样例左右都是主视觉合成图",
    };
  }
  const product = catalog.products[productId];
  if (!product) return null;
  const versions = listVersions(catalog, productId, view);
  const version = versionLabel || versions[0] || null;
  const original = catalog.indexes.byAsset[`asset:${productId}:original-drive`] || null;
  const thumb = product.thumb ? catalog.indexes.byAsset[`asset:${productId}:thumb`] : null;
  const ai = product.asset_ids
    .map((id) => catalog.indexes.byAsset[id])
    .find((asset) => asset && asset.view === view && asset.version_label === version && (asset.role === "ai" || asset.role === "prompt_only_view")) || null;
  const prompt = ai?.prompt_id ? catalog.indexes.byPrompt[ai.prompt_id] : null;
  return {
    real: true,
    product_id: productId,
    view,
    version_label: version,
    original,
    thumb,
    ai,
    prompt,
    same_view: Boolean(ai),
    original_view_status: thumb
      ? "待补：没有按该视角分开的原图文件。左侧是基线目录缩略，不是该镜头的独立原片。"
      : "原图与缩略图都缺失。",
  };
}

export function traceAsset(catalog, assetId) {
  if (assetId.startsWith("fixture:")) {
    const asset = catalog.fixture.assets.find((item) => item.id === assetId);
    const prompt = asset?.prompt_id ? catalog.fixture.prompts.find((item) => item.id === asset.prompt_id) : null;
    const original = catalog.fixture.assets.find((item) => item.id === "fixture:original");
    return { real: false, asset, prompt, source_original: original };
  }
  const asset = catalog.indexes.byAsset[assetId];
  if (!asset) return null;
  const prompt = asset.prompt_id ? catalog.indexes.byPrompt[asset.prompt_id] : null;
  const sourceOriginal = asset.source_original_asset_id
    ? catalog.indexes.byAsset[asset.source_original_asset_id]
    : null;
  const thumb = asset.catalog_thumb_asset_id ? catalog.indexes.byAsset[asset.catalog_thumb_asset_id] : null;
  return {
    real: true,
    asset,
    prompt,
    source_original: sourceOriginal,
    catalog_thumb: thumb,
    product: catalog.products[asset.product_id] || null,
  };
}

export function summarize(catalog) {
  const products = Object.values(catalog.products);
  return {
    products: products.length,
    prompts: catalog.prompts.length,
    ai_assets_with_file_id: catalog.assets.filter((asset) => asset.role === "ai" && asset.source_file_id).length,
    ai_assets_local: catalog.assets.filter((asset) => asset.role === "ai" && asset.local_uri).length,
    prompt_only_views: catalog.assets.filter((asset) => asset.role === "prompt_only_view").length,
    missing_thumbs: products.filter((product) => !product.thumb).length,
    bunny_executed: catalog.migration.filter((row) => row.executed).length,
    production_db_applied: catalog.production_db_applied,
  };
}
