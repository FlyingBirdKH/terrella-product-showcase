#!/usr/bin/env python3
"""Build local WebP derivatives for the images index.html actually renders.

Bunny pull-zone query parameters are not an image optimizer here, so the page
cannot ask the CDN for a smaller file. This script downloads the public
originals that imagesFor() and aiImagesFor() display, writes max-edge 200px
and 400px WebP files under thumbs/, and writes thumbs/manifest.js. The page
selects between those files. It does not upload, delete, or replace Bunny
originals, and it does not change product order or approved selections.

Usage:
  python3 scripts/generate-thumbs.py
  python3 scripts/generate-thumbs.py --check
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
MANIFEST_JS = ROOT / "thumbs" / "manifest.js"
REPORT = ROOT / "thumbs" / "generation-report.json"
CACHE = Path("/tmp/terrella-thumb-src")
TIERS = (200, 400)
QUALITY = 80
HOST = "terralla-internal.b-cdn.net"
UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
IDENTITY_HOLDS = {"CAT-007", "CAT-008", "CAT-010", "CAT-036", "CAT-080", "CAT-081"}


def extract_const(html: str, name: str):
    match = re.search(rf"const {name} = ", html)
    if not match:
        raise SystemExit(f"missing const {name}")
    index = match.end()
    while html[index] not in "[{":
        index += 1
    opener = html[index]
    closer = "]" if opener == "[" else "}"
    depth = 0
    in_string = False
    escaped = False
    for cursor in range(index, len(html)):
        char = html[cursor]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
            continue
        if char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return json.loads(html[index : cursor + 1])
    raise SystemExit(f"unclosed const {name}")


def valid_image_path(value) -> bool:
    if not isinstance(value, str) or re.search(r"[\r\n]", value):
        return False
    patterns = (
        r"^images/[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png|webp)$",
        r"^https://terralla-internal\.b-cdn\.net/showcase/multi-image-20261108/[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png|webp)$",
        r"^https://terralla-internal\.b-cdn\.net/products/[a-z0-9-]+/[A-Za-z0-9-]+/[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png|webp)$",
        r"^https://terralla-internal\.b-cdn\.net/products/[a-z0-9-]+/[A-Za-z0-9-]+/ai/(?:[A-Za-z0-9_.-]+/)?[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png|webp)$",
    )
    return any(re.match(pattern, value) for pattern in patterns)


def approved_asset(asset, sku: str, baseline: dict) -> bool:
    if not asset or sku not in baseline or not valid_image_path(asset.get("path")):
        return False
    if (
        asset.get("publicCopyApproved") is not True
        or asset.get("contentVerified") is not True
        or asset.get("byteVerified") is not True
        or asset.get("assignedSku") != sku
    ):
        return False
    if not re.fullmatch(r"[a-f0-9]{64}", asset.get("sourceSha256") or ""):
        return False
    if not re.fullmatch(r"[a-f0-9]{64}", asset.get("outputSha256") or ""):
        return False
    if asset.get("holdFolderPreview") is True and sku in IDENTITY_HOLDS:
        return True
    return asset.get("skuAssignmentVerified") is True and sku not in IDENTITY_HOLDS


def blocked_paths(manifest: dict, baseline: dict) -> set:
    seen = {}
    blocked = set()
    for sku, group in (manifest or {}).items():
        for asset in group.get("images") or []:
            if not asset or not isinstance(asset.get("path"), str):
                continue
            identity = f"{asset.get('sourceSha256')}:{asset.get('outputSha256')}"
            if (not approved_asset(asset, sku, baseline)) or (
                asset["path"] in seen and seen[asset["path"]] != identity
            ):
                blocked.add(asset["path"])
            seen[asset["path"]] = identity
    return blocked


def unchanged_identity(product, baseline: dict) -> bool:
    base = baseline.get(product["sku"])
    if not base:
        return False
    for key in ("code", "name", "original"):
        if (product.get(key) if product.get(key) is not None else None) != (
            base.get(key) if base.get(key) is not None else None
        ):
            return False
    return True


def images_for(product, gallery, baseline, blocked) -> list:
    seen = set()
    result = []
    if unchanged_identity(product, baseline):
        for asset in (gallery.get(product["sku"], {}) or {}).get("images") or []:
            if (
                not approved_asset(asset, product["sku"], baseline)
                or asset["path"] in blocked
                or asset.get("sourceSha256") in seen
            ):
                continue
            seen.add(asset.get("sourceSha256"))
            result.append(asset)
    if not result:
        base = baseline.get(product["sku"])
        thumb = base.get("thumb") if base else None
        if (
            base
            and unchanged_identity(product, baseline)
            and product.get("thumb") == thumb
            and valid_image_path(thumb)
            and thumb not in blocked
        ):
            result.append({"path": thumb, "label": "legacy"})
    return result


def ai_images_for(product, ai_gallery) -> list:
    group = ai_gallery.get(product["sku"])
    if not group or not isinstance(group.get("images"), list):
        return []
    output = []
    for asset in group["images"]:
        if not asset or asset.get("kind") != "ai" or not valid_image_path(asset.get("path")):
            continue
        if not re.fullmatch(r"[a-f0-9]{64}", asset.get("sourceSha256") or ""):
            continue
        if not re.fullmatch(r"[a-f0-9]{64}", asset.get("outputSha256") or ""):
            continue
        path = asset["path"]
        if "/products/" in path and "/ai/" in path:
            if (
                asset.get("assignedSku") != product["sku"]
                or asset.get("integrityMethod") != "storage-readback-sha256"
                or asset.get("sourceHashMeaning") != "uploaded-file-bytes-not-physical-reference"
                or asset.get("sourceSha256") != asset.get("outputSha256")
                or asset.get("byteVerified") is not True
                or not isinstance(asset.get("byteLength"), int)
                or asset.get("byteLength") <= 0
            ):
                continue
        output.append(asset)
    return output


def rendered_urls(html: str) -> list:
    fallback = extract_const(html, "FALLBACK")
    gallery = extract_const(html, "GALLERY")
    ai_gallery = extract_const(html, "AI_GALLERY")
    baseline = {product["sku"]: product for product in fallback}
    blocked = blocked_paths(gallery, baseline)
    urls = []
    for product in fallback:
        for asset in images_for(product, gallery, baseline, blocked):
            urls.append(asset["path"])
        for asset in ai_images_for(product, ai_gallery):
            urls.append(asset["path"])
    return urls


def thumb_relpath(url: str, tier: int) -> str:
    parsed = urllib.parse.urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.netloc != HOST
        or parsed.query
        or parsed.fragment
        or parsed.username
    ):
        raise ValueError(f"unexpected image URL: {url}")
    parts = [part for part in parsed.path.split("/") if part]
    if ".." in parts or not parts:
        raise ValueError(f"unsafe image path: {url}")
    filename = parts[-1]
    stem = re.sub(r"\.(?:jpg|jpeg|png|webp)$", "", filename, flags=re.I)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", stem):
        raise ValueError(f"unsafe filename: {url}")
    directory = parts[:-1]
    if not all(re.fullmatch(r"[A-Za-z0-9_.-]+", part) for part in directory):
        raise ValueError(f"unsafe directory: {url}")
    relative = Path("thumbs") / str(tier) / Path(*directory) / f"{stem}.webp"
    return relative.as_posix()


def cache_path(url: str) -> Path:
    digest = hashlib.sha256(url.encode()).hexdigest()
    return CACHE / digest


def download(url: str) -> bytes:
    destination = cache_path(url)
    if destination.exists() and destination.stat().st_size > 0:
        return destination.read_bytes()
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*,*/*"})
    last_error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                final = urllib.parse.urlparse(response.geturl())
                if final.scheme != "https" or final.netloc != HOST:
                    raise RuntimeError(f"redirected off the public image host: {response.geturl()}")
                payload = response.read()
            if len(payload) < 32:
                raise RuntimeError(f"response too small ({len(payload)} bytes)")
            if not payload.startswith((b"\xff\xd8", b"\x89PNG", b"RIFF", b"GIF8")):
                raise RuntimeError("response is not an image")
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_suffix(".part")
            temporary.write_bytes(payload)
            temporary.replace(destination)
            return payload
        except (urllib.error.URLError, TimeoutError, RuntimeError) as error:
            last_error = error
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(last_error)


def fitted(image: Image.Image, max_edge: int) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
    width, height = image.size
    longest = max(width, height)
    if longest <= max_edge:
        return image
    scale = max_edge / longest
    resized = (
        max(1, int(round(width * scale))),
        max(1, int(round(height * scale))),
    )
    return image.resize(resized, Image.Resampling.LANCZOS)


def write_variant(source: bytes, url: str, tier: int) -> dict:
    with Image.open(io.BytesIO(source)) as image:
        image.load()
        source_size = image.size
        derivative = fitted(image, tier)
        width, height = derivative.size
        relative = thumb_relpath(url, tier)
        destination = ROOT / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        buffer = io.BytesIO()
        derivative.save(buffer, format="WEBP", quality=QUALITY, method=6)
        payload = buffer.getvalue()
        destination.write_bytes(payload)
        with Image.open(destination) as check:
            if check.size != (width, height) or check.format != "WEBP":
                raise RuntimeError(f"wrote an unreadable derivative: {relative}")
    return {
        "path": relative,
        "w": width,
        "h": height,
        "bytes": len(payload),
        "tier": tier,
        "sourceWidth": source_size[0],
        "sourceHeight": source_size[1],
    }


def build_record(url: str) -> dict:
    source = download(url)
    with Image.open(io.BytesIO(source)) as image:
        image.load()
        source_width, source_height = ImageOps.exif_transpose(image).size
    variants = []
    seen_sizes = set()
    for tier in TIERS:
        variant = write_variant(source, url, tier)
        size = (variant["w"], variant["h"])
        if size in seen_sizes:
            Path(ROOT / variant["path"]).unlink(missing_ok=True)
            continue
        seen_sizes.add(size)
        variants.append(
            {"path": variant["path"], "w": variant["w"], "h": variant["h"], "bytes": variant["bytes"], "tier": tier}
        )
    variants.sort(key=lambda item: item["w"])
    return {
        "url": url,
        "sourceBytes": len(source),
        "sourceSha256": hashlib.sha256(source).hexdigest(),
        "sourceWidth": source_width,
        "sourceHeight": source_height,
        "variants": variants,
    }


def write_outputs(records: list, slots: int, unique: int, omissions: list) -> None:
    manifest = {
        record["url"]: {
            "variants": [
                {"path": variant["path"], "w": variant["w"], "h": variant["h"]}
                for variant in record["variants"]
            ]
        }
        for record in records
    }
    MANIFEST_JS.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_JS.write_text(
        "window.THUMB_MANIFEST = "
        + json.dumps(manifest, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    derivative_bytes = sum(variant["bytes"] for record in records for variant in record["variants"])
    tier_summary = {}
    for tier in TIERS:
        chosen = [variant for record in records for variant in record["variants"] if variant["tier"] == tier]
        tier_summary[str(tier)] = {
            "count": len(chosen),
            "bytes": sum(variant["bytes"] for variant in chosen),
        }
    report = {
        "renderedImageSlots": slots,
        "uniqueUrls": unique,
        "generated": len(records),
        "omissions": omissions,
        "quality": QUALITY,
        "tiers": tier_summary,
        "derivativeBytes": derivative_bytes,
        "sourceBytes": sum(record["sourceBytes"] for record in records),
        "files": records,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def page_uses_derivatives(html: str) -> bool:
    if 'src="${esc(a.path)}"' in html or "src=\"${esc(a.path)}\"" in html:
        return False
    return 'src="thumbs/manifest.js"' in html and "function thumbMarkup(" in html and 'sizes="(max-width: 700px) 88px, 96px"' in html


def check() -> int:
    html = INDEX.read_text(encoding="utf-8")
    urls = rendered_urls(html)
    unique = list(dict.fromkeys(urls))
    problems = []
    if not page_uses_derivatives(html):
        problems.append("index.html gallery still points img src at the original, or the manifest tag is missing")
    if not MANIFEST_JS.exists():
        problems.append("missing thumbs/manifest.js")
        print("\n".join(problems))
        return 1
    script = MANIFEST_JS.read_text(encoding="utf-8")
    prefix = "window.THUMB_MANIFEST = "
    if not script.startswith(prefix) or not script.rstrip().endswith(";"):
        problems.append("manifest.js wrapper is invalid")
        print("\n".join(problems))
        return 1
    manifest = json.loads(script[len(prefix) :].rstrip().rstrip(";"))
    report = json.loads(REPORT.read_text(encoding="utf-8")) if REPORT.exists() else {}
    upstream_gaps = []
    for item in report.get("omissions") or []:
        url = item.get("url")
        if url not in unique:
            problems.append(f"omission is not a rendered URL: {url}")
            continue
        if "404" not in str(item.get("error")):
            problems.append(f"omission is not an upstream 404: {url}")
            continue
        if url in manifest:
            problems.append(f"404 original is still in the manifest: {url}")
            continue
        upstream_gaps.append(url)
    known_gaps = set(upstream_gaps)
    derivative_bytes = 0
    for url in unique:
        if url in known_gaps:
            continue
        record = manifest.get(url)
        if not record or not record.get("variants"):
            problems.append(f"missing manifest entry: {url}")
            continue
        for variant in record["variants"]:
            path = ROOT / variant["path"]
            if not path.is_file():
                problems.append(f"missing file: {variant['path']}")
                continue
            with Image.open(path) as image:
                if image.format != "WEBP" or image.size != (variant["w"], variant["h"]):
                    problems.append(f"dimension mismatch: {variant['path']} {image.size} != {(variant['w'], variant['h'])}")
                if max(image.size) > 400:
                    problems.append(f"derivative larger than 400px: {variant['path']} {image.size}")
            derivative_bytes += path.stat().st_size
    extra = sorted(set(manifest) - set(unique))
    if extra:
        problems.append(f"manifest has {len(extra)} URLs the page does not render")
    uncovered = [url for url in unique if url not in manifest and url not in known_gaps]
    for url in uncovered:
        problems.append(f"rendered URL has no derivative and is not an upstream 404: {url}")
    print(
        json.dumps(
            {
                "renderedImageSlots": len(urls),
                "uniqueUrls": len(unique),
                "manifestEntries": len(manifest),
                "upstream404": len(upstream_gaps),
                "derivativeBytes": derivative_bytes,
                "problems": len(problems),
            },
            ensure_ascii=False,
        )
    )
    if problems:
        print("\n".join(problems[:30]))
        return 1
    return 0


def generate() -> int:
    html = INDEX.read_text(encoding="utf-8")
    urls = rendered_urls(html)
    unique = list(dict.fromkeys(urls))
    print(f"rendered slots {len(urls)}; unique originals {len(unique)}", flush=True)
    records = []
    omissions = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(build_record, url): url for url in unique}
        done = 0
        for future in as_completed(futures):
            url = futures[future]
            done += 1
            try:
                records.append(future.result())
            except Exception as error:  # keep going so the report lists every miss
                omissions.append({"url": url, "error": str(error)})
                print(f"FAIL {done}/{len(unique)} {url} {error}", flush=True)
                continue
            if done % 25 == 0 or done == len(unique):
                print(f"done {done}/{len(unique)}", flush=True)
    records.sort(key=lambda record: record["url"])
    write_outputs(records, len(urls), len(unique), omissions)
    print(f"wrote {MANIFEST_JS} and {REPORT}", flush=True)
    if omissions:
        print(f"{len(omissions)} originals could not be derived", flush=True)
        return 1
    return check()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify files, dimensions, and page wiring")
    args = parser.parse_args()
    return check() if args.check else generate()


if __name__ == "__main__":
    sys.exit(main())
