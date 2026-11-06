import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildCatalog, decideUpload, executeUpload, pairFor, summarize, traceAsset } from "../src/model.js";
import { renderDetail } from "../src/render.js";

const products = JSON.parse(readFileSync(new URL("../products.json", import.meta.url)));
const eastern = JSON.parse(readFileSync(new URL("../data/eastern-prompts.json", import.meta.url)));
const wuxing = JSON.parse(readFileSync(new URL("../data/wuxing-prompts.json", import.meta.url)));
const policy = JSON.parse(readFileSync(new URL("../data/upload-policy.json", import.meta.url)));
const catalog = buildCatalog({ products, eastern, wuxing, policy });

test("keeps the 96 baseline product ids and source fields", () => {
  assert.equal(Object.keys(catalog.products).length, 96);
  for (const product of products) {
    const copy = catalog.products[product.sku];
    assert.equal(copy.code, product.code ?? null);
    assert.equal(copy.directory_source, product.source ?? null);
    assert.equal(copy.original_link, product.original ?? null);
    assert.equal(copy.thumb, product.thumb ?? null);
    assert.equal(copy.notes, product.notes ?? null);
  }
});

test("one product links several assets and separates original from AI", () => {
  const product = catalog.products["CAT-045"];
  const assets = product.asset_ids.map((id) => catalog.indexes.byAsset[id]);
  assert.ok(assets.length > 5);
  assert.ok(assets.some((asset) => asset.role === "original"));
  assert.ok(assets.some((asset) => asset.role === "thumb"));
  assert.equal(assets.filter((asset) => asset.role === "ai").length, 5);
  assert.ok(assets.every((asset) => asset.product_id === "CAT-045"));
});

test("same product and view can be paired, with version selection", () => {
  const pair = pairFor(catalog, "CAT-045", "macro", "v2026.11.04-11");
  assert.equal(pair.original.id, "asset:CAT-045:original-drive");
  assert.equal(pair.thumb.local_uri, "images/CAT-045.jpg");
  assert.equal(pair.ai.view, "macro");
  assert.equal(pair.ai.role, "ai");
  assert.equal(pair.prompt.view, "macro");
  assert.equal(pair.prompt.applies_to_asset_id, pair.ai.id);
  assert.match(pair.original_view_status, /待补/);
});

test("AI asset traces to the original asset and its own prompt", () => {
  const traced = traceAsset(catalog, "asset:CAT-045:ai:hero:v2026.11.04-11");
  assert.equal(traced.prompt.id, "prompt:CAT-045:hero:v2026.11.04-11");
  assert.equal(traced.prompt.storage_location, "data/catalog.json#/prompts/prompt:CAT-045:hero:v2026.11.04-11");
  assert.match(traced.prompt.body, /淡绿兔毛/);
  assert.equal(traced.source_original.id, "asset:CAT-045:original-drive");
  assert.equal(traced.source_original.source_uri, catalog.products["CAT-045"].original_link);
  assert.equal(traced.asset.source_file_id, "F0CEVNL3W9H");
  assert.equal(traced.asset.local_uri, null);
  assert.equal(traced.prompt.model_name, null);
  assert.equal(traced.prompt.model_name_status, "unknown");
  assert.equal(traced.prompt.generated_at, null);
  assert.equal(traced.prompt.seed, null);
  assert.equal(traced.prompt.api_parameters, null);
});

test("duplicate code TR260008 keeps ring and bracelet prompts apart", () => {
  const ring = pairFor(catalog, "CAT-007", "hero").prompt.body;
  const bracelet = pairFor(catalog, "CAT-008", "hero").prompt.body;
  assert.match(ring, /金戒/);
  assert.match(bracelet, /手镯/);
  assert.equal(ring.includes("多圈蛇形编织金手镯"), false);
});

test("missing history stays pending and is not backfilled", () => {
  const missing = catalog.products["CAT-033"];
  assert.equal(missing.thumb, null);
  assert.equal(missing.prompt_ids.length, 0);
  assert.equal(missing.prompt_status, "待补");
  assert.equal(missing.ai_image_status, "待补");
  const pair = pairFor(catalog, "CAT-033", "hero");
  assert.equal(pair.prompt, null);
  assert.equal(pair.thumb, null);
  const html = renderDetail(catalog, { productId: "CAT-033", view: "hero" });
  assert.match(html, /待补/);
  assert.equal(html.includes("seed="), false);
});

test("eastern prompts are stored per view and do not pretend an AI file exists", () => {
  const pair = pairFor(catalog, "CAT-001", "side");
  assert.equal(pair.ai.role, "prompt_only_view");
  assert.equal(pair.ai.image_presence, "not_in_source");
  assert.equal(pair.ai.source_file_id, null);
  assert.match(pair.prompt.body, /Image-to-image/);
  assert.equal(catalog.prompts.filter((prompt) => prompt.product_id.startsWith("CAT-0") && prompt.source_canvas_id === "F0CEPRS2BBP").length, 160);
});

test("fixture side-by-side switches versions and is labeled unreal", () => {
  const first = pairFor(catalog, "FIXTURE-STRUCTURE", "hero", "fixture-v1");
  const second = pairFor(catalog, "FIXTURE-STRUCTURE", "hero", "fixture-v2");
  assert.equal(first.real, false);
  assert.equal(first.original.local_uri, "fixtures/original.png");
  assert.equal(first.ai.local_uri, "fixtures/ai-v1.png");
  assert.equal(second.ai.local_uri, "fixtures/ai-v2.png");
  assert.notEqual(first.prompt.body, second.prompt.body);
  const html = renderDetail(catalog, { productId: "FIXTURE-STRUCTURE", view: "hero", version: "fixture-v2" });
  assert.match(html, /不是真实产品/);
  assert.match(html, /fixtures\/ai-v2\.png/);
  assert.match(html, /fixtures\/original\.png/);
});

test("upload limits block the rejected package, alternate channels, and missing access", () => {
  const blockedPackage = decideUpload({
    package_id: "F0CFVBR7ZQQ",
    source_verifiable: true,
    authorization: true,
  }, { TERRELLA_BUNNY_STORAGE_ZONE: "zone", TERRELLA_BUNNY_STORAGE_PASSWORD: "secret" });
  assert.equal(blockedPackage.decision, "blocked");
  assert.ok(blockedPackage.reasons.includes("blocked_package"));

  const alternate = decideUpload({
    package_id: "F0CFVBR7ZQQ",
    alternate_channel: "proxy.example",
    source_was_review_blocked: true,
    source_verifiable: true,
    authorization: true,
  });
  assert.ok(alternate.reasons.includes("alternate_channel_forbidden"));

  const split = executeUpload({
    split_batch_of_blocked: true,
    source_verifiable: true,
    authorization: true,
    private_bytes_rehost: true,
  });
  assert.equal(split.uploaded, false);
  assert.equal(split.network, "not_called");
  assert.ok(split.reasons.includes("split_batch_forbidden"));
  assert.ok(split.reasons.includes("private_bytes_rehost_forbidden"));

  const unverifiable = decideUpload({ source_verifiable: false, authorization: false });
  assert.ok(unverifiable.reasons.includes("source_not_verifiable"));
  assert.ok(unverifiable.reasons.includes("missing_authorization"));
  assert.ok(unverifiable.reasons.includes("missing_terrella_bunny_credentials"));

  const nova = decideUpload({
    source_verifiable: true,
    authorization: true,
    uses_nova_password_for_terrella: true,
    overwrite_original: true,
    write_production_database: true,
    hardcoded_secret: true,
  });
  for (const reason of ["wrong_credential_scope", "would_destroy_history", "production_db_write_forbidden", "hardcoded_secret_forbidden"]) {
    assert.ok(nova.reasons.includes(reason), reason);
  }
});

test("a verifiable request can pass the gate and still does not upload", () => {
  const env = { TERRELLA_BUNNY_STORAGE_ZONE: "terrella-test", TERRELLA_BUNNY_STORAGE_PASSWORD: "not-a-real-secret" };
  const request = {
    source_verifiable: true,
    authorization: true,
    package_id: "local-synthetic",
    alternate_channel: false,
  };
  const decision = decideUpload(request, env);
  assert.equal(decision.decision, "eligible_dry_run");
  assert.equal(decision.uploaded, false);
  const executed = executeUpload(request, env);
  assert.equal(executed.executed, false);
  assert.equal(executed.uploaded, false);
  assert.equal(executed.network, "not_called");
});

test("migration manifest records nothing uploaded and no production write", () => {
  const summary = summarize(catalog);
  assert.equal(summary.products, 96);
  assert.equal(summary.prompts, 185);
  assert.equal(summary.ai_assets_with_file_id, 25);
  assert.equal(summary.ai_assets_local, 0);
  assert.equal(summary.prompt_only_views, 160);
  assert.equal(summary.missing_thumbs, 10);
  assert.equal(summary.bunny_executed, 0);
  assert.equal(summary.production_db_applied, false);
  assert.equal(catalog.ava_zip_applied, false);
  assert.equal(catalog.unbound.length, 12);
  assert.ok(catalog.unbound.every((asset) => asset.product_id === null && asset.local_uri === null));
});

test("rendered wuxing comparison exposes the prompt and the blocked file id", () => {
  const html = renderDetail(catalog, { productId: "CAT-085", view: "editorial", version: "v2026.11.04-11" });
  assert.match(html, /F0CFWBBCDH6/);
  assert.match(html, /浅蓝圆珠/);
  assert.match(html, /unknown/);
  assert.match(html, /images\/CAT-085\.jpg/);
  assert.equal(html.includes("fixtures/"), false);
});

test("committed catalog matches the builder", () => {
  const result = spawnSync(process.execPath, ["scripts/build-catalog.mjs", "--check"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("migration guard does not apply a database change", () => {
  const plain = spawnSync(process.execPath, ["scripts/migration-guard.mjs"], { encoding: "utf8" });
  assert.equal(plain.status, 0);
  assert.equal(JSON.parse(plain.stdout).applied, false);
  const forced = spawnSync(process.execPath, ["scripts/migration-guard.mjs", "--apply"], { encoding: "utf8" });
  assert.equal(forced.status, 2);
  assert.match(forced.stderr, /will not write production/);
});

test("repository files added for this change do not contain credential assignments", () => {
  const files = [
    "src/model.js",
    "data/upload-policy.json",
    "README.md",
    "schema/001_prompt_trace.sql",
  ];
  for (const file of files) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(/password\s*[:=]\s*['\"][^'\"]+['\"]/i.test(text), false, file);
    assert.equal(text.includes("NOVA_BUNNY_STORAGE_PASSWORD="), false, file);
  }
});
