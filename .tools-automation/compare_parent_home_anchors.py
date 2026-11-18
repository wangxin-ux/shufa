import argparse
import hashlib
import json
import re

from PIL import Image, ImageDraw

from compare_parent_home_font import BASE, PDF, REFERENCE, ROOT, open_srgb


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--before", required=True)
    parser.add_argument("--after", required=True)
    args = parser.parse_args()
    for name in [args.before, args.after]:
        if not re.fullmatch(r"runtime-375-v\d+", name):
            raise ValueError("Invalid bounded evidence directory")
        report = json.loads((BASE / name / "runtime.json").read_text(encoding="utf-8"))
        if report["failure"] or not report.get("sourceAnchorOnly"):
            raise ValueError("Expected completed anchor capture")
    directory = BASE / args.after
    names = [
        "source-standard-top",
        "source-standard-bottom",
        "source-standard-menu",
        "source-standard-menu-bottom",
        "restored-parent-home",
    ]
    inputs = [REFERENCE, BASE / args.before / "source-standard-menu.png"] + [
        directory / f"{name}.png" for name in names
    ]
    images = [open_srgb(filename) for filename in inputs]
    crop = [98, 180, 586, 1238]
    columns = [images[0].crop(crop), images[1], images[4]]
    labels = ["New PDF P1: reference", f"Before: {args.before}", f"After: {args.after}"]
    width = 375
    canvas = Image.new("RGB", (width * 3 + 48, 860), "white")
    draw = ImageDraw.Draw(canvas)
    for index, (image, label) in enumerate(zip(columns, labels)):
        image = image.resize((width, round(image.height * width / image.width)),
                             Image.Resampling.LANCZOS)
        left = 12 + index * (width + 12)
        draw.text((left, 12), label, fill="black")
        canvas.paste(image, (left, 36))
    with (directory / "anchor-source-before-after.png").open("xb") as output:
        canvas.save(output, format="PNG")
    metadata = {
        "scope": "sRGB visual review aid only; no similarity score or full-P1 acceptance",
        "reference": {"physicalPage": 2, "cropPixels": crop},
        "inputs": [
            {"path": filename.relative_to(ROOT).as_posix(),
             "sha256": hashlib.sha256(filename.read_bytes()).hexdigest()}
            for filename in inputs + [PDF]
        ],
        "output": "anchor-source-before-after.png",
    }
    with (directory / "anchor-visual-inputs.json").open("x", encoding="utf-8") as output:
        json.dump(metadata, output, ensure_ascii=True, indent=2)
        output.write("\n")
    print(directory / "anchor-source-before-after.png")


if __name__ == "__main__":
    main()
