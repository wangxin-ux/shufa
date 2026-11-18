"""Export independent P6 star planes to new evidence only; never write app assets."""

import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw
from psd_tools import PSDImage


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "docs/verification/parent-growth-source-2026-10-11"
GEOMETRY = ROOT / "docs/verification/ui-source-geometry-2026-10-10/psd-geometry-v2.json"
ASSET = ROOT / "frontend/pages/parent/assets/rating-star.png"
GROUPS = [
    ("performance", 865, [860, 861, 862, 864, 867, 863]),
    ("teaching", 877, [871, 872, 873, 874, 875, 876]),
    ("communication", 887, [881, 882, 883, 884, 885, 886]),
    ("environment", 896, [890, 891, 892, 893, 894, 895]),
    ("overall", 905, [899, 900, 901, 902, 903, 904]),
]


def file_digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest().upper()


def preserved_original_bytes(path, expected_hash):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest().upper() != expected_hash:
        raise ValueError("Current asset fingerprint changed before preserving original bytes")
    return data


def rgba_digest(image):
    rgba = image.convert("RGBA")
    digest = hashlib.sha256()
    digest.update(rgba.width.to_bytes(8, "big"))
    digest.update(rgba.height.to_bytes(8, "big"))
    digest.update(rgba.tobytes())
    return digest.hexdigest().upper()


def with_opacity(image, opacity255):
    if type(opacity255) is not int or not 0 <= opacity255 <= 255:
        raise ValueError("Invalid layer opacity")
    result = image.convert("RGBA").copy()
    result.putalpha(result.getchannel("A").point(
        [round(value * opacity255 / 255) for value in range(256)]))
    return result


def render_rating(image, fill):
    if fill not in (0, 50, 100):
        raise ValueError("Expected empty, half or full star")
    rgba = image.convert("RGBA")
    base = with_opacity(rgba, 153)
    foreground = Image.new("RGBA", rgba.size)
    width = round(rgba.width * fill / 100)
    if width:
        foreground.paste(rgba.crop((0, 0, width, rgba.height)), (0, 0))
    return Image.alpha_composite(base, foreground)


def validate_candidate(image, expected_size):
    if list(image.size) != list(expected_size):
        raise ValueError("Candidate dimensions differ from the source plane")
    if not 0.8 <= image.width / image.height <= 1.3:
        raise ValueError("Candidate must be a full star, not a cropped half")
    histogram = image.convert("RGBA").getchannel("A").histogram()
    if histogram[0] == 0 or sum(histogram[1:]) == 0:
        raise ValueError("Candidate must have transparent background and visible ink")


def open_verified_board(path, expected_hash, stack_index, expected_box):
    if file_digest(path) != expected_hash:
        raise ValueError("Source fingerprint changed")
    board = PSDImage.open(path)[stack_index]
    if list(board.bbox) != list(expected_box):
        raise ValueError("Source artboard changed")
    return board


def image_record(image):
    rgba = image.convert("RGBA")
    histogram = rgba.getchannel("A").histogram()
    bounds = {}
    for threshold in (0, 127):
        mask = rgba.getchannel("A").point(
            [255 if value > threshold else 0 for value in range(256)])
        box = mask.getbbox()
        bounds[str(threshold)] = list(box) if box else None
    return {
        "sizePx": list(rgba.size), "rgbaSha256": rgba_digest(rgba),
        "alphaBoundsPx": bounds, "alphaExtrema": list(rgba.getchannel("A").getextrema()),
        "alphaCounts": {"transparent": histogram[0], "opaque": histogram[255],
                        "partial": sum(histogram[1:255]), "total": rgba.width * rgba.height},
    }


def difference(a, b):
    if a.size != b.size:
        return {"sameSize": False, "rgbaEqual": False}
    delta = ImageChops.difference(a.convert("RGBA"), b.convert("RGBA"))
    return {"sameSize": True, "rgbaEqual": rgba_digest(a) == rgba_digest(b),
            "maxChannelDelta": [value[1] for value in delta.getextrema()],
            "differentPixels": sum(any(pixel) for pixel in delta.getdata())}


def background(image, color=None):
    result = Image.new("RGBA", image.size, color or "white")
    if color is None:
        draw = ImageDraw.Draw(result)
        for top in range(0, image.height, 12):
            for left in range(0, image.width, 12):
                if (top // 12 + left // 12) % 2:
                    draw.rectangle((left, top, left + 11, top + 11), fill="#d8d8d8")
    return Image.alpha_composite(result, image.convert("RGBA")).convert("RGB")


def contact(panels, columns=2, cell=(510, 230)):
    canvas = Image.new("RGB", (columns * cell[0], math.ceil(len(panels) / columns) * cell[1]),
                       "white")
    draw = ImageDraw.Draw(canvas)
    for index, (label, image) in enumerate(panels):
        x, y = index % columns * cell[0], index // columns * cell[1]
        draw.text((x + 12, y + 10), label, fill="black")
        view = image.copy()
        view.thumbnail((cell[0] - 24, cell[1] - 44), Image.Resampling.LANCZOS)
        canvas.paste(view, (x + 12, y + 34))
    return canvas


def star_plane_contact(current, candidate):
    panels = []
    for label, image in ((f"Before runtime {current.width}x{current.height}", current),
                         (f"PSD layer 860 {candidate.width}x{candidate.height}", candidate)):
        enlarged = image.resize((image.width * 3, image.height * 3), Image.Resampling.NEAREST)
        panels.extend([(f"{label} / checker (3x)", background(enlarged)),
                       (f"{label} / orange (3x)", background(enlarged, "#fe8319"))])
    return contact(panels, cell=(510, 340))


def rating_row(image, size):
    scaled = image.resize((size, size), Image.Resampling.LANCZOS)
    row = Image.new("RGBA", (size * 5 + 8 * 4, size))
    for index, fill in enumerate((100, 100, 100, 50, 0)):
        row.alpha_composite(render_rating(scaled, fill), (index * (size + 8), 0))
    return row


def file_record(path):
    return {"path": path.relative_to(ROOT).as_posix(), "sha256": file_digest(path)}


def build_audit():
    geometry = json.loads(GEOMETRY.read_text(encoding="utf-8"))
    page = next(item for item in geometry["pages"]
                if item["role"] == "parent" and item["page"] == "P6")
    source = next(item for item in geometry["sources"]
                  if item["role"] == "parent" and item["version"] == "new")
    source_path = ROOT / source["path"]
    board = open_verified_board(source_path, source["sha256"],
                                page["stackIndex"], page["bboxDocumentPx"])
    layers = {layer.layer_id: layer for layer in board.descendants()}
    metadata = {layer["layerId"]: layer for layer in page["layers"]}
    with Image.open(ASSET) as old:
        current = old.convert("RGBA")
    planes, exports, records, groups = {}, {"current-rating-star.png": current}, [], []
    for name, group_id, ids in GROUPS:
        group = layers[group_id]
        if [layer.layer_id for layer in group] != ids or group.opacity != 255:
            raise ValueError(f"Unexpected source star group: {group_id}")
        for index, layer_id in enumerate(ids):
            layer, item = layers[layer_id], metadata[layer_id]
            opacity = 153 if index in (3, 5) else 255
            if item["kind"] != "pixel" or layer.kind != "pixel" or not layer.is_visible() \
                    or item["opacity255"] != opacity or layer.opacity != opacity \
                    or layer.clipping or layer.has_mask() or layer.has_vector_mask() \
                    or list(layer.effects) or list(layer.bbox) != item["bboxDocumentPx"]:
                raise ValueError(f"Unexpected star layer structure: {layer_id}")
            plane = layer.topil(apply_icc=True)
            if plane is None or plane.mode != "RGBA":
                raise ValueError(f"Expected independent RGBA plane: {layer_id}")
            expected_size = item["bounds"]["px"][2:]
            if list(plane.size) != expected_size:
                raise ValueError(f"Unexpected star plane dimensions: {layer_id}")
            if index != 4:
                validate_candidate(plane, expected_size)
            planes[layer_id] = plane
            display = with_opacity(plane, opacity)
            raw_name, display_name = f"layer-{layer_id}-raw.png", f"layer-{layer_id}-display.png"
            exports[raw_name], exports[display_name] = plane, display
            records.append({
                "group": name, "groupId": group_id, "layerId": layer_id,
                "pathNames": item["pathNames"], "opacity255": opacity,
                "bboxDocumentPx": item["bboxDocumentPx"], "boundsRpx": item["bounds"]["rpx"],
                "raw": {**image_record(plane), "file": raw_name},
                "display": {**image_record(display), "file": display_name},
            })
        boxes = [metadata[layer_id]["bboxDocumentPx"] for layer_id in ids]
        origin = [min(box[0] for box in boxes), min(box[1] for box in boxes)]
        end = [max(box[2] for box in boxes), max(box[3] for box in boxes)]
        row = Image.new("RGBA", (end[0] - origin[0], end[1] - origin[1]))
        for layer_id, box in zip(ids, boxes):
            row.alpha_composite(with_opacity(planes[layer_id], metadata[layer_id]["opacity255"]),
                                (box[0] - origin[0], box[1] - origin[1]))
        exports[f"source-{name}-row.png"] = row
        groups.append({
            "name": name, "groupId": group_id, "layerIds": ids,
            "rowBoundsRpx": [round((origin[0] - board.left) * 2 / 3, 6),
                             round((origin[1] - board.top) * 2 / 3, 6),
                             round(row.width * 2 / 3, 6), round(row.height * 2 / 3, 6)],
            "fullCopies": [difference(planes[ids[0]], planes[other]) for other in ids[1:3]],
            "dimCopies": difference(planes[ids[3]], planes[ids[5]]),
            "halfVsFirstFullLeftCrop": difference(
                planes[ids[4]], planes[ids[0]].crop((0, 0, 48, 91))),
        })
    candidate = planes[860]
    exports["candidate-rating-star.png"] = candidate
    exports["star-plane-contact.png"] = star_plane_contact(current, candidate)
    panels = []
    for size in (64, 60):
        for label, image in (("Current", current), ("Candidate", candidate)):
            row = rating_row(image, size)
            exports[f"model-{label.lower()}-{size}.png"] = row
            panels.append((f"{label} / {size}px model, 3.5 stars", background(row, "#fe8319")))
    for name, _, _ in GROUPS:
        panels.append((f"PSD cached row: {name}",
                       background(exports[f"source-{name}-row.png"], "#fe8319")))
    exports["star-row-contact.png"] = contact(panels, cell=(550, 155))
    report = {
        "schemaVersion": 1, "scope": "Independent P6 star cache/source audit; no app edits",
        "acceptance": "diagnostic-only", "source": source,
        "page": {key: page[key] for key in ("page", "stackIndex", "bboxDocumentPx", "sizeRpx")},
        "colorHandling": "topil(apply_icc=True): sRGB; layer opacity applied separately",
        "recipe": "Layer 860 independent RGBA; no resize, quantization, crop or background removal",
        "current": {**file_record(ASSET), **image_record(current)},
        "candidate": {**image_record(candidate), "layerId": 860,
                      "file": "candidate-rating-star.png"},
        "groups": groups, "layers": records,
        "crossGroupFull": [difference(candidate, planes[ids[0]]) for _, _, ids in GROUPS],
        "currentAtCandidateSize": difference(
            current.resize(candidate.size, Image.Resampling.LANCZOS), candidate),
        "anchors": [{key: metadata[layer_id][key] for key in (
            "layerId", "kind", "pathNames", "bboxDocumentPx", "bounds", "opacity255",
            "clipping", "hasRasterMask", "hasVectorMask", "effects")}
            for layer_id in (849, 853, 854, 869, 855, 907)],
        "inputs": [file_record(path) for path in (
            source_path, GEOMETRY, ASSET, ROOT / "frontend/pages/parent/updates/index.wxml",
            ROOT / "frontend/pages/parent/updates/index.wxss", Path(__file__))],
        "limits": [
            "Raw cached plane excludes layer opacity; display plane includes it.",
            "Model rows use Pillow LANCZOS at square 64/60px, not native rendering evidence.",
            "Source 95/96px width differences and half edge pixels are measured, not assumed equal.",
            "Panel bounds are nominal; masks/effects, text and approved dynamic flow differ.",
            "Child/classroom smartobjects are metadata only; no photo or brand layers exported.",
            "No claim of full page, Photoshop, PDF, native interaction or other width acceptance.",
        ],
    }
    if file_digest(source_path) != source["sha256"]:
        raise ValueError("Source fingerprint changed during audit")
    return report, exports


def write_audit(directory):
    directory = Path(directory)
    if directory.exists():
        raise FileExistsError(f"Preserve existing evidence: {directory}")
    if directory.resolve().parent != BASE.resolve():
        raise ValueError("Output must be a new direct child of the dedicated evidence directory")
    report, images = build_audit()
    original = preserved_original_bytes(ASSET, report["current"]["sha256"])
    directory.mkdir()
    outputs = []
    for name, image in images.items():
        filename = directory / name
        with filename.open("xb") as stream:
            image.save(stream, format="PNG")
        outputs.append({**file_record(filename), **image_record(image)})
    original_path = directory / "current-rating-star-original.png"
    with original_path.open("xb") as stream:
        stream.write(original)
    report["originalBytes"] = {**file_record(original_path), "bytes": len(original)}
    report["outputs"] = outputs
    with (directory / "stars.json").open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=True, indent=2)
        stream.write("\n")
    print(json.dumps({"output": directory.relative_to(ROOT).as_posix(),
                      "layers": len(report["layers"]), "images": len(images),
                      "candidate": report["candidate"], "groups": report["groups"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-name", required=True)
    write_audit(BASE / parser.parse_args().evidence_name)
