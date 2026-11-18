import argparse
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageCms, ImageDraw


root = Path(__file__).resolve().parents[1] / "docs" / "verification"
parser = argparse.ArgumentParser()
parser.add_argument("page", type=int, choices=range(1, 7))
parser.add_argument("current")
parser.add_argument("output")
args = parser.parse_args()
out = root / "parent-ui-alignment-2026-10-07"
target = out / args.output
if target.exists():
    raise SystemExit(f"Refusing to overwrite evidence: {target}")


def srgb(path):
    image = Image.open(path)
    profile = image.info.get("icc_profile")
    if profile:
        return ImageCms.profileToProfile(
            image,
            ImageCms.ImageCmsProfile(BytesIO(profile)),
            ImageCms.createProfile("sRGB"),
            outputMode="RGB",
        )
    return image.convert("RGB")


reference = srgb(
    root / "pdf-comparison-2026-10-07" / f"reference-{args.page + 1}.png"
).crop((98, 180, 586, 1238))
current = srgb(out / args.current)
images = [
    image.resize((500, round(image.height * 500 / image.width)), Image.Resampling.LANCZOS)
    for image in (reference, current)
]
canvas = Image.new("RGB", (1036, max(image.height for image in images) + 66), "white")
draw = ImageDraw.Draw(canvas)
draw.text((12, 12), f"P{args.page}: PDF reference (layout only)", fill="black")
draw.text((524, 12), f"P{args.page}: {args.current}", fill="black")
canvas.paste(images[0], (12, 42))
canvas.paste(images[1], (524, 42))
canvas.save(target)
print(target.name)
