"""Archive P3 material and alpha diagnostics outside the application package."""

import argparse
import json
import math
import re
import shutil
import subprocess
from importlib.util import find_spec
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw
from psd_tools import PSDImage
from psd_tools.constants import Tag

from audit_parent_growth_material import descriptor, mask_record, number, pixel_box, vector_record
from audit_parent_growth_stars import (
    background, contact, difference, file_digest, image_record, with_opacity,
)
from compare_parent_hours_font import open_srgb, sheet


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "docs/verification/parent-hours-source-2026-10-12"
RUNTIME = BASE / "runtime-390-v4"
GEOMETRY = ROOT / "docs/verification/ui-source-geometry-2026-10-10/psd-geometry-v2.json"
MAPPING = RUNTIME / "semantic-anchors-v1.json"
CONTACT_HISTORY = RUNTIME / "contacts-v1/comparison.json"
REFERENCE_HISTORY = ROOT / "docs/verification/parent-hours-font-2026-10-11/width-after-390-v2/comparison.json"
PDF = ROOT / "\u7d20\u6750/UI\u66f4\u65b0\u5bb6\u957f+\u5408\u4f5c\u65b9(1).pdf"
REFERENCE = ROOT / "tmp/pdfs/ui-source-audit-20261010-01a1258e/new/page-04.png"
PDF_CROP = [98, 180, 586, 1238]
SOURCE_HASH = "8C77A483A852E3F1D252D02FE24B3EC49FDC09820AC658A779A23E6245FD4EE4"
LAYERS = [
    (232, "shape", True, 255, False), (104, "shape", True, 230, False),
    (530, "pixel", True, 255, False), (529, "pixel", False, 255, False),
    (190, "shape", True, 255, False), (195, "shape", True, 255, False),
    (233, "shape", True, 255, False), (206, "shape", True, 255, False),
    (532, "pixel", True, 255, False), (531, "pixel", True, 41, True),
    (213, "shape", True, 255, False), (221, "shape", True, 255, False),
]
ASSETS = [
    ("hours-mascot.png", 529, ".balance-card__mascot", ".balance-card__mascot-frame"),
    ("hours-ledger-mascot.png", 532, ".ledger__mascot", None),
]


def read_json(filename):
    return json.loads(filename.read_text(encoding="utf-8"))


def record(filename):
    return {"path": filename.relative_to(ROOT).as_posix(), "sha256": file_digest(filename)}


def verify_inputs(inputs):
    if len({item["path"] for item in inputs}) != len(inputs):
        raise ValueError("Duplicate evidence input")
    for item in inputs:
        filename = (ROOT / item["path"]).resolve()
        if not filename.is_relative_to(ROOT) or not re.fullmatch(r"[a-fA-F0-9]{64}", item["sha256"]) \
                or file_digest(filename) != item["sha256"].upper():
            raise ValueError(f"Input fingerprint changed or invalid: {item['path']}")


def verify_history(inputs, filenames):
    reused = []
    for filename in filenames:
        matches = [item for item in inputs if item["path"] == filename.relative_to(ROOT).as_posix()]
        if len(matches) != 1:
            raise ValueError(f"Expected unique historical fingerprint: {filename.name}")
        reused.append(matches[0])
    verify_inputs(reused)
    return reused


def source_page(geometry):
    pages = [p for p in geometry["pages"] if p["role"] == "parent" and p["page"] == "P3"]
    sources = [s for s in geometry["sources"] if s["role"] == "parent" and s["version"] == "new"]
    if len(pages) != 1 or len(sources) != 1 or sources[0]["sha256"].upper() != SOURCE_HASH:
        raise ValueError("Source role/page identity changed")
    page = pages[0]
    if page["stackIndex"] != 1 or page["bboxDocumentPx"] != [1225, 0, 2350, 2436] \
            or page["sizeRpx"] != [750, 1624]:
        raise ValueError("Source artboard changed")
    if len({layer["layerId"] for layer in page["layers"]}) != len(page["layers"]):
        raise ValueError("Duplicate source layer")
    for layer_id, kind, visible, opacity, clipping in LAYERS:
        layer = next((l for l in page["layers"] if l["layerId"] == layer_id), None)
        if layer is None or (layer["kind"], layer["visibleEffective"], layer["opacity255"],
                             layer["clipping"]) != (kind, visible, opacity, clipping):
            raise ValueError(f"Source layer structure changed: {layer_id}")
    return page, sources[0]


def verify_runtime(geometry, report):
    # Invoke the existing read-only validator, not its evidence-writing CLI entry point.
    module = (ROOT / ".tools-automation/measure_parent_hours_sources.mjs").as_uri()
    script = """
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const { measureSources, verifyRuntimeInputs } = await import(process.argv[1]);
const { geometry, report } = JSON.parse(fs.readFileSync(0, 'utf8'));
verifyRuntimeInputs(report, p => createHash('sha256')
  .update(fs.readFileSync(path.join(process.argv[2], p))).digest('hex').toUpperCase());
console.log(JSON.stringify(measureSources(geometry, report)));
"""
    completed = subprocess.run(
        [shutil.which("node") or "node", "--input-type=module", "-e", script, module, str(ROOT)],
        input=json.dumps({"geometry": geometry, "report": report}), capture_output=True,
        text=True, encoding="utf-8", timeout=45, check=False,
    )
    if completed.returncode:
        raise ValueError(f"Saved native evidence rejected: {completed.stderr.strip()}")
    return json.loads(completed.stdout)


def event_data(report, label):
    matches = [event for event in report["events"] if event["label"] == label]
    if len(matches) != 1 or matches[0]["response"].get("ok") is not True \
            or matches[0]["response"]["result"].get("success") is not True:
        raise ValueError(f"Expected unique successful event: {label}")
    return matches[0]["response"]["result"]["result"]["result"]


def rectangle(rect):
    if len(rect) != 4 or not all(math.isfinite(v) for v in rect) or min(rect[2:]) <= 0:
        raise ValueError("Invalid alpha projection rectangle")
    return rect


def intersect(a, b):
    rectangle(a)
    rectangle(b)
    left, top = max(a[0], b[0]), max(a[1], b[1])
    right, bottom = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    if right <= left or bottom <= top:
        raise ValueError("Alpha projection does not intersect clipping frame")
    return [left, top, right - left, bottom - top]


def alpha_projection(image, rect, clip):
    visible = intersect(rect, clip)
    x, y, width, height = rect
    local = [
        max(0, math.floor((visible[0] - x) * image.width / width)),
        max(0, math.floor((visible[1] - y) * image.height / height)),
        min(image.width, math.ceil((visible[0] + visible[2] - x) * image.width / width)),
        min(image.height, math.ceil((visible[1] + visible[3] - y) * image.height / height)),
    ]
    cropped = image.convert("RGBA").crop(local)
    projected = {}
    for threshold, bounds in image_record(cropped)["alphaBoundsPx"].items():
        if bounds is None:
            projected[threshold] = None
            continue
        support = [x + (local[0] + bounds[0]) * width / image.width,
                   y + (local[1] + bounds[1]) * height / image.height,
                   (bounds[2] - bounds[0]) * width / image.width,
                   (bounds[3] - bounds[1]) * height / image.height]
        projected[threshold] = [round(v, 6) for v in intersect(support, visible)]
    return {"imageRectRpx": rect, "clipRectRpx": clip, "cropImagePx": local,
            "alphaBoundsRpx": projected,
            "basis": "Thresholded stored pixel support after rectangular clip; no occlusion or ink acceptance"}


def place_plane(image, size, offset):
    if len(size) != 2 or len(offset) != 2 or any(type(v) is not int for v in (*size, *offset)) \
            or min(size) <= 0:
        raise ValueError("Invalid plane placement dimensions")
    result = Image.new("RGBA", size)
    x, y = offset
    left, top = max(0, -x), max(0, -y)
    right, bottom = min(image.width, size[0] - x), min(image.height, size[1] - y)
    if left < right and top < bottom:
        result.paste(image.convert("RGBA").crop((left, top, right, bottom)), (x + left, y + top))
    return result


def clipped_cache_model(base, mascot, opacity):
    if base.size != mascot.size:
        raise ValueError("Source clipping model needs matching cache planes")
    result = Image.alpha_composite(base.convert("RGBA"), with_opacity(mascot, opacity))
    result.putalpha(base.convert("RGBA").getchannel("A"))
    return result


def native_interior_model(mascot, color, foreground_alpha):
    if not math.isfinite(foreground_alpha) or not 0 <= foreground_alpha <= 1:
        raise ValueError("Invalid native foreground alpha")
    base = Image.new("RGBA", mascot.size, (*color, 255))
    foreground = Image.new("RGBA", mascot.size, (*color, round(foreground_alpha * 255)))
    return Image.alpha_composite(Image.alpha_composite(base, mascot.convert("RGBA")), foreground)


def checked_screenshot(report, name):
    filename = RUNTIME / f"{name}.png"
    events = [e for e in report["events"] if e["label"] == f"screenshot:{name}"]
    if len(events) != 1 or events[0]["response"].get("ok") is not True:
        raise ValueError("Missing unique screenshot receipt")
    receipt = events[0]["response"]["result"]
    image = open_srgb(filename)
    if receipt.get("success") is not True or Path(receipt["path"]).resolve() != filename.resolve() \
            or list(image.size) != [receipt["imageWidth"], receipt["imageHeight"]]:
        raise ValueError("Screenshot path/size mismatch")
    return image


def build_audit():
    receipt = read_json(CONTACT_HISTORY)
    verify_inputs(receipt["inputs"])
    if receipt["referencePhysicalPage"] != 4 or receipt["referenceCropPixels"] != PDF_CROP:
        raise ValueError("Wrong historical reference page/crop")
    reused = verify_history(receipt["inputs"], [MAPPING, REFERENCE_HISTORY])
    mapping = read_json(MAPPING)
    verify_inputs(mapping["inputs"])
    reused += verify_history(mapping["inputs"], [
        GEOMETRY,
        ROOT / ".tools-automation/measure_parent_hours_sources.mjs",
        ROOT / ".tools-automation/measure_parent_home_anchors.mjs",
        ROOT / mapping["source"]["path"],
        RUNTIME / "runtime.json",
        *[RUNTIME / f"{name}.png" for name in ("standard-top", "standard-bottom", "restored-parent-home")],
    ])
    reused += verify_history(read_json(REFERENCE_HISTORY)["inputs"], [PDF, REFERENCE])
    verify_history(receipt["reusedReferenceInputs"], [PDF, REFERENCE])
    geometry = read_json(GEOMETRY)
    page, source = source_page(geometry)
    source_path = ROOT / source["path"]
    verify_inputs([source])
    report = read_json(RUNTIME / "runtime.json")
    measured = verify_runtime(geometry, report)
    if measured != {key: value for key, value in mapping.items() if key != "inputs"}:
        raise ValueError("Saved mapper output differs from current verified evidence")
    capture = event_data(report, "nodes:standard-top")
    viewport = capture["nodes"][len(capture["selectors"])]
    window = capture["window"]
    native = checked_screenshot(report, "standard-top")
    for name in ("standard-bottom", "restored-parent-home"):
        checked_screenshot(report, name)
    if abs(native.height / native.width - window["windowHeight"] / window["windowWidth"]) > 0.005:
        raise ValueError("Screenshot ratio differs from measured viewport")
    full_reference = open_srgb(REFERENCE)
    if not (0 <= PDF_CROP[0] < PDF_CROP[2] <= full_reference.width
            and 0 <= PDF_CROP[1] < PDF_CROP[3] <= full_reference.height):
        raise ValueError("Missing full reference pixels")
    reference = full_reference.crop(PDF_CROP)
    psd = PSDImage.open(source_path)
    board = psd[page["stackIndex"]]
    if list(board.bbox) != page["bboxDocumentPx"]:
        raise ValueError("Actual source board differs from archive")
    layers = list(board.descendants())
    if len({layer.layer_id for layer in layers}) != len(layers):
        raise ValueError("Actual source layer ids are duplicated")
    layers = {layer.layer_id: layer for layer in layers}
    metadata = {layer["layerId"]: layer for layer in page["layers"]}
    images, rows, planes, panel_contact = {}, [], {}, []
    factor = 750 / board.width
    for layer_id, kind, visible, opacity, clipping in LAYERS:
        layer = layers[layer_id]
        item = metadata[layer_id]
        if (layer.kind, layer.is_visible(), layer.opacity, layer.clipping) \
                != (kind, visible, opacity, clipping) or list(layer.bbox) != item["bboxDocumentPx"] \
                or layer.has_mask() != item["hasRasterMask"] \
                or layer.has_vector_mask() != item["hasVectorMask"]:
            raise ValueError(f"Actual source layer differs from archive: {layer_id}")
        raw = layer.topil(apply_icc=True).convert("RGBA")
        if list(raw.size) != [layer.width, layer.height]:
            raise ValueError("Source cache dimensions changed")
        planes[layer_id] = raw
        images[f"layer-{layer_id}-raw.png"] = raw
        ancestors, parent = [], layer.parent
        while parent is not psd:
            ancestors.append({"layerId": parent.layer_id, "opacity255": parent.opacity,
                              "visible": parent.visible, "blendMode": parent.blend_mode.name})
            parent = parent.parent
        effects = []
        for effect in layer.effects:
            entry = {"kind": type(effect).__name__, "descriptor": descriptor(effect.descriptor)}
            if hasattr(effect, "angle"):
                entry["resolvedAngleDegrees"] = number(effect.angle)
            effects.append(entry)
        row = {
            "layerId": layer_id, "kind": kind, "visibleEffective": visible, "opacity255": opacity,
            "clipping": clipping, "blendMode": layer.blend_mode.name, "ancestors": ancestors,
            "bboxDocumentPx": list(layer.bbox), "boundsRpx": item["bounds"]["rpx"],
            "rasterMask": mask_record(layer.mask),
            "vectorMask": vector_record(layer.vector_mask, psd.size, board.bbox),
            "rawCache": image_record(raw), "effectsEnabled": layer.effects.enabled, "effects": effects,
            "sourceDescriptors": {
                tag.name: descriptor(layer.tagged_blocks.get_data(tag))
                for tag in (Tag.VECTOR_STROKE_CONTENT_DATA, Tag.SOLID_COLOR_SHEET_SETTING,
                            Tag.GRADIENT_FILL_SETTING, Tag.VECTOR_ORIGINATION_DATA,
                            Tag.VECTOR_STROKE_DATA, Tag.BLEND_FILL_OPACITY)
                if tag in layer.tagged_blocks
            },
        }
        if opacity != 255:
            preview = with_opacity(raw, opacity)
            images[f"layer-{layer_id}-opacity-only.png"] = preview
            row["opacityOnlyCache"] = image_record(preview)
        rows.append(row)
        if kind == "shape":
            panel_contact.append((f"Layer {layer_id}: cache only / opacity {opacity}", background(with_opacity(raw, opacity))))
    layouts = {entry["selector"]: entry["boundsRpx"] for entry in measured["nativeLayout"]}
    native_clip = [0, viewport["scrollTop"] * 750 / window["windowWidth"],
                   750, window["windowHeight"] * 750 / window["windowWidth"]]
    asset_rows, mascot_contact, overlays = [], [], [(reference.copy(), []), (native.copy(), [])]
    for filename, layer_id, selector, clip_selector in ASSETS:
        path = ROOT / "frontend/pages/parent/assets" / filename
        with Image.open(path) as opened:
            asset = opened.convert("RGBA")
        original = planes[layer_id]
        scaled = original.resize(asset.size, Image.Resampling.LANCZOS)
        quantized = scaled.quantize(colors=255, method=Image.Quantize.FASTOCTREE).convert("RGBA")
        rect = layouts[selector][0]
        if abs(rect[3] - rect[2] * asset.height / asset.width) > 0.5 * 750 / window["windowWidth"]:
            raise ValueError("Measured widthFix image aspect changed")
        clip = intersect(layouts[clip_selector][0], native_clip) if clip_selector else native_clip
        projected = alpha_projection(asset, rect, clip)
        source_id = 530 if layer_id == 529 else layer_id
        source_projection = alpha_projection(planes[source_id], metadata[source_id]["bounds"]["rpx"],
                                            [0, 0, 750, 1624])
        asset_rows.append({
            "asset": filename, "provenanceLayerId": layer_id, "visibleSourceLayerId": source_id,
            "assetPixels": image_record(asset),
            "testedRecipes": {"lanczos": difference(asset, scaled),
                              "lanczos255FastOctree": difference(asset, quantized)},
            "native": projected, "visibleSource": source_projection,
            "status": "rectangular-alpha-projection-only",
        })
        cropped = asset.crop(projected["cropImagePx"])
        if clip_selector:
            images["balance-current-clipped-cache.png"] = cropped
        mascot_contact.extend([
            (f"Source visible {source_id}: raw cached plane (fit)", background(planes[source_id])),
            (f"Current {filename}: clipped pixel support (fit)", background(cropped)),
        ])
        overlays[0][1].append(source_projection["alphaBoundsRpx"]["127"])
        overlays[1][1].append(projected["alphaBoundsRpx"]["127"])
    source_mascot = place_plane(planes[531], planes[206].size,
                               (layers[531].left - layers[206].left,
                                layers[531].top - layers[206].top))
    source_model = clipped_cache_model(planes[206], source_mascot, layers[531].opacity)
    panel_rect, mascot_rect = layouts[".ledger__panel"][0], layouts[".ledger__mascot"][0]
    model_scale = 1.5
    model_size = tuple(round(v * model_scale) for v in panel_rect[2:])
    with Image.open(ROOT / "frontend/pages/parent/assets/hours-ledger-mascot.png") as opened:
        native_mascot = opened.convert("RGBA").resize(
            tuple(round(v * model_scale) for v in mascot_rect[2:]), Image.Resampling.LANCZOS)
    native_plane = place_plane(native_mascot, model_size, tuple(
        round((mascot_rect[axis] - panel_rect[axis]) * model_scale) for axis in (0, 1)))
    native_model = native_interior_model(native_plane, (246, 212, 104), 0.84)
    balance_full_crop = planes[529].crop((0, 0, 742, 789))
    balance_cache_delta = ImageChops.difference(planes[530], balance_full_crop)
    balance_cache_difference = difference(planes[530], balance_full_crop)
    balance_cache_difference["differentBoundsPxByChannel"] = {
        name: list(channel.getbbox()) if channel.getbbox() else None
        for name, channel in zip("RGBA", balance_cache_delta.split())
    }
    images["ledger-source-cache-model.png"] = source_model
    images["ledger-native-interior-model.png"] = native_model
    images["shape-cache-contact.png"] = contact(panel_contact, cell=(510, 260))
    images["mascot-cache-contact.png"] = contact(mascot_contact, cell=(510, 390))
    source_extent = [board.left, board.top, board.width, board.height]
    native_extent = [0, 0, window["windowWidth"], window["windowHeight"]]
    source_crop = reference.crop(pixel_box(
        [layers[206].left, layers[206].top, layers[206].width, layers[206].height],
        source_extent, reference.size))
    panel_node = capture["nodes"][capture["selectors"].index(".ledger__panel")][0]
    native_crop = native.crop(pixel_box([panel_node[key] for key in ("left", "top", "width", "height")],
                                        native_extent, native.size))
    images["ledger-composition-contact.png"] = contact([
        ("PSD clipping cache model; no shadow/text (fit)", background(source_model)),
        ("Native interior model; no corners/shadow/text (fit)", background(native_model)),
        ("PDF: source nominal panel projection (fit)", source_crop),
        ("Saved native: measured dynamic panel (fit)", native_crop),
    ], cell=(510, 300))
    overlay_panels = []
    for label, (image, boxes) in zip(("PDF source projection", "Saved native 390 projection"), overlays):
        draw = ImageDraw.Draw(image)
        for bounds in boxes:
            if bounds:
                x, y, w, h = bounds
                top_offset = native_clip[1] if label.startswith("Saved") else 0
                scale_x, scale_y = image.width / 750, image.height / (
                    native_clip[3] if label.startswith("Saved") else 1624)
                draw.rectangle((x * scale_x, (y - top_offset) * scale_y,
                                (x + w) * scale_x, (y + h - top_offset) * scale_y),
                               outline="#cf134e", width=2)
        overlay_panels.append((label + " / alpha>127 boxes only", image))
    context = [
        GEOMETRY, MAPPING, CONTACT_HISTORY, REFERENCE_HISTORY, source_path, PDF, REFERENCE,
        Path(__file__), Path(__file__).with_name("test_parent_hours_material.py"),
        Path(__file__).with_name("test_parent_hours_material_evidence.py"),
        Path(__file__).with_name("audit_parent_growth_material.py"),
        Path(__file__).with_name("audit_parent_growth_stars.py"),
        Path(__file__).with_name("compare_parent_hours_font.py"),
        Path(__file__).with_name("measure_parent_hours_sources.mjs"),
        Path(__file__).with_name("measure_parent_home_anchors.mjs"),
    ]
    inputs = {item["path"]: item for item in mapping["inputs"] + report["inputs"]}
    inputs.update({item["path"]: item for item in map(record, context)})
    inputs = list(inputs.values())
    verify_inputs(inputs)
    result = {
        "schemaVersion": 1, "page": "parent/P3", "acceptance": "material-diagnostic-only",
        "source": source, "board": {"bboxDocumentPx": list(board.bbox), "documentSizePx": list(psd.size),
                                  "documentPxToRpx": factor},
        "native": {"reuse": RUNTIME.relative_to(ROOT).as_posix(), "freshCapture": False,
                   "window": window, "viewport": viewport, "restorationRevalidatedFromSavedReport": True,
                   "currentRuntimeInputCount": len(report["inputs"]),
                   "owner": event_data(report, "original-home-baseline")["owner"]},
        "historicalReuse": {"manifests": [record(p) for p in (CONTACT_HISTORY, MAPPING, REFERENCE_HISTORY)],
                            "verifiedInputs": reused},
        "reference": {"physicalPage": 4, "cropPixels": PDF_CROP},
        "layers": rows, "assets": asset_rows,
        "balanceSourceCacheVsFullCrop": balance_cache_difference,
        "ledgerFullVsDimRawCache": difference(planes[532], planes[531]),
        "ledgerComposition": {
            "source": {"baseLayerId": 206, "clippedLayerId": 531, "opacity255": 41,
                       "model": image_record(source_model)},
            "native": {"baseRgb": [246, 212, 104], "foregroundAlpha": 0.84,
                       "mascotTransmission": 0.16, "panelRectRpx": panel_rect,
                       "mascotRectRpx": mascot_rect, "model": image_record(native_model)},
            "basis": "Separate cache/flat interior models; geometry, source/asset pixels and clipping differ",
        },
        "nativeStyles": {selector: capture["nodes"][capture["selectors"].index(selector)]
                         for selector in (".balance-card", ".balance-card__mascot-frame",
                                          ".hour-card", ".balance-card__renew >>> .primary-btn",
                                          ".ledger__panel", ".ledger__divider")},
        "vectorRebuild": {"attempted": False, "aggdrawAvailable": find_spec("aggdraw") is not None},
        "inputs": inputs,
        "limits": [
            "Raw sRGB caches do not separately evaluate masks, layer opacity, effects or Photoshop composition.",
            "Empty stored raster mask differs from absent mask; full vector knots and origin transforms archived.",
            "Stored origin radii are not CSS border radii; Photoshop shadow size/choke is not CSS blur/spread.",
            "Alpha support is scanned after rectangular clipping; interpolation and final occlusion remain unverified.",
            "Source 529 is hidden provenance only; approved complete balance asset and current clip remain unchanged.",
            "Only tested pixel recipes establish reproducibility; failed recipes do not prove asset replacement needed.",
            "Ledger source model retains base-cache alpha; native flat interior model omits corners, shadow and text.",
            "Models use different source/native dynamic panel geometry; no fitted alignment or pixel equivalence.",
            "Background 232 is archived with vector controls/effects; final page background composition remains pending.",
            "Saved 390 evidence is fingerprint-bound and recovery/owner revalidated; no fresh IDE capture.",
            "Approved colors, shadows, full mascots, common controls and ledger title/stroke are preserved.",
            "No complete P3/R0/R2, other-width full material, real API, fallback font or production acceptance.",
        ],
    }
    return result, images, overlay_panels


def write_audit(name):
    if not re.fullmatch(r"[A-Za-z0-9-]+", name):
        raise ValueError("Invalid evidence directory name")
    directory = BASE / name
    if directory.exists():
        raise FileExistsError("Preserve existing material evidence")
    result, images, overlays = build_audit()
    directory.mkdir()
    for filename, image in images.items():
        with (directory / filename).open("xb") as stream:
            image.save(stream, format="PNG")
    sheet(directory / "alpha-projection-contact.png", [overlays])
    result["outputs"] = [record(directory / filename) for filename in [*images, "alpha-projection-contact.png"]]
    verify_inputs(result["inputs"])
    with (directory / "material.json").open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=True, indent=2)
        stream.write("\n")
    print(f"{directory.relative_to(ROOT).as_posix()}: 12 layers; diagnostic only; no app/IDE changes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default="material-v2")
    write_audit(parser.parse_args().name)
