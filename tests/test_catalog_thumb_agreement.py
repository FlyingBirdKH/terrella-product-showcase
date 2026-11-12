#!/usr/bin/env python3
"""Three-way thumbnail agreement for CAT-041 and future reconciles."""

from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "catalog_thumbs", ROOT / "scripts" / "catalog_thumbs.py"
)
catalog_thumbs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(catalog_thumbs)


class CatalogThumbAgreementTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fallback, cls.gallery, cls.products = catalog_thumbs.load_catalog(ROOT)

    def test_cat041_three_sources_agree_on_remaining_image(self):
        fallback = next(item for item in self.fallback if item["sku"] == "CAT-041")
        product = next(item for item in self.products if item["sku"] == "CAT-041")
        images = self.gallery["CAT-041"]["images"]
        self.assertGreaterEqual(len(images), 1)
        self.assertEqual(catalog_thumbs.image_filename(fallback["thumb"]), catalog_thumbs.CAT041_THUMB)
        self.assertEqual(fallback["thumb"], product["thumb"])
        self.assertEqual(images[0]["path"], fallback["thumb"])
        self.assertNotIn("gallery", product)
        for image in images:
            self.assertFalse(catalog_thumbs.is_deleted_thumb(image["path"]))

    def test_deleted_thumb_is_gone_from_catalog_files(self):
        self.assertEqual(catalog_thumbs.stale_thumb_embeds(ROOT), [])
        self.assertEqual(catalog_thumbs.check_repo(ROOT), [])

    def test_existing_drift_cannot_gain_a_sku(self):
        errors = catalog_thumbs.check_agreement(self.fallback, self.gallery, self.products)
        self.assertEqual(errors, [])

    def test_one_sided_products_json_edit_fails(self):
        products = copy.deepcopy(self.products)
        product = next(item for item in products if item["sku"] == "CAT-041")
        product["thumb"] = product["thumb"].replace(
            catalog_thumbs.CAT041_THUMB, catalog_thumbs.DELETED_THUMB
        )
        errors = catalog_thumbs.check_agreement(self.fallback, self.gallery, products)
        self.assertTrue(any("CAT-041" in error for error in errors))

    def test_one_sided_fallback_edit_fails(self):
        fallback = copy.deepcopy(self.fallback)
        item = next(entry for entry in fallback if entry["sku"] == "CAT-041")
        item["thumb"] = item["thumb"].replace(
            catalog_thumbs.CAT041_THUMB, "g-71772eac81aff84d50fc.jpg"
        )
        errors = catalog_thumbs.check_agreement(fallback, self.gallery, self.products)
        self.assertTrue(any("CAT-041" in error and "mismatch" in error for error in errors))

    def test_reconcile_updates_all_three_and_leaves_inputs_unchanged(self):
        fallback = next(item for item in self.fallback if item["sku"] == "CAT-041")
        product = next(item for item in self.products if item["sku"] == "CAT-041")
        group = self.gallery["CAT-041"]
        original_fallback = fallback["thumb"]
        original_first = group["images"][0]["path"]
        second = group["images"][1]["path"]
        filename = catalog_thumbs.image_filename(second)

        new_fallback, new_group, new_product = catalog_thumbs.reconcile_thumb(
            fallback, group, product, filename
        )

        self.assertEqual(new_fallback["thumb"], second)
        self.assertEqual(new_product["thumb"], second)
        self.assertEqual(new_group["images"][0]["path"], second)
        self.assertEqual(fallback["thumb"], original_fallback)
        self.assertEqual(product["thumb"], original_fallback)
        self.assertEqual(group["images"][0]["path"], original_first)
        self.assertNotIn(catalog_thumbs.DELETED_THUMB, new_fallback["thumb"])

    def test_reconcile_refuses_deleted_thumb_without_writing(self):
        fallback = next(item for item in self.fallback if item["sku"] == "CAT-041")
        product = next(item for item in self.products if item["sku"] == "CAT-041")
        group = self.gallery["CAT-041"]
        before = (
            fallback["thumb"],
            product["thumb"],
            [image["path"] for image in group["images"]],
        )
        with self.assertRaises(catalog_thumbs.CatalogThumbError):
            catalog_thumbs.reconcile_thumb(
                fallback, group, product, catalog_thumbs.DELETED_THUMB
            )
        after = (
            fallback["thumb"],
            product["thumb"],
            [image["path"] for image in group["images"]],
        )
        self.assertEqual(before, after)

    def test_reconcile_of_current_cat041_thumb_is_idempotent(self):
        fallback = next(item for item in self.fallback if item["sku"] == "CAT-041")
        product = next(item for item in self.products if item["sku"] == "CAT-041")
        group = self.gallery["CAT-041"]
        new_fallback, new_group, new_product = catalog_thumbs.reconcile_thumb(
            fallback, group, product, catalog_thumbs.CAT041_THUMB
        )
        self.assertEqual(new_fallback["thumb"], fallback["thumb"])
        self.assertEqual(new_product["thumb"], product["thumb"])
        self.assertEqual(
            [image["path"] for image in new_group["images"]],
            [image["path"] for image in group["images"]],
        )


if __name__ == "__main__":
    unittest.main()
