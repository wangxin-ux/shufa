import argparse
import hashlib
import json
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageCms, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "docs/verification/parent-hours-font-2026-10-11"
BEFORE = BASE / "before-375-v2"
AFTER = BASE / "after-375-v3"
REFERENCE = ROOT / "tmp/pdfs/ui-source-audit-20261010-01a1258e/new/page-04.png"
PDF = ROOT / "\u7d20\u6750/UI\u66f4\u65b0\u5bb6\u957f+\u5408\u4f5c\u65b9(1).pdf"


def open_srgb(filename):
    with Image.open(filename) as source:
        profile = source.info.get("icc_profile")
        if profile:
            return ImageCms.profileToProfile(
                source, ImageCms.ImageCmsProfile(BytesIO(profile)),
                ImageCms.createProfile("sRGB"), outputMode="RGB",
            )
        return source.convert("RGB")


def sheet(filename, rows, width=320):
    canvas = Image.new("RGB", (len(rows[0]) * (width + 12) + 12, len(rows) * 740 + 12), "white")
    draw = ImageDraw.Draw(canvas)
    for row_index, row in enumerate(rows):
        for column, (label, image) in enumerate(row):
            left, top = 12 + column * (width + 12), 12 + row_index * 740
            draw.text((left, top), label, fill="black")
            image = image.resize((width, round(image.height * width / image.width)),
                                 Image.Resampling.LANCZOS)
            canvas.paste(image, (left, top + 24))
    with filename.open("xb") as output:
        canvas.save(output, format="PNG")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--before", default=BEFORE.name)
    parser.add_argument("--after", default=AFTER.name)
    parser.add_argument("--reference-crop", nargs=4, type=int, default=[92, 170, 552, 1166])
    args = parser.parse_args()
    before = BASE / args.before
    after = BASE / args.after
    if any(directory.parent != BASE or not directory.is_dir() for directory in (before, after)):
        raise ValueError("Expected existing capture directories inside the evidence base")
    for directory in (before, after):
        if json.loads((directory / "runtime.json").read_text(encoding="utf-8"))["failure"]:
            raise ValueError("Incomplete capture")
    inputs = [REFERENCE, PDF, before / "runtime.json", after / "runtime.json"]
    crop = args.reference_crop
    reference = open_srgb(REFERENCE)
    if not (0 <= crop[0] < crop[2] <= reference.width
            and 0 <= crop[1] < crop[3] <= reference.height):
        raise ValueError("Invalid reference crop")
    standard = []
    for directory in (before, after):
        filename = directory / "standard-top.png"
        inputs.append(filename)
        standard.append(open_srgb(filename))
    sheet(after / "source-before-after.png", [[
        ("New PDF P3 (reference)", reference.crop(crop)),
        (f"Before: {before.name}", standard[0]),
        (f"After: {after.name}", standard[1]),
    ]])
    for output, names in (
        ("wide-number-contact.png", ["wide-two", "wide-many", "decimal"]),
        ("state-contact.png", ["zero", "unknown", "single"]),
    ):
        rows = []
        for name in names:
            row = []
            for label, directory in (("Before", before), ("After", after)):
                filename = directory / f"{name}-top.png"
                inputs.append(filename)
                row.append((f"{label}: {name}", open_srgb(filename)))
            rows.append(row)
        sheet(after / output, rows)
    metadata = {
        "scope": "sRGB visual contacts; reference crop is not a native viewport or full-page acceptance",
        "referencePhysicalPage": 4,
        "referenceCropPixels": crop,
        "inputs": [{"path": filename.relative_to(ROOT).as_posix(),
                    "sha256": hashlib.sha256(filename.read_bytes()).hexdigest()}
                   for filename in inputs],
    }
    with (after / "comparison.json").open("x", encoding="utf-8") as output:
        json.dump(metadata, output, ensure_ascii=True, indent=2)
        output.write("\n")
    print(after / "source-before-after.png")


if __name__ == "__main__":
    main()
