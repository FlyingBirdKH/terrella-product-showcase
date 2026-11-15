// Cold-cache measurement for the derivative thumbnails.
// Usage: NODE_PATH=/tmp/pw/node_modules node scripts/measure-thumbs.mjs http://127.0.0.1:8765/
import { writeFileSync, mkdirSync } from "node:fs";

const playwrightModule = await import("playwright").catch(() => import("/tmp/pw/node_modules/playwright/index.js"));
const { chromium } = playwrightModule.chromium ? playwrightModule : playwrightModule.default;

const base = process.argv[2] || "http://127.0.0.1:8765/";
const outDir = process.argv[3] || "/tmp/thumb-evidence";
mkdirSync(outDir, { recursive: true });

function intersects(rect, viewport) {
  const width = rect.rectWidth ?? rect.width;
  const height = rect.rectHeight ?? rect.height;
  return rect.bottom > 0 && rect.right > 0 && rect.top < viewport.height && rect.left < viewport.width && width > 0 && height > 0;
}

async function measure(browser, { width, height, dpr, label }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
  });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  await client.send("Network.enable");
  const responses = [];
  page.on("response", async (response) => {
    const request = response.request();
    if (request.resourceType() !== "image") return;
    let bodyBytes = null;
    try {
      bodyBytes = (await response.body()).length;
    } catch {
      bodyBytes = null;
    }
    responses.push({
      url: response.url(),
      status: response.status(),
      fromServiceWorker: response.fromServiceWorker(),
      bodyBytes,
      contentLength: Number(response.headers()["content-length"] || 0) || null,
    });
  });
  await page.addInitScript(() => {
    window.__shifts = [];
    try {
      performance.setResourceTimingBufferSize(5000);
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__shifts.push(entry.value);
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
  });
  await page.goto(new URL("./", base).href, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(400);
  const first = await page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio };
    const images = [...document.querySelectorAll("img")].map((img) => {
      const rect = img.getBoundingClientRect();
      return {
        currentSrc: img.currentSrc,
        src: img.getAttribute("src"),
        srcset: img.getAttribute("srcset"),
        sizes: img.getAttribute("sizes"),
        widthAttr: img.getAttribute("width"),
        heightAttr: img.getAttribute("height"),
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        clientWidth: img.clientWidth,
        clientHeight: img.clientHeight,
        complete: img.complete,
        alt: img.alt,
        href: img.closest("a")?.href || "",
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        rectWidth: rect.width,
        rectHeight: rect.height,
      };
    });
    return {
      viewport,
      title: document.title,
      imageCount: images.length,
      missingCount: document.querySelectorAll(".thumb-missing").length,
      shifts: window.__shifts || [],
      images,
    };
  });
  const firstVisible = first.images.filter((img) => intersects(img, first.viewport));
  await page.screenshot({ path: `${outDir}/${label}-viewport.png` });
  const firstLink = page.locator("a.thumb-link img").first();
  if (await firstLink.count()) {
    await firstLink.screenshot({ path: `${outDir}/${label}-thumb.png` });
  }
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let stable = 0;
    let last = -1;
    for (let step = 0; step < 80 && stable < 2; step += 1) {
      const galleries = [...document.querySelectorAll(".gallery")];
      for (const gallery of galleries) {
        const box = gallery.getBoundingClientRect();
        if (box.bottom > -200 && box.top < window.innerHeight + 400) gallery.scrollLeft = gallery.scrollWidth;
      }
      const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      if (!atEnd) window.scrollBy(0, Math.round(window.innerHeight * 0.75));
      await sleep(180);
      const pending = [...document.images].filter((img) => !img.complete).length;
      const y = window.scrollY;
      if (atEnd && pending === 0 && y === last) stable += 1;
      else stable = 0;
      last = y;
    }
  });
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => {
    const resources = performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
      duration: entry.duration,
    }));
    const images = [...document.querySelectorAll("img")].map((img) => ({
      currentSrc: img.currentSrc,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      complete: img.complete,
      widthAttr: img.getAttribute("width"),
      heightAttr: img.getAttribute("height"),
      clientWidth: img.clientWidth,
      clientHeight: img.clientHeight,
    }));
    return {
      resources,
      images,
      shifts: window.__shifts || [],
      scrollHeight: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
      innerHeight: window.innerHeight,
    };
  });
  await page.screenshot({ path: `${outDir}/${label}-bottom.png` });
  await context.close();
  return { label, width, height, dpr, responses, first, firstVisible, after };
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return ""; }
}

function summarize(run) {
  const resourceByUrl = new Map();
  for (const entry of run.after.resources) {
    const list = resourceByUrl.get(entry.name) || [];
    list.push(entry);
    resourceByUrl.set(entry.name, list);
  }
  const responseByUrl = new Map();
  for (const entry of run.responses) {
    const list = responseByUrl.get(entry.url) || [];
    list.push(entry);
    responseByUrl.set(entry.url, list);
  }
  const imageResources = [...resourceByUrl.entries()].filter(([url, entries]) => {
    return entries.some((entry) => entry.initiatorType === "img") || /\.(webp|jpe?g|png)(\?|$)/i.test(url);
  });
  const unique = imageResources.map(([url, entries]) => {
    const responses = responseByUrl.get(url) || [];
    const transfer = entries.reduce((sum, entry) => sum + entry.transferSize, 0);
    const encoded = Math.max(...entries.map((entry) => entry.encodedBodySize), 0);
    const body = responses.reduce((sum, entry) => sum + (entry.bodyBytes || 0), 0);
    return {
      url,
      requests: Math.max(entries.length, responses.length),
      resourceEntries: entries.length,
      responseCount: responses.length,
      statuses: [...new Set(responses.map((entry) => entry.status))],
      transferSize: transfer,
      encodedBodySize: encoded,
      responseBodyBytes: body,
      cached: entries.every((entry) => entry.transferSize === 0),
    };
  });
  const sum = (items, key) => items.reduce((total, item) => total + (item[key] || 0), 0);
  const visibleUrls = [...new Set(run.firstVisible.map((img) => img.currentSrc).filter(Boolean))];
  const visible = unique.filter((item) => visibleUrls.includes(item.url));
  const bunny = unique.filter((item) => hostOf(item.url).includes("b-cdn.net"));
  const zeroTransfer = unique.filter((item) => item.cached);
  const tiers = { "200": 0, "400": 0, other: 0 };
  for (const img of run.after.images) {
    if (/\/thumbs\/200\//.test(img.currentSrc)) tiers["200"] += 1;
    else if (/\/thumbs\/400\//.test(img.currentSrc)) tiers["400"] += 1;
    else tiers.other += 1;
  }
  const selection = run.firstVisible.map((img) => ({
    alt: img.alt,
    currentSrc: img.currentSrc.replace(base, "/"),
    natural: [img.naturalWidth, img.naturalHeight],
    client: [img.clientWidth, img.clientHeight],
    attrs: [img.widthAttr, img.heightAttr],
    neededDevicePx: Math.round(img.clientWidth * run.dpr),
    hrefHost: hostOf(img.href),
    sizes: img.sizes,
  }));
  return {
    label: run.label,
    viewport: run.first.viewport,
    domImages: run.after.images.length,
    domImagesAtFirstPaint: run.first.imageCount,
    missingPlaceholders: run.first.missingCount,
    firstScreenVisibleImages: run.firstVisible.length,
    firstScreenUniqueUrls: visibleUrls.length,
    firstScreenTransferSize: sum(visible, "transferSize"),
    firstScreenEncodedBodySize: sum(visible, "encodedBodySize"),
    firstScreenResponseBodyBytes: sum(visible, "responseBodyBytes"),
    totalImageResponses: run.responses.length,
    cumulativeImageUrls: unique.length,
    cumulativeTransferSize: sum(unique, "transferSize"),
    cumulativeEncodedBodySize: sum(unique, "encodedBodySize"),
    cumulativeResponseBodyBytes: sum(unique, "responseBodyBytes"),
    duplicateResponseUrls: unique.filter((item) => item.responseCount > 1).length,
    zeroTransferUrls: zeroTransfer.length,
    bunnyImageRequests: bunny.length,
    selectedTiers: tiers,
    cls: Number(run.after.shifts.reduce((sum, value) => sum + value, 0).toFixed(4)),
    reachedBottom: run.after.scrollY + run.after.innerHeight >= run.after.scrollHeight - 2,
    incompleteImages: run.after.images.filter((img) => !img.complete || !img.naturalWidth).length,
    missingWidthHeight: run.after.images.filter((img) => img.widthAttr !== "96" || img.heightAttr !== "96").length,
    firstScreenSelection: selection,
    nonThumbImages: unique.filter((item) => !/\/thumbs\/(?:200|400)\//.test(item.url)).map((item) => item.url),
  };
}

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const runs = [];
for (const config of [
  { width: 1440, height: 900, dpr: 2, label: "desktop-1440-dpr2" },
  { width: 1440, height: 900, dpr: 1, label: "desktop-1440-dpr1" },
]) {
  const run = await measure(browser, config);
  const summary = summarize(run);
  runs.push(summary);
  console.log(JSON.stringify({
    label: summary.label,
    firstScreenVisibleImages: summary.firstScreenVisibleImages,
    firstScreenTransferSize: summary.firstScreenTransferSize,
    firstScreenResponseBodyBytes: summary.firstScreenResponseBodyBytes,
    cumulativeImageUrls: summary.cumulativeImageUrls,
    totalImageResponses: summary.totalImageResponses,
    cumulativeTransferSize: summary.cumulativeTransferSize,
    cumulativeResponseBodyBytes: summary.cumulativeResponseBodyBytes,
    bunnyImageRequests: summary.bunnyImageRequests,
    selectedTiers: summary.selectedTiers,
    zeroTransferUrls: summary.zeroTransferUrls,
    duplicateResponseUrls: summary.duplicateResponseUrls,
    cls: summary.cls,
    incompleteImages: summary.incompleteImages,
    missingWidthHeight: summary.missingWidthHeight,
    missingPlaceholders: summary.missingPlaceholders,
  }));
}
await browser.close();
const report = {
  measuredAt: new Date().toISOString(),
  base,
  definition: {
    coldCache: "New browser context per run, Network.setCacheDisabled, no prior visit. transferSize 0 is reported and is not treated as a pass.",
    firstScreen: "img elements whose layout box intersects the initial  viewport before any scroll. Each currentSrc is counted once.",
    cumulative: "After vertical scroll to the document end and scrolling every on-screen horizontal gallery to its end. Unique image URLs, summed once. 200 and 400 variants are different URLs and both count if both were requested.",
    transferSize: "Performance resource timing transferSize, includes response headers.",
    responseBodyBytes: "Actual image response body length captured from the network stack.",
    excluded: "HTML, manifest.js, products.json, and aborted duplicates are not in the image totals. A second resource-timing entry for the same URL is not added twice.",
  },
  runs,
};
writeFileSync(`${outDir}/measurement.json`, JSON.stringify(report, null, 2));
console.log(`wrote ${outDir}/measurement.json`);
