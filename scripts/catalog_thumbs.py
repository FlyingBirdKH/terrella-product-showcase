#!/usr/bin/env python3
"""Keep one SKU's catalog thumbnail agreed across the three embedded sources.

The three sources are:

- ``const FALLBACK`` in index.html
- the first image of that SKU in ``const GALLERY`` in index.html
- ``thumb`` in products.json

A reconcile must update those together. This script exits non-zero when a SKU
outside the frozen historical list points at different files, or when CAT-041
is no longer on its remaining real image.

The historical list is the eleven SKUs whose live FALLBACK thumb was already
different from products.json before this pass. This pass does not rewrite
them. Adding another SKU to that disagreement, or changing only one side of
an existing disagreement, fails the check.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DELETED_THUMB = "g-c415b111ec96efee9a08.jpg"
DELETED_THUMB_PREFIX = "g-c415b111"
CAT041 = "CAT-041"
# First image still listed for CAT-041 in GALLERY. The products-folder object
# is the remaining real file; the previous thumb 404s on that folder.
CAT041_THUMB = "g-a9b90fd841faea8904aa.jpg"

# fallback filename, products.json / first-gallery filename
HISTORICAL_FALLBACK_DRIFT = {
    "CAT-006": ("g-850c5d229af33bb741e5.jpg", "g-9455b938f5afd7cc9dfb.jpg"),
    "CAT-008": ("CAT-008-hold-01.jpg", "CAT-008-hold-02.jpg"),
    "CAT-013": ("g-b633e2d481f953bd2910.jpg", "g-09a76cc1ce72c60820ef.jpg"),
    "CAT-017": ("g-1baaa5d7a41f6dfe6c69.jpg", "g-ae0ef1753694f96da92f.jpg"),
    "CAT-034": ("g-f9defe68f538a4e52e10.jpg", "g-20cba63e1a8df4845160.jpg"),
    "CAT-037": ("g-dacd7196d0252a35e274.jpg", "g-58932ea4290c5c4c3181.jpg"),
    "CAT-050": ("g-defea1cb2cd8f4e40209.jpg", "g-2b84b6a52ca60f8f5d79.jpg"),
    "CAT-052": ("g-5ce1ae077d9fa3d591ba.jpg", "g-318154941ba4a221086c.jpg"),
    "CAT-059": ("g-f12b0355006431b2ca74.jpg", "g-5a136cd4665f4fa08fc6.jpg"),
    "CAT-060": ("g-07b341178e3f211d419f.jpg", "g-6c5d0eef129e6bfb69a3.jpg"),
    "CAT-071": ("g-45611ad247b4ce9732ce.jpg", "g-39fa56c43554cdd7862a.jpg"),
}

CATALOG_FILES = ("index.html", "products.json", "bunny.html")
SCAN_SUFFIXES = {".html", ".json", ".js", ".mjs", ".md", ".css", ".txt", ".py"}


class CatalogThumbError(ValueError):
    """A thumbnail reconcile would leave the three sources disagreeing."""


def image_filename(url) -> str:
    if not isinstance(url, str) or not url.strip():
        return ""
    return url.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1]


def is_deleted_thumb(url) -> bool:
    name = image_filename(url)
    return name == DELETED_THUMB or name.startswith(DELETED_THUMB_PREFIX)


def extract_js_value(html: str, marker: str):
    start = html.find(marker)
    if start < 0:
        raise CatalogThumbError(f"missing {marker.strip()}")
    start += len(marker)
    while start < len(html) and html[start] in " \t\r\n":
        start += 1
    value, _end = json.JSONDecoder().raw_decode(html, start)
    return value


def load_catalog(root: Path = ROOT):
    html = (root / "index.html").read_text()
    fallback = extract_js_value(html, "const FALLBACK = ")
    gallery = extract_js_value(html, "const GALLERY = ")
    products = json.loads((root / "products.json").read_text())
    if not isinstance(fallback, list) or not isinstance(gallery, dict) or not isinstance(products, list):
        raise CatalogThumbError("catalog sources have an unexpected shape")
    return fallback, gallery, products


def _by_sku(items):
    found = {}
    for item in items:
        sku = item.get("sku")
        if not sku or sku in found:
            raise CatalogThumbError(f"duplicate or missing sku in product list: {sku}")
        found[sku] = item
    return found


def check_agreement(fallback, gallery, products) -> list[str]:
    """Return human-readable errors. Empty means the three sources agree."""
    errors = []
    fallback_by = _by_sku(fallback)
    products_by = _by_sku(products)
    if set(fallback_by) != set(products_by) or set(fallback_by) != set(gallery):
        errors.append("SKU sets differ across FALLBACK, GALLERY, and products.json")
        return errors

    seen_drift = set()
    for sku in sorted(fallback_by, key=lambda item: int(item.split("-")[1])):
        fallback_thumb = fallback_by[sku].get("thumb")
        products_thumb = products_by[sku].get("thumb")
        images = gallery[sku].get("images") or []
        first = images[0].get("path") if images else None
        paths = [image.get("path") for image in images]
        if any(is_deleted_thumb(path) for path in [fallback_thumb, products_thumb, first, *paths]):
            errors.append(f"{sku} still points at deleted thumbnail {DELETED_THUMB}")

        if sku in HISTORICAL_FALLBACK_DRIFT:
            expected_fallback, expected_products = HISTORICAL_FALLBACK_DRIFT[sku]
            actual = (image_filename(fallback_thumb), image_filename(products_thumb), image_filename(first))
            expected = (expected_fallback, expected_products, expected_products)
            if actual != expected:
                errors.append(
                    f"{sku} thumb drift changed ({actual[0]} / {actual[1]} / gallery {actual[2]}). "
                    "Reconcile FALLBACK, the first GALLERY image, and products.json together."
                )
            seen_drift.add(sku)
            continue

        if fallback_thumb != products_thumb or (first is not None and first != fallback_thumb):
            errors.append(
                f"{sku} thumbnail mismatch: FALLBACK={fallback_thumb} "
                f"GALLERY={first} products.json={products_thumb}"
            )

    missing = set(HISTORICAL_FALLBACK_DRIFT) - seen_drift
    if missing:
        errors.append("historical thumb drift SKUs missing: " + ", ".join(sorted(missing)))

    cat = fallback_by[CAT041]
    cat_products = products_by[CAT041]
    cat_images = gallery[CAT041].get("images") or []
    cat_first = cat_images[0].get("path") if cat_images else None
    if image_filename(cat.get("thumb")) != CAT041_THUMB:
        errors.append(f"{CAT041} FALLBACK thumb is {image_filename(cat.get('thumb'))}, expected {CAT041_THUMB}")
    if cat.get("thumb") != cat_products.get("thumb") or cat_first != cat.get("thumb"):
        errors.append(
            f"{CAT041} three sources disagree: FALLBACK={cat.get('thumb')} "
            f"GALLERY={cat_first} products.json={cat_products.get('thumb')}"
        )
    return errors


def stale_thumb_embeds(root: Path = ROOT) -> list[str]:
    """Catalog files other than this checker must not still name the deleted thumb."""
    hits = []
    checker = Path(__file__).resolve()
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if ".git" in path.parts or path.resolve() == checker:
            continue
        if path.suffix.lower() not in SCAN_SUFFIXES:
            continue
        text = path.read_text(errors="ignore")
        count = text.count(DELETED_THUMB_PREFIX)
        if count:
            hits.append(f"{path.relative_to(root)} still embeds {DELETED_THUMB_PREFIX} ({count})")
    return hits


def check_repo(root: Path = ROOT) -> list[str]:
    fallback, gallery, products = load_catalog(root)
    return check_agreement(fallback, gallery, products) + stale_thumb_embeds(root)


def reconcile_thumb(fallback_item, gallery_group, product_item, filename: str):
    """Point all three sources at one remaining gallery image.

    Returns new objects. The inputs are not modified, so a refusal cannot
    leave a one-sided update behind. The chosen file must already be a real
    gallery image and must not be the deleted CAT-041 thumb.
    """
    if not isinstance(filename, str) or not filename or is_deleted_thumb(filename):
        raise CatalogThumbError(f"refused deleted or empty thumbnail {filename}")

    images = list(gallery_group.get("images") or [])
    matches = [image for image in images if image_filename(image.get("path")) == filename]
    if len(matches) != 1:
        raise CatalogThumbError(f"{filename} is not exactly one remaining gallery image")

    chosen = copy.deepcopy(matches[0])
    rest = [
        copy.deepcopy(image)
        for image in images
        if image_filename(image.get("path")) != filename and not is_deleted_thumb(image.get("path"))
    ]
    new_group = copy.deepcopy(gallery_group)
    new_group["images"] = [chosen, *rest]
    path = chosen.get("path")
    if not isinstance(path, str) or image_filename(path) != filename or is_deleted_thumb(path):
        raise CatalogThumbError("reconcile selected a path that is not the remaining image")

    new_fallback = copy.deepcopy(fallback_item)
    new_product = copy.deepcopy(product_item)
    new_fallback["thumb"] = path
    new_product["thumb"] = path
    if new_fallback.get("thumb") != new_product.get("thumb") or new_group["images"][0].get("path") != path:
        raise CatalogThumbError("reconcile failed to make FALLBACK, GALLERY, and products.json agree")
    return new_fallback, new_group, new_product


def main(argv=None) -> int:
    errors = check_repo(ROOT)
    if errors:
        print("catalog thumbnail check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(
        f"{CAT041} thumbnail {CAT041_THUMB} agrees across FALLBACK, "
        "the first GALLERY image, and products.json"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
