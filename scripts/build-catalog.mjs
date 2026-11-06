import { readFileSync, writeFileSync } from "node:fs";
import { buildCatalog } from "../src/model.js";

const products = JSON.parse(readFileSync(new URL("../products.json", import.meta.url)));
const eastern = JSON.parse(readFileSync(new URL("../data/eastern-prompts.json", import.meta.url)));
const wuxing = JSON.parse(readFileSync(new URL("../data/wuxing-prompts.json", import.meta.url)));
const policy = JSON.parse(readFileSync(new URL("../data/upload-policy.json", import.meta.url)));
const catalog = buildCatalog({ products, eastern, wuxing, policy });
const publicCatalog = { ...catalog };
delete publicCatalog.indexes;
const text = `${JSON.stringify(publicCatalog, null, 2)}\n`;
const target = new URL("../data/catalog.json", import.meta.url);
if (process.argv.includes("--check")) {
  const current = readFileSync(target, "utf8");
  if (current !== text) {
    console.error("data/catalog.json is out of date. Run npm run build.");
    process.exit(1);
  }
  console.log("catalog check ok");
} else {
  writeFileSync(target, text);
  console.log(`wrote catalog prompts=${catalog.prompts.length} assets=${catalog.assets.length}`);
}
