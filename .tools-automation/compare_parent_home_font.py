import argparse
import hashlib
import json
import re
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageCms, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "docs/verification/parent-home-font-2026-10-11"
REFERENCE = ROOT / "tmp/pdfs/ui-source-audit-20261010-01a1258e/new/page-02.png"
PDF = ROOT / "素材/UI更新家长+合作方(1).pdf"


def open_srgb(filename):
    image = Image.open(filename)
    profile = image.info.get("icc_profile")
    if profile:
        source = ImageCms.ImageCmsProfile(BytesIO(profile))
        return ImageCms.profileToProfile(
            image, source, ImageCms.createProfile("sRGB"), outputMode="RGB"
        )
    return image.convert("RGB")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-name", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-zA-Z0-9-]+", args.evidence_name):
        raise ValueError("Invalid evidence directory name")
    directory = BASE / args.evidence_name
    report = json.loads((directory / "runtime.json").read_text(encoding="utf-8"))
    if report["failure"]:
        raise ValueError("Current report did not complete")
    before = BASE / "runtime-375-v2/source-standard-top.png"
    after = directory / "source-standard-top.png"
    inputs = [REFERENCE, before, after]
    images = [open_srgb(filename) for filename in inputs]
    crop = [98, 180, 586, 1238]
    images[0] = images[0].crop(crop)
    width = 375
    resized = [
        image.resize(
            (width, round(image.height * width / image.width)), Image.Resampling.LANCZOS
        )
        for image in images
    ]
    canvas = Image.new("RGB", (width * 3 + 48, max(image.height for image in resized) + 48), "white")
    draw = ImageDraw.Draw(canvas)
    labels = ["New PDF P1 (reference only)", "Before: extra weight", "After: regular face"]
    for index, (image, label) in enumerate(zip(resized, labels)):
        left = 12 + index * (width + 12)
        draw.text((left, 12), label, fill="black")
        canvas.paste(image, (left, 36))
    with (directory / "source-before-after.png").open("xb") as output:
        canvas.save(output, format="PNG")
    metadata = {
        "scope": "sRGB comparison only; no similarity score or acceptance assertion",
        "reference": {
            "pdf": PDF.relative_to(ROOT).as_posix(),
            "sha256": hashlib.sha256(PDF.read_bytes()).hexdigest(),
            "physicalPage": 2,
            "cropPixels": crop,
        },
        "inputs": [
            {
                "path": filename.relative_to(ROOT).as_posix(),
                "sha256": hashlib.sha256(filename.read_bytes()).hexdigest(),
            }
            for filename in inputs
        ],
    }
    with (directory / "comparison.json").open("x", encoding="utf-8") as output:
        json.dump(metadata, output, ensure_ascii=True, indent=2)
        output.write("\n")
    print(directory / "source-before-after.png")


if __name__ == "__main__":
    main()
