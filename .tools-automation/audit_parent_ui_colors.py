"""Record sRGB panel samples, curve shading, and unchanged layout anchors."""
import json
from collections import Counter
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageCms


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/verification/parent-ui-alignment-2026-10-07"
TARGET = OUT / "ui-colors-visual-audit-430-v1.json"
if TARGET.exists():
    raise SystemExit(f"Evidence exists: {TARGET}")


def srgb(path):
    image = Image.open(path)
    profile = image.info.get("icc_profile")
    if profile:
        return ImageCms.profileToProfile(
            image, ImageCms.ImageCmsProfile(BytesIO(profile)),
            ImageCms.createProfile("sRGB"), outputMode="RGB",
        )
    return image.convert("RGB")


def modal(image, box):
    pixels = image.crop(tuple(round(v * size) for v, size in zip(
        box, (image.width, image.height, image.width, image.height),
    )))
    return Counter(pixels.get_flattened_data()).most_common(1)[0][0]


def nodes(name):
    data = json.loads((OUT / name).read_text(encoding="utf-8-sig"))
    return dict(zip(data["selectors"], data["nodeResults"]["result"]["result"]))


current = {
    page: srgb(OUT / (
        "p5-ui-colors-native-texture-430-v1.png" if page == 5
        else f"p{page}-ui-colors-visual-430-v1.png"
    )) for page in range(1, 7)
}
references = {
    page: srgb(ROOT / f"docs/verification/pdf-comparison-2026-10-07/reference-{page + 1}.png")
    .crop((98, 180, 586, 1238)) for page in range(1, 7)
}
# These regions contain panel interiors, not text or controls.
regions = [
    (2, "catalog yellow", (0.09, 0.16, 0.91, 0.52)),
    (2, "bottom gold", (0.04, 0.94, 0.07, 0.97)),
    (3, "page yellow", (0.08, 0.14, 0.85, 0.16)),
    (3, "balance orange", (0.08, 0.23, 0.28, 0.25)),
    (3, "purchased bright yellow", (0.10, 0.49, 0.40, 0.60)),
    (3, "ledger composited yellow", (0.09, 0.72, 0.89, 0.90)),
    (4, "leave bright yellow", (0.89, 0.23, 0.91, 0.52)),
    (4, "leave record yellow", (0.10, 0.73, 0.87, 0.80)),
    (5, "identity orange", (0.10, 0.31, 0.30, 0.35)),
    (5, "menu composited yellow", (0.10, 0.50, 0.90, 0.75)),
    (5, "bottom gold", (0.85, 0.95, 0.88, 0.98)),
    (6, "feedback orange", (0.85, 0.54, 0.89, 0.58)),
    (6, "review warm orange", (0.85, 0.71, 0.89, 0.73)),
]
samples = []
for page, label, box in regions:
    expected = modal(references[page], box)
    actual = modal(current[page], box)
    samples.append({
        "page": page, "label": label, "fractionBox": box,
        "reference": expected, "current": actual,
        "maxChannelDelta": max(abs(a - b) for a, b in zip(expected, actual)),
    })

geometry = []
for before, after, selectors in [
    ("p3-soft-edge-shadow-api-430-v1.json", "p3-ui-colors-visual-430-v1.json",
     [".balance-card", ".balance-card__renew", ".hour-card"]),
    ("p5-ui-colors-visual-430-v1.json", "p5-ui-colors-native-texture-430-v1.json",
     [".profile >>> .action-card"]),
]:
    old, new = nodes(before), nodes(after)
    for selector in selectors:
        delta = {key: new[selector][key] - old[selector][key]
                 for key in ("left", "top", "right", "bottom", "width", "height")}
        geometry.append({"before": before, "after": after, "selector": selector, "delta": delta})

wave = Image.open(ROOT / "frontend/pages/parent/assets/top-wave.png").convert("RGBA")
x_fraction = 0.52
column = round(wave.width * x_fraction)
edge = max(y for y in range(wave.height) if wave.getpixel((column, y))[3] >= 250)
image = current[6]
edge_y = round(edge * image.width / wave.width)
shadow = []
for offset in (5, 10, 20):
    x, y = round(image.width * x_fraction), edge_y + offset
    fraction = y / image.height
    # All probes fall in the first segment of the current vertical gradient.
    t = fraction / 0.48
    unshadowed = tuple(round(a + (b - a) * t) for a, b in zip((225, 171, 32), (241, 201, 88)))
    actual = image.getpixel((x, y))
    shadow.append({
        "pixel": [x, y], "offsetBelowCurve": offset, "current": actual,
        "unshadowedGradientEstimate": unshadowed,
        "channelDarkening": [a - b for a, b in zip(unshadowed, actual)],
    })

receipt = {
    "space": "sRGB",
    "note": "Modal panel samples are local color evidence, not whole-page equality.",
    "samples": samples,
    "geometry": geometry,
    "allComparedAnchorsUnchanged": all(all(v == 0 for v in row["delta"].values()) for row in geometry),
    "curveShadow": shadow,
}
TARGET.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
print(json.dumps(receipt, indent=2))
