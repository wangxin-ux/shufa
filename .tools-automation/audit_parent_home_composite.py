"""Read-only P1 asset provenance and alpha projection; never exports app assets."""

import argparse
import hashlib
import json
import math
import re
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw
from psd_tools import PSDImage

from compare_parent_home_font import PDF, REFERENCE, ROOT, open_srgb


BASE = ROOT / "docs/verification/parent-home-font-2026-10-11"
GEOMETRY = ROOT / "docs/verification/ui-source-geometry-2026-10-10/psd-geometry-v2.json"
RUNTIME = BASE / "runtime-375-v20/runtime.json"
SHOT = BASE / "runtime-375-v20/source-standard-menu.png"
ASSETS = ROOT / "frontend/pages/parent/assets"
PDF_CROP = (98, 180, 586, 1238)
MAPPINGS = [
    ("home-mascot.png", 527, ".stage__mascot", "widthFix", None),
    ("home-metric-glass.png", 528, ".stage__metrics >>> .metric-card__glass", "scaleToFill", None),
    ("top-wave.png", 76, ".home-shell >>> .shell__wave", "scaleToFill", None),
    ("icon-mark-home.png", 85, ".home-shell >>> .page-mark__icon", "aspectFit", None),
    ("icon-qa-leave.png", 56, ".quickbar__icon", "aspectFit", 0),
    ("icon-qa-hours.png", 61, ".quickbar__icon", "aspectFit", 1),
    ("icon-qa-team.png", 66, ".quickbar__icon", "aspectFit", 2),
    ("icon-qa-remind.png", 51, ".quickbar__remind-icon", "aspectFit", None),
]


def rounded(values):
    return [round(value, 6) for value in values]


def alpha_bounds(image, threshold):
    if not isinstance(threshold, int) or not 0 <= threshold < 255:
        raise ValueError("Invalid alpha threshold")
    mask = image.convert("RGBA").getchannel("A").point(
        [255 if value > threshold else 0 for value in range(256)])
    bounds = mask.getbbox()
    return list(bounds) if bounds else None


def map_image(image, node, mode, window_width, scroll_top=0):
    values = [window_width, node["left"], node["top"], node["width"], node["height"], scroll_top]
    if not all(math.isfinite(value) for value in values) or min(
            window_width, node["width"], node["height"]) <= 0:
        raise ValueError("Invalid native dimensions")
    left, top, width, height = node["left"], node["top"], node["width"], node["height"]
    if mode == "aspectFit":
        scale = min(width / image.width, height / image.height)
        content_width, content_height = image.width * scale, image.height * scale
        left += (width - content_width) / 2
        top += (height - content_height) / 2
    elif mode == "widthFix":
        content_width, content_height = width, width * image.height / image.width
        if abs(height - content_height) > 0.5:
            raise ValueError("widthFix frame does not match native image aspect")
    elif mode == "scaleToFill":
        content_width, content_height = width, height
    else:
        raise ValueError("Unsupported image mode")
    factor = 750 / window_width
    bounds = {}
    for threshold in [0, 127]:
        box = alpha_bounds(image, threshold)
        bounds[str(threshold)] = None if box is None else rounded([
            (left + box[0] * content_width / image.width) * factor,
            (top + scroll_top + box[1] * content_height / image.height) * factor,
            (box[2] - box[0]) * content_width / image.width * factor,
            (box[3] - box[1]) * content_height / image.height * factor,
        ])
    return {"mode": mode, "contentRectPx": rounded([left, top, content_width, content_height]),
            "alphaBoundsRpx": bounds}


def crop_plane(image, layer_box, viewport):
    left, top = max(layer_box[0], viewport[0]), max(layer_box[1], viewport[1])
    right, bottom = min(layer_box[2], viewport[2]), min(layer_box[3], viewport[3])
    if right <= left or bottom <= top:
        raise ValueError("Layer does not intersect the crop viewport")
    local = [left - layer_box[0], top - layer_box[1],
             right - layer_box[0], bottom - layer_box[1]]
    return image.crop(local), [left, top], local


def stack_rgba(base, foreground):
    return Image.alpha_composite(base.convert("RGBA"), foreground.convert("RGBA"))


def clip_to_base(base, foreground, opacity255):
    image = stack_rgba(base, foreground)
    image.putalpha(base.convert("RGBA").getchannel("A").point(
        [round(value * opacity255 / 255) for value in range(256)]))
    return image


def native_corner_mask(size, node, pixel_ratio):
    native_size = (round(node["width"] * pixel_ratio), round(node["height"] * pixel_ratio))
    mask = Image.new("L", native_size)
    radius = float(node["border-radius"].removesuffix("px")) * pixel_ratio
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, native_size[0] - 1, native_size[1] - 1),
                                           radius=radius, fill=255)
    return mask.resize(size, Image.Resampling.LANCZOS)


def rgba_digest(image):
    rgba = image.convert("RGBA")
    return hashlib.sha256(rgba.tobytes()).hexdigest().upper()


def image_record(image):
    histogram = image.convert("RGBA").getchannel("A").histogram()
    total = image.width * image.height
    return {"sizePx": list(image.size), "rgbaSha256": rgba_digest(image),
            "alphaBoundsPx": {str(value): alpha_bounds(image, value) for value in [0, 127]},
            "alphaCounts": {"transparent": histogram[0], "opaque": histogram[255],
                            "partial": sum(histogram[1:255]), "total": total},
            "alphaExtrema": list(image.convert("RGBA").getchannel("A").getextrema())}


def event_result(report, label):
    event = next((item for item in report.get("events", []) if item["label"] == label), None)
    if not event or not event["response"].get("ok") or not event["response"]["result"].get("success"):
        raise ValueError(f"Missing successful runtime event: {label}")
    return event["response"]["result"]["result"]["result"]


def runtime_capture(report):
    if report.get("failure"):
        raise ValueError("Cannot use a failed runtime report")
    capture = event_result(report, "nodes:source-standard-menu")
    if capture["route"] != "pages/parent/home/index" or capture["viewState"] != "ready" or \
            not capture["menuExpanded"] or capture["activeSheet"]:
        raise ValueError("Expected original source-standard expanded home")
    restore = event_result(report, "restore-original-reader-and-home")
    keys = ["runtimeUnchanged", "readerRestored", "studentRestored", "courseRestored",
            "metricsRestored", "timerRestored", "markerRemoved"]
    if restore["viewState"] != "ready" or not all(restore.get(key) for key in keys):
        raise ValueError("Incomplete original restoration")
    return capture


def file_record(filename):
    return {"path": filename.relative_to(ROOT).as_posix(),
            "sha256": hashlib.sha256(filename.read_bytes()).hexdigest().upper()}


def checker(image):
    result = Image.new("RGBA", image.size, "white")
    draw = ImageDraw.Draw(result)
    for top in range(0, image.height, 16):
        for left in range(0, image.width, 16):
            if (top // 16 + left // 16) % 2:
                draw.rectangle((left, top, left + 15, top + 15), fill="#d8d8d8")
    return stack_rgba(result, image).convert("RGB")


def contact(panels, columns=2, cell_width=520, cell_height=220):
    rows = math.ceil(len(panels) / columns)
    canvas = Image.new("RGB", (columns * cell_width, rows * cell_height), "white")
    draw = ImageDraw.Draw(canvas)
    for index, (label, image) in enumerate(panels):
        left, top = index % columns * cell_width, index // columns * cell_height
        draw.text((left + 10, top + 8), label, fill="black")
        image = image.convert("RGB")
        image.thumbnail((cell_width - 20, cell_height - 40), Image.Resampling.LANCZOS)
        canvas.paste(image, (left + 10, top + 30))
    return canvas


def build_audit():
    geometry = json.loads(GEOMETRY.read_text(encoding="utf-8"))
    page = next(item for item in geometry["pages"] if item["role"] == "parent" and item["page"] == "P1")
    source = next(item for item in geometry["sources"] if item["role"] == "parent" and item["version"] == "new")
    source_path = ROOT / source["path"]
    if file_record(source_path)["sha256"] != source["sha256"]:
        raise ValueError("Source fingerprint changed")
    board = PSDImage.open(source_path)[page["stackIndex"]]
    if list(board.bbox) != page["bboxDocumentPx"]:
        raise ValueError("Source artboard changed")
    layers = {layer.layer_id: layer for layer in board.descendants()}
    capture = runtime_capture(json.loads(RUNTIME.read_text(encoding="utf-8")))
    width = capture["window"]["windowWidth"]
    scroll = capture["viewport"]["scrollTop"]
    screenshot = open_srgb(SHOT)
    reference = open_srgb(REFERENCE).crop(PDF_CROP)
    if abs(screenshot.height / screenshot.width -
           capture["window"]["windowHeight"] / width) > 0.005:
        raise ValueError("Screenshot does not match the measured native viewport")
    assets = {name: Image.open(ASSETS / name).convert("RGBA") for name, *_ in MAPPINGS}
    cropped_mascot, mascot_origin, mascot_local = crop_plane(
        layers[527].topil(), layers[527].bbox, board.bbox)
    source_planes = {527: (cropped_mascot, mascot_origin)}
    reconstructed = cropped_mascot.resize(assets["home-mascot.png"].size, Image.Resampling.LANCZOS)
    reconstructed = reconstructed.quantize(colors=255, method=Image.Quantize.FASTOCTREE,
                                           dither=Image.Dither.FLOYDSTEINBERG).convert("RGBA")
    recipes = {"home-mascot.png": {
        "cropLayerLocalPx": mascot_local, "cropDocumentOriginPx": mascot_origin,
        "method": "Artboard intersection; LANCZOS; 255-color FASTOCTREE",
        "rgbaEqual": rgba_digest(reconstructed) == rgba_digest(assets["home-mascot.png"]),
    }}
    glass, glass_origin, glass_local = crop_plane(
        layers[528].topil(), layers[528].bbox, layers[11].bbox)
    source_planes[528] = (glass, glass_origin)
    recipes["home-metric-glass.png"] = {
        "cropLayerLocalPx": glass_local, "cropDocumentOriginPx": glass_origin,
        "method": "Shape-11 rectangle; cached RGBA; LANCZOS; no white base or rounded mask",
        "rgbaEqual": rgba_digest(glass.resize(assets["home-metric-glass.png"].size,
                                             Image.Resampling.LANCZOS)) ==
                     rgba_digest(assets["home-metric-glass.png"]),
    }
    wave = layers[76].composite(viewport=(0, 0, 1125, 360))
    source_planes[76] = (wave, [0, 0])
    recipes["top-wave.png"] = {
        "cropDocumentPx": [0, 0, 1125, 360], "method": "Isolated shape composite; LANCZOS",
        "rgbaEqual": rgba_digest(wave.resize(assets["top-wave.png"].size,
                                            Image.Resampling.LANCZOS)) ==
                     rgba_digest(assets["top-wave.png"]),
    }
    for name, layer_id, *_ in MAPPINGS:
        if layer_id in [51, 56, 61, 66]:
            plane = layers[layer_id].topil()
            source_planes[layer_id] = (plane, list(layers[layer_id].bbox[:2]))
            recipes[name] = {"method": "Independent cached RGBA, no resize",
                             "rgbaEqual": plane.size == assets[name].size and
                             rgba_digest(plane) == rgba_digest(assets[name])}
    recipes["icon-mark-home.png"] = {
        "cropDocumentPx": [73, 194, 136, 256],
        "method": "Known crop; original white-removal threshold not traceable",
        "rgbaEqual": None,
    }
    records = []
    overlay_native = screenshot.copy()
    overlay_source = reference.copy()
    native_draw, source_draw = ImageDraw.Draw(overlay_native), ImageDraw.Draw(overlay_source)
    for name, layer_id, selector, mode, index in MAPPINGS:
        node = capture["nodes"][selector]
        if index is not None:
            node = node[index]
        mapping = map_image(assets[name], node, mode, width, scroll)
        source_mapping = None
        if layer_id in source_planes:
            plane, origin = source_planes[layer_id]
            source_node = {"left": origin[0] * 2 / 3, "top": origin[1] * 2 / 3,
                           "width": plane.width * 2 / 3, "height": plane.height * 2 / 3}
            source_mapping = map_image(plane, source_node, "scaleToFill", 750)
        bounds = mapping["alphaBoundsRpx"]["127"]
        source_bounds = source_mapping["alphaBoundsRpx"]["127"] if source_mapping else None
        delta = rounded([a - b for a, b in zip(bounds, source_bounds)]) if source_bounds else None
        record = {"asset": name, "layerId": layer_id, "selector": selector,
                  "assetPixels": image_record(assets[name]), "native": mapping,
                  "source": source_mapping, "alphaBoundsDeltaRpx127": delta,
                  "status": "projection-not-final-visibility-or-acceptance"}
        records.append(record)
        for draw, box, scale, offset in [
            (native_draw, bounds, screenshot.width / 750, scroll * 750 / width),
            (source_draw, source_bounds, reference.width / 750, 0),
        ]:
            if box:
                x, y, w, h = box
                draw.rectangle((x * scale, (y - offset) * scale,
                                (x + w) * scale, (y + h - offset) * scale),
                               outline="#cf134e", width=2)
    shape = layers[11]
    shape_mask = shape.mask.topil() if shape.has_mask() else None
    cached_shape = shape.topil()
    # Cached clipping is available without the optional aggdraw vector renderer.
    source_glass = clip_to_base(cached_shape, glass, shape.opacity)
    native_style = capture["nodes"][".stage__metrics >>> .metric-card"]
    native_glass = assets["home-metric-glass.png"]
    native_stack = stack_rgba(Image.new("RGBA", native_glass.size, (255, 255, 255, 230)),
                              native_glass)
    mask = native_corner_mask(native_stack.size, native_style, capture["window"]["pixelRatio"])
    native_stack.putalpha(ImageChops.multiply(native_stack.getchannel("A"), mask))
    x, y, w, h = [native_style[key] for key in ["left", "top", "width", "height"]]
    ratio = screenshot.width / width
    native_crop = screenshot.crop((round(x * ratio), round(y * ratio),
                                   round((x + w) * ratio), round((y + h) * ratio)))
    pdf_ratio = reference.width / 1125
    source_crop = reference.crop(tuple(round(value * pdf_ratio) for value in shape.bbox))
    material = {
        "sourceShapeLayerId": 11, "clippedLayerId": 528,
        "sourceShapeOpacity255": shape.opacity, "sourceClipping": layers[528].clipping,
        "rasterMask": {"flagPresent": shape.has_mask(), "bboxPx": list(shape.mask.bbox),
                       "hasPixelData": shape_mask is not None},
        "vectorMaskPresent": shape.has_vector_mask(),
        "sourceCachedBase": image_record(cached_shape),
        "sourceClippingModel": image_record(source_glass),
        "nativeAlphaStackModel": image_record(native_stack), "nativeStyle": native_style,
        "nativeCornerMask": {
            "method": "Circular radius drawn in actual native pixel grid; resampled to asset axes",
            "pixelRatio": capture["window"]["pixelRatio"],
            "nativeGridPx": [round(native_style[key] * capture["window"]["pixelRatio"])
                             for key in ["width", "height"]],
            "nativeRadiusPx": float(native_style["border-radius"].removesuffix("px")),
            "note": "ScaleToFill needs separate axis scaling; model remains diagnostic.",
        },
        "vectorRebuild": {"status": "blocked-before-evidence-write",
                          "error": "ImportError: Vector shape rendering requires: aggdraw",
                          "action": "Use unchanged cached base; no equivalent force retry or install"},
        "limitations": [
            "Source clipping model uses cached base pixels, not vector reconstruction or Photoshop.",
            "Native model excludes the page backdrop, shadow, text and dividers.",
            "Alpha bounds precede foreground occlusion, vector masks and viewport clipping.",
            "Opaque image pixels are not whitened by a white layer underneath.",
            "PDF/native crops retain their actual text and do not assert full material equality.",
        ],
    }
    inputs = [source_path, GEOMETRY, RUNTIME, SHOT, REFERENCE, PDF] + \
        [ASSETS / name for name, *_ in MAPPINGS] + [
            ROOT / "frontend/pages/parent/home/index.wxml",
            ROOT / "frontend/pages/parent/home/index.wxss",
            ROOT / "frontend/components/parent-metric-card/parent-metric-card.wxml",
            ROOT / "frontend/components/parent-metric-card/parent-metric-card.wxss",
            Path(__file__),
        ]
    report = {
        "schemaVersion": 1, "scope": "Independent source/alpha/material diagnostic; no app edits",
        "acceptance": "diagnostic-only", "source": source,
        "capture": {"runtime": RUNTIME.relative_to(ROOT).as_posix(),
                    "window": capture["window"], "scrollTopPx": scroll,
                    "screenshotSizePx": list(screenshot.size), "pdfCropPx": list(PDF_CROP),
                    "note": "Existing v20 capture reused; not a new runtime or another device."},
        "recipes": recipes, "images": records, "material": material,
        "inputs": [file_record(filename) for filename in inputs],
        "pending": [
            "Icon white-removal threshold and original Photoshop clipping/effect reproduction.",
            "Independent final visible silhouette, round-corner and shadow quantification.",
            "390/430 corrected geometry, real API, font fallback and broader glyphs.",
        ],
    }
    outputs = {
        "alpha-projection-contact.png": contact([
            ("New PDF: source alpha boxes", overlay_source),
            ("Existing v20: native alpha boxes", overlay_native)], cell_width=400, cell_height=850),
        "glass-composition-contact.png": contact([
            ("Cached glass RGBA only / checker", checker(native_glass)),
            ("Source cached clipping model / checker", checker(source_glass)),
            ("Native alpha stack model / checker", checker(native_stack)),
            ("New PDF: actual material + text", source_crop),
            ("Existing v20: actual material + text", native_crop),
        ]),
        "asset-alpha-contact.png": contact([
            (name, checker(image)) for name, image in assets.items()]),
    }
    return report, outputs


def write_audit(name):
    if not re.fullmatch(r"composite-375-v\d+", name):
        raise ValueError("Invalid bounded evidence directory")
    directory = BASE / name
    if directory.exists():
        raise FileExistsError(f"Preserve existing evidence: {directory}")
    report, images = build_audit()
    serialized = json.dumps(report, ensure_ascii=True, indent=2) + "\n"
    directory.mkdir()
    for filename, image in images.items():
        with (directory / filename).open("xb") as stream:
            image.save(stream, format="PNG")
    with (directory / "composite.json").open("x", encoding="utf-8") as stream:
        stream.write(serialized)
    print(json.dumps({"evidence": name, "projections": len(report["images"]),
                      "exactRecipes": sum(value["rgbaEqual"] is True
                                          for value in report["recipes"].values()),
                      "acceptance": report["acceptance"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-name", required=True)
    write_audit(parser.parse_args().evidence_name)
