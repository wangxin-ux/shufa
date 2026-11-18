from pathlib import Path
import argparse
from io import BytesIO
from PIL import Image, ImageCms, ImageDraw


def open_srgb(path):
    image = Image.open(path)
    profile = image.info.get("icc_profile")
    if profile:
        source = ImageCms.ImageCmsProfile(BytesIO(profile))
        target = ImageCms.createProfile("sRGB")
        return ImageCms.profileToProfile(image, source, target, outputMode="RGB")
    return image.convert("RGB")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--stage", choices=["before", "after", "final"], required=True)
    parser.add_argument("--pages", type=int, nargs="+", choices=range(1, 7), default=range(1, 7))
    args = parser.parse_args()
    root = args.directory.resolve()
    for page in args.pages:
        reference = open_srgb(root / f"reference-{page + 1}.png")
        # Crop only the left phone screen, excluding the slide annotations.
        reference = reference.crop((98, 180, 586, 1238))
        name = f"current-p{page}"
        if page == 1:
            name += "-verified"
        if args.stage in ("after", "final") and page == 2:
            name = "current-p2-fixed"
        if args.stage == "after" and page == 4:
            name = "current-p4-fixed-native"
        if args.stage == "final" and page == 4:
            name = "current-p4-final"
        current = open_srgb(root / f"{name}.png")
        width = 500
        refs = []
        for source in (reference, current):
            height = round(source.height * width / source.width)
            refs.append(source.resize((width, height), Image.Resampling.LANCZOS))
        canvas = Image.new("RGB", (width * 2 + 36, max(img.height for img in refs) + 66), "white")
        draw = ImageDraw.Draw(canvas)
        draw.text((12, 12), f"P{page}: PDF reference", fill="black")
        draw.text((width + 24, 12), f"P{page}: current 390px ({args.stage})", fill="black")
        canvas.paste(refs[0], (12, 42))
        canvas.paste(refs[1], (width + 24, 42))
        target = root / f"comparison-p{page}-{args.stage}.png"
        if target.exists():
            raise FileExistsError(target)
        canvas.save(target)
        print(target.name)


if __name__ == "__main__":
    main()
