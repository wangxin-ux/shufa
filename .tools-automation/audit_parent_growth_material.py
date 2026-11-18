"""Archive P6 shape caches and material metadata; never change runtime assets."""

import argparse
import json
import math
import re
from collections.abc import Mapping
from enum import Enum
from importlib.util import find_spec
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage
from psd_tools.constants import Tag
from psd_tools.psd.base import DictElement, ListElement
from psd_tools.psd.descriptor import Enumerated, UnitFloat

from audit_parent_growth_stars import (
    background, contact, file_digest, image_record, with_opacity,
)
from compare_parent_hours_font import open_srgb, sheet


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "docs/verification/parent-growth-source-2026-10-11"
GEOMETRY = ROOT / "docs/verification/ui-source-geometry-2026-10-10/psd-geometry-v2.json"
NATIVE = ROOT / "docs/verification/parent-growth-font-2026-10-11/star-after-375-v1"
REFERENCE = ROOT / "tmp/pdfs/ui-source-audit-20261010-01a1258e/new/page-07.png"
PDF = ROOT / "\u7d20\u6750/UI\u66f4\u65b0\u5bb6\u957f+\u5408\u4f5c\u65b9(1).pdf"
PDF_CROP = [98, 180, 586, 1238]
NATIVE_HISTORY = BASE / "native-contacts-v1/comparison.json"
REFERENCE_HISTORY = ROOT / "docs/verification/parent-growth-font-2026-10-11/after-375-v1/comparison.json"
MAPPINGS = [
    ("identity", 849, ".growth-identity"),
    ("feedback", 869, ".growth-feedback"),
    ("review", 855, ".growth-review"),
    ("note", 907, ".growth-review__note"),
]


def number(value):
    return float(value.value if hasattr(value, "value") else value)


def descriptor(value):
    if isinstance(value, Enumerated):
        return {"typeID": descriptor(value.typeID), "enum": descriptor(value.enum)}
    if isinstance(value, UnitFloat):
        return {"value": value.value, "unit": value.unit.name}
    if isinstance(value, Enum):
        return value.name
    if isinstance(value, bytes):
        return value.decode("ascii")
    if isinstance(value, (Mapping, DictElement)):
        return {str(descriptor(key)): descriptor(item) for key, item in value.items()}
    if isinstance(value, (tuple, list, ListElement)):
        return [descriptor(item) for item in value]
    if hasattr(value, "value"):
        return descriptor(value.value)
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError(f"Unsupported PSD descriptor type: {type(value).__name__}")


def pixel_box(rect, extent, size):
    if len(rect) != 4 or len(extent) != 4 or len(size) != 2 or not all(
            math.isfinite(value) for value in [*rect, *extent, *size]):
        raise ValueError("Invalid projection dimensions")
    x, y, width, height = rect
    left, top, extent_width, extent_height = extent
    if min(width, height, extent_width, extent_height, *size) <= 0 or x < left or y < top \
            or x + width > left + extent_width or y + height > top + extent_height:
        raise ValueError("Requested pixels lie outside captured extent")
    return [math.floor((x - left) * size[0] / extent_width),
            math.floor((y - top) * size[1] / extent_height),
            math.ceil((x + width - left) * size[0] / extent_width),
            math.ceil((y + height - top) * size[1] / extent_height)]


def sample_patch(image, box):
    if len(box) != 4 or any(type(value) is not int for value in box) \
            or min(box[:2]) < 0 or box[2] > image.width or box[3] > image.height \
            or box[2] <= box[0] or box[3] <= box[1]:
        raise ValueError("Sample must contain existing image pixels")
    patch = image.crop(box).convert("RGB")
    count, color = max(patch.getcolors(patch.width * patch.height))
    return {"boxPixels": box, "modeRgb": list(color), "modeCount": count,
            "pixelCount": patch.width * patch.height,
            "channelRange": [list(pair) for pair in patch.getextrema()]}


def mask_record(mask):
    if mask is None:
        return {"present": False}
    raw = mask.topil(real=False)
    result = {"present": True, "bboxDocumentPx": list(mask.bbox),
              "disabled": mask.disabled, "backgroundColor": mask.background_color,
              "hasReal": mask.has_real(), "storedPixels": "empty" if raw is None else "available"}
    if raw is not None:
        result.update(sizePx=list(raw.size), extrema=list(raw.getextrema()))
    return result


def vector_record(vector, document_size, board_box):
    if vector is None:
        return {"present": False}
    left, top, right, bottom = vector.bbox
    width, height = document_size
    factor = 750 / (board_box[2] - board_box[0])
    paths = []
    for path in vector.paths:
        paths.append({
            "closed": path.is_closed(), "operation": path.operation,
            "knotsNormalizedYX": [{
                key: list(getattr(knot, key)) for key in ("anchor", "preceding", "leaving")
            } for knot in path],
        })
    return {
        "present": True, "disabled": vector.disabled, "inverted": vector.inverted,
        "notLinked": vector.not_linked, "initialFillRule": vector.initial_fill_rule,
        "boundsNormalizedDocument": list(vector.bbox),
        "pathBoundsRpx": [round(value * factor, 6) for value in (
            left * width - board_box[0], top * height - board_box[1],
            (right - left) * width, (bottom - top) * height)],
        "paths": paths,
    }


def event_data(report, label):
    events = [event for event in report.get("events", []) if event["label"] == label]
    if len(events) != 1 or not events[0]["response"].get("ok") \
            or events[0]["response"]["result"].get("success") is not True:
        raise ValueError(f"Expected unique successful event: {label}")
    return events[0]["response"]["result"]["result"]["result"]


def runtime_capture(report):
    if report.get("failure"):
        raise ValueError("Cannot use failed native evidence")
    capture = event_data(report, "nodes:standard-top")
    if capture["route"] != "pages/parent/updates/index" or capture["viewState"] != "ready":
        raise ValueError("Expected ready growth route")
    restoration = event_data(report, "original-home-restored")
    if restoration["viewState"] != "ready" or not all(restoration.get(key) for key in (
            "sameHome", "timerRunning", "readerUnchanged", "runtimeUnchanged")) \
            or not event_data(report, "verification-marker-removed")["markerRemoved"]:
        raise ValueError("Incomplete original restoration")
    return capture


def record(filename):
    return {"path": filename.relative_to(ROOT).as_posix(), "sha256": file_digest(filename)}


def verify_inputs(inputs):
    for item in inputs:
        if file_digest(ROOT / item["path"]) != item["sha256"].upper():
            raise ValueError(f"Input fingerprint changed: {item['path']}")


def verify_reused_inputs(inputs, filenames):
    historical = []
    for filename in filenames:
        relative = filename.relative_to(ROOT).as_posix()
        matches = [item for item in inputs if item["path"] == relative]
        if len(matches) != 1:
            raise ValueError(f"Expected unique historical fingerprint: {relative}")
        historical.append(matches[0])
    verify_inputs(historical)
    return historical


def build_audit():
    history_records = [record(NATIVE_HISTORY), record(REFERENCE_HISTORY)]
    reused = verify_reused_inputs(
        json.loads(NATIVE_HISTORY.read_text(encoding="utf-8"))["inputs"],
        [NATIVE / "runtime.json", NATIVE / "standard-top.png", NATIVE / "no-photo-top.png"],
    ) + verify_reused_inputs(
        json.loads(REFERENCE_HISTORY.read_text(encoding="utf-8"))["inputs"], [PDF, REFERENCE],
    )
    geometry = json.loads(GEOMETRY.read_text(encoding="utf-8"))
    page = next(item for item in geometry["pages"] if item["role"] == "parent" and item["page"] == "P6")
    source = next(item for item in geometry["sources"] if item["role"] == "parent" and item["version"] == "new")
    source_path = ROOT / source["path"]
    verify_inputs([source])
    psd = PSDImage.open(source_path)
    board = psd[page["stackIndex"]]
    if list(board.bbox) != page["bboxDocumentPx"]:
        raise ValueError("Source artboard changed")
    layers = {layer.layer_id: layer for layer in board.descendants()}
    runtime = json.loads((NATIVE / "runtime.json").read_text(encoding="utf-8"))
    capture = runtime_capture(runtime)
    verify_inputs(runtime["inputs"])
    width, height = capture["window"]["windowWidth"], capture["window"]["windowHeight"]
    viewport = capture["nodes"][len(capture["selectors"])]
    native = open_srgb(NATIVE / "standard-top.png")
    if abs(native.height / native.width - height / width) > 0.005:
        raise ValueError("Screenshot does not match actual native window")
    reference = open_srgb(REFERENCE).crop(PDF_CROP)
    source_extent = [board.left, board.top, board.width, board.height]
    native_extent = [0, 0, width, height]
    images, records, cache_panels, edges = {}, [], [], []
    for name, layer_id, selector in MAPPINGS:
        layer = layers[layer_id]
        raw = layer.topil(apply_icc=True).convert("RGBA")
        display = with_opacity(raw, layer.opacity)
        images[f"{name}-cached-raw.png"] = raw
        images[f"{name}-cached-opacity-only.png"] = display
        cache_panels.extend([
            (f"{name} {layer_id}: raw cache (fit)", background(raw)),
            (f"{name} {layer_id}: opacity {layer.opacity}/255 (fit)", background(display)),
        ])
        selected = capture["nodes"][capture["selectors"].index(selector)]
        if len(selected) != 1:
            raise ValueError(f"Missing unique panel node: {selector}")
        node = selected[0]
        current = {key: node[key] for key in ("left", "top", "width", "height", "opacity")}
        current["documentTopPx"] = node["top"] + viewport["scrollTop"]
        ancestors, parent = [], layer.parent
        while parent is not psd:
            ancestors.append({"layerId": parent.layer_id, "opacity255": parent.opacity,
                              "visible": parent.visible, "blendMode": parent.blend_mode.name})
            parent = parent.parent
        entry = {
            "name": name, "layerId": layer_id, "kind": layer.kind,
            "opacity255": layer.opacity, "blendMode": layer.blend_mode.name,
            "ancestors": ancestors, "effectsEnabled": layer.effects.enabled,
            "boundsRpx": next(item for item in page["layers"] if item["layerId"] == layer_id)["bounds"]["rpx"],
            "rasterMask": mask_record(layer.mask),
            "vectorMask": vector_record(layer.vector_mask, psd.size, board.bbox),
            "rawCache": image_record(raw), "opacityOnlyCache": image_record(display),
            "nativeFrame": current, "sourceDescriptors": {
                tag.name: descriptor(layer.tagged_blocks.get_data(tag))
                for tag in (Tag.VECTOR_STROKE_CONTENT_DATA, Tag.SOLID_COLOR_SHEET_SETTING,
                            Tag.GRADIENT_FILL_SETTING, Tag.VECTOR_ORIGINATION_DATA,
                            Tag.VECTOR_STROKE_DATA, Tag.BLEND_FILL_OPACITY)
                if tag in layer.tagged_blocks
            },
            "effects": [{"kind": type(effect).__name__, "descriptor": descriptor(effect.descriptor),
                         "resolvedAngleDegrees": number(effect.angle)}
                        for effect in layer.effects],
        }
        if name != "identity":
            # The right inset is outside text and stars; retain ranges as well as the mode.
            surfaces = []
            for image, extent, box, inset in (
                (native, native_extent, [node["left"], node["top"], node["width"], node["height"]], 3),
                (reference, source_extent, [layer.left, layer.top, layer.width, layer.height], 10),
            ):
                x, y, w, h = box
                surfaces.append([sample_patch(image, pixel_box(
                    [x + w - inset - 1, y + h * fraction, 1, 1], extent, image.size))
                    for fraction in (0.25, 0.5, 0.75)])
            entry["surfaceSamples"] = {"nativeSrgb": surfaces[0], "pdfReferenceRgb": surfaces[1]}
        if name != "note":
            strips = []
            for label, image, extent, box, factor in (
                ("PDF ref; nominal source projection", reference, source_extent,
                 [layer.left, layer.top, layer.width, layer.height], 1.5),
                ("Reused native; actual frame", native, native_extent,
                 [node["left"], node["top"], node["width"], node["height"]], width / 750),
            ):
                x, y, w, h = box
                band = pixel_box([x + w * 0.35, y + h - 8 * factor, w * 0.3, 24 * factor],
                                 extent, image.size)
                strips.append((f"{name}: {label}", image.crop(band)))
            edges.extend(strips)
        records.append(entry)
    images["panel-cache-contact.png"] = contact(cache_panels, cell=(510, 300))
    images["panel-bottom-edge-contact.png"] = contact(edges, cell=(510, 125))
    context_inputs = [
        GEOMETRY, source_path, PDF, REFERENCE, NATIVE / "runtime.json",
        NATIVE / "standard-top.png", NATIVE / "no-photo-top.png",
        Path(__file__), Path(__file__).with_name("test_parent_growth_material.py"),
        Path(__file__).with_name("test_parent_growth_material_evidence.py"),
        Path(__file__).with_name("audit_parent_growth_stars.py"),
        Path(__file__).with_name("compare_parent_hours_font.py"),
        ROOT / "frontend/styles/parent-pdf.wxss", ROOT / "frontend/styles/tokens.wxss",
        ROOT / "frontend/components/parent-page-shell/parent-page-shell.wxss",
    ]
    inputs = runtime["inputs"] + [record(filename) for filename in context_inputs] + history_records + reused
    verify_inputs(inputs)
    result = {
        "schemaVersion": 1, "page": "parent/P6", "acceptance": "material-diagnostic-only",
        "source": source, "board": {"bboxDocumentPx": list(board.bbox), "documentSizePx": list(psd.size),
                                  "opacity255": board.opacity, "blendMode": board.blend_mode.name},
        "native": {"reuse": NATIVE.relative_to(ROOT).as_posix(), "freshCapture": False,
                   "window": capture["window"], "viewport": viewport,
                   "restorationRevalidatedFromSavedReport": True},
        "reference": {"physicalPage": 7, "cropPixels": PDF_CROP,
                      "basis": "Phone reference crop; nominal source projection, not native coordinates"},
        "historicalReuse": {"manifests": history_records, "verifiedInputs": reused},
        "layers": records, "inputs": inputs,
        "vectorRebuild": {"attempted": False, "aggdrawAvailable": find_spec("aggdraw") is not None},
        "limits": [
            "Cached sRGB RGBA includes stored alpha, but not separately evaluated opacity, effects or masks.",
            "Opacity-only preview multiplies cached alpha; no vector redraw or Photoshop final composite.",
            "Raw descriptor color values are not the same measurement as ICC-converted cached pixels.",
            "Empty stored raster mask is distinct from an absent mask; vector paths remain present.",
            "Origin radii and transforms are archived together, not equated to CSS border radius.",
            "Photoshop size/choke and CSS blur/spread are different; no exact shadow equivalence asserted.",
            "Native images are reused with matching fingerprints; this run does not access the IDE.",
            "Reference sample/edge projection is approximate; no final pixel alignment or color acceptance.",
            "Synthetic runtime photos retained; source smartobjects 853/854 never decoded or exported.",
            "Approved colors, review gradient, shadows, 216rpx identity and natural flow remain unchanged.",
        ],
    }
    return result, images, reference, native


def write_audit(name):
    if not re.fullmatch(r"[A-Za-z0-9-]+", name):
        raise ValueError("Invalid evidence directory name")
    directory = BASE / name
    if directory.exists():
        raise FileExistsError("Preserve existing material evidence")
    result, images, reference, native = build_audit()
    directory.mkdir()
    for filename, image in images.items():
        with (directory / filename).open("xb") as stream:
            image.save(stream, format="PNG")
    sheet(directory / "pdf-native-contact.png", [[
        ("New PDF P6: reference crop", reference),
        ("Reused native 375: standard", native),
        ("Reused native 375: no photo", open_srgb(NATIVE / "no-photo-top.png")),
    ]])
    result["outputs"] = [record(directory / filename)
                         for filename in [*images, "pdf-native-contact.png"]]
    verify_inputs(result["inputs"])
    with (directory / "material.json").open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=True, indent=2)
        stream.write("\n")
    print(f"{directory.relative_to(ROOT).as_posix()}: 4 layers; diagnostic only; no app or IDE changes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default="material-v3")
    write_audit(parser.parse_args().name)
