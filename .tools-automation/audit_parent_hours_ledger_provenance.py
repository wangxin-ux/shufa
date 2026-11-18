"""Bounded old/new P3 cache and original Git asset provenance; no app writes."""

import argparse
import json
import re
import subprocess
from importlib.metadata import version
from pathlib import Path

from PIL import Image, ImageChops
from psd_tools import PSDImage

from audit_parent_hours_material import (
    BASE, GEOMETRY, ROOT, read_json, record, source_page, verify_history, verify_inputs,
)
from audit_parent_growth_stars import background, contact, image_record


HISTORY = BASE / "material-v2/material.json"
ASSET = ROOT / "frontend/pages/parent/assets/hours-ledger-mascot.png"
OLD_HASH = "DC8599A9790F2702479D0048E73E207FBC624C73A1D4A75A6204B5AA948C1657"
ORIGINAL_COMMIT = "01594060d730e20c75f5e956909909f386a74e54"
ORIGINAL_PATH = "frontend/assets/parent/hours-ledger-mascot.png"
ORIGINAL_BLOB = "c7e58626352fc9a39aa41d08ef5326c326e10c8e"
BOARD_BOX = [1225, 0, 2350, 2436]
LAYER_BOX = [1234, 1510, 2025, 2444]


def sources(geometry):
    _, new = source_page(geometry)
    old = [s for s in geometry["sources"] if s["role"] == "parent" and s["version"] == "old"]
    if len(old) != 1 or old[0]["sha256"].upper() != OLD_HASH:
        raise ValueError("Expected unique fixed old parent source")
    return [old[0], new]


def ledger_layer(board):
    layers = list(board.descendants())
    matches = [layer for layer in layers if layer.layer_id == 532]
    if list(board.bbox) != BOARD_BOX or len(matches) != 1 \
            or len({layer.layer_id for layer in layers}) != len(layers):
        raise ValueError("Wrong P3 board or duplicate source layer")
    layer = matches[0]
    if layer.kind != "pixel" or list(layer.bbox) != LAYER_BOX \
            or layer.opacity != 255 or layer.clipping or not layer.is_visible() \
            or layer.has_mask() or layer.has_vector_mask():
        raise ValueError("Expected complete unmasked opaque ledger source layer")
    return layer


def verify_original(original, current):
    if original != current:
        raise ValueError("Current asset differs from original Git blob")
    return True


def original_asset():
    resolved = subprocess.run(
        ["git", "rev-parse", f"{ORIGINAL_COMMIT}:{ORIGINAL_PATH}"], cwd=ROOT,
        capture_output=True, check=True, timeout=15,
    ).stdout.decode("ascii").strip()
    if resolved != ORIGINAL_BLOB:
        raise ValueError("Original Git object identity changed")
    return subprocess.run(
        ["git", "cat-file", "blob", ORIGINAL_BLOB], cwd=ROOT,
        capture_output=True, check=True, timeout=15,
    ).stdout


def bicubic_candidate(source, size):
    if len(size) != 2 or any(type(value) is not int or value <= 0 for value in size):
        raise ValueError("Invalid full candidate dimensions")
    return source.convert("RGBA").resize(size, Image.Resampling.BICUBIC).quantize(
        colors=256, method=Image.Quantize.FASTOCTREE,
    ).convert("RGBA")


def pixel_difference(before, after):
    if before.size != after.size:
        raise ValueError("Pixel comparison requires the same dimensions")
    before, after = before.convert("RGBA"), after.convert("RGBA")
    delta = ImageChops.difference(before, after)
    return {
        "rgbaEqual": before.tobytes() == after.tobytes(),
        "differentPixels": sum(any(px) for px in delta.get_flattened_data()),
        "visibleDifferentPixels": sum(
            a != b and (a[3] > 0 or b[3] > 0)
            for a, b in zip(before.get_flattened_data(), after.get_flattened_data())
        ),
        "maxChannelDelta": [high for _, high in delta.getextrema()],
        "differentBoundsPxByChannel": {
            channel: list(plane.getbbox()) if plane.getbbox() else None
            for channel, plane in zip("RGBA", delta.split())
        },
    }


def build_audit():
    history = read_json(HISTORY)
    historical = verify_history(history["inputs"], [GEOMETRY, ASSET])
    geometry = read_json(GEOMETRY)
    selected = sources(geometry)
    historical += verify_history(history["inputs"], [ROOT / selected[1]["path"]])
    verify_inputs(selected)
    images, rows = {}, []
    for source in selected:
        psd = PSDImage.open(ROOT / source["path"])
        if list(psd.size) != source["canvasPx"] or len(psd) != source["artboards"]:
            raise ValueError("Actual source canvas or artboard count changed")
        layer = ledger_layer(psd[1])
        raw = layer.topil(apply_icc=True).convert("RGBA")
        if raw.size != (791, 934):
            raise ValueError("Complete source cache dimensions changed")
        rows.append({
            "source": source, "stackIndex": 1, "boardBboxDocumentPx": BOARD_BOX,
            "layerId": layer.layer_id, "layerName": layer.name,
            "layerBboxDocumentPx": list(layer.bbox), "rawCache": image_record(raw),
            "rawIccConversionEqual": raw.tobytes()
            == layer.topil(apply_icc=False).convert("RGBA").tobytes(),
        })
        images[f"{source['version']}-layer-532-raw.png"] = raw
    if rows[0]["rawCache"] != rows[1]["rawCache"]:
        raise ValueError("Old and new ledger caches differ")
    prior = [row for row in history["layers"] if row["layerId"] == 532]
    if len(prior) != 1 or prior[0]["rawCache"] != rows[1]["rawCache"]:
        raise ValueError("New cache differs from prior verified material evidence")
    with Image.open(ASSET) as opened:
        asset = opened.convert("RGBA")
        if opened.mode != "P" or opened.size != (600, 708):
            raise ValueError("Current asset mode or dimensions changed")
        palette = {
            "mode": opened.mode, "paletteEntries": len(opened.getpalette()) // 3,
            "usedIndices": len(opened.getcolors()),
        }
    original = original_asset()
    verify_original(original, ASSET.read_bytes())
    candidate = bicubic_candidate(images["new-layer-532-raw.png"], asset.size)
    compared = pixel_difference(asset, candidate)
    if compared["rgbaEqual"]:
        raise ValueError("Previously unresolved recipe now matches; review diagnostic conclusion")
    images["candidate-bicubic-256.png"] = candidate
    images["stored-rgba-difference.png"] = ImageChops.difference(asset, candidate)
    images["cache-asset-contact.png"] = contact([
        ("Old PSD layer 532 / complete cache", background(images["old-layer-532-raw.png"])),
        ("New PSD layer 532 / complete cache", background(images["new-layer-532-raw.png"])),
        ("Current original Git asset / 600 x 708", background(asset)),
        ("BICUBIC + 256 FASTOCTREE / not exact", background(candidate)),
        ("Current asset over yellow / isolated image", background(asset, "#f6d468")),
        ("Candidate over yellow / isolated image", background(candidate, "#f6d468")),
    ], cell=(510, 450))
    helper_names = [
        "audit_parent_hours_material.py", "audit_parent_growth_material.py",
        "audit_parent_growth_stars.py", "compare_parent_hours_font.py",
        "compare_parent_home_font.py",
    ]
    context = [
        HISTORY, GEOMETRY, ASSET, *[ROOT / source["path"] for source in selected],
        Path(__file__), Path(__file__).with_name("test_parent_hours_ledger_provenance.py"),
        *[Path(__file__).with_name(name) for name in helper_names],
    ]
    result = {
        "schemaVersion": 1, "page": "parent/P3", "acceptance": "ledger-provenance-diagnostic-only",
        "sources": rows, "oldNewRawCachesEqual": True,
        "originalGit": {
            "commit": ORIGINAL_COMMIT, "path": ORIGINAL_PATH, "blob": ORIGINAL_BLOB,
            "bytes": len(original), "sha256": record(ASSET)["sha256"],
            "currentBytesEqual": True,
        },
        "asset": {"file": record(ASSET), "pixels": image_record(asset), "palette": palette},
        "recipe": {
            "resize": "BICUBIC", "sizePx": [600, 708],
            "quantize": "FASTOCTREE", "colors": 256,
            "candidatePixels": image_record(candidate), "comparison": compared,
            "status": "near-match-not-exact-provenance-reproduction",
        },
        "historicalReuse": {"manifest": record(HISTORY), "verifiedInputs": historical},
        "environment": {"Pillow": version("Pillow"), "psd-tools": version("psd-tools")},
        "inputs": [record(path) for path in context],
        "limits": [
            "Original asset bytes and old/new raw source equality are verified separately.",
            "A near-matching recipe does not identify the exact original export algorithm or tool version.",
            "Stored RGBA differences include visible alpha-edge changes; no pixel-equivalence claim.",
            "Isolated checker/yellow image comparisons omit page clipping, text, shadows and foreground.",
            "No app or asset writes, runtime reuse, IDE capture, full P3/R0/R2 or production acceptance.",
        ],
    }
    verify_inputs(result["inputs"])
    return result, images


def write_audit(name):
    if not re.fullmatch(r"[A-Za-z0-9-]+", name):
        raise ValueError("Invalid evidence directory name")
    directory = BASE / name
    if directory.exists():
        raise FileExistsError("Preserve existing provenance evidence")
    result, images = build_audit()
    directory.mkdir()
    for filename, image in images.items():
        with (directory / filename).open("xb") as stream:
            image.save(stream, format="PNG")
    result["outputs"] = [record(directory / filename) for filename in images]
    verify_inputs(result["inputs"])
    with (directory / "provenance.json").open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=True, indent=2)
        stream.write("\n")
    print(json.dumps({
        "directory": directory.relative_to(ROOT).as_posix(),
        "originalAssetBytesEqual": result["originalGit"]["currentBytesEqual"],
        "oldNewCachesEqual": result["oldNewRawCachesEqual"],
        "differentCandidatePixels": result["recipe"]["comparison"]["differentPixels"],
        "appChanges": False,
    }))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default="ledger-provenance-v1")
    write_audit(parser.parse_args().name)
