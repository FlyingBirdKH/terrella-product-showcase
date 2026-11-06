import { renderDetail } from "../src/render.js";

const detail = document.getElementById("detail");
const status = document.getElementById("trace-status");
let catalog = null;

function withIndexes(data) {
  return {
    ...data,
    indexes: {
      byAsset: Object.fromEntries(data.assets.map((asset) => [asset.id, asset])),
      byPrompt: Object.fromEntries(data.prompts.map((prompt) => [prompt.id, prompt])),
    },
  };
}

function show(productId, view, version) {
  if (!catalog) return;
  detail.hidden = false;
  detail.innerHTML = renderDetail(catalog, { productId, view, version });
  const next = productId === "FIXTURE-STRUCTURE" ? "#FIXTURE-STRUCTURE" : `#${productId}`;
  if (location.hash !== next) history.replaceState(null, "", next);
}

async function load() {
  try {
    const response = await fetch("data/catalog.json");
    if (!response.ok) throw new Error(String(response.status));
    catalog = withIndexes(await response.json());
    status.textContent = `多图清单已加载：Prompt ${catalog.prompts.length} 条；AI 成图字节未迁入；Bunny 上传 ${catalog.bunny_uploads_executed}；生产库未改。`;
    const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (hash === "FIXTURE-STRUCTURE" || catalog.products[hash]) show(hash, "hero", null);
  } catch (error) {
    status.textContent = "多图清单没有加载。请通过站点路径打开页面，而不是单独打开 HTML 文件。";
  }
}

document.body.addEventListener("click", (event) => {
  const open = event.target.closest("[data-open-sku]");
  if (open) {
    show(open.dataset.openSku, "hero", null);
    detail.scrollIntoView({ block: "start" });
    return;
  }
  const version = event.target.closest("[data-version-pick]");
  if (version) {
    show(version.dataset.product, version.dataset.view, version.dataset.versionPick);
    return;
  }
  const view = event.target.closest("[data-view]");
  if (view) show(view.dataset.product, view.dataset.view, view.dataset.version || null);
});

load();
