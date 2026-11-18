"""Compare the five annotated details without replacing original evidence."""
import json
from collections import Counter
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageCms, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/verification/parent-ui-alignment-2026-10-07"
IMAGE = OUT / "five-details-before-after-430-v1.png"
RECEIPT = OUT / "five-details-audit-430-v1.json"
if IMAGE.exists() or RECEIPT.exists():
    raise SystemExit("Evidence exists; choose a new version.")


def srgb(name):
    image = Image.open(OUT / name)
    profile = image.info.get("icc_profile")
    if profile:
        return ImageCms.profileToProfile(
            image, ImageCms.ImageCmsProfile(BytesIO(profile)),
            ImageCms.createProfile("sRGB"), outputMode="RGB",
        )
    return image.convert("RGB")


def nodes(stem):
    receipt = json.loads((OUT / f"{stem}.json").read_text(encoding="utf-8-sig"))
    return dict(zip(receipt["selectors"], receipt["nodeResults"]["result"]["result"]))


def delta(old, new):
    return {key: round(new[key] - old[key], 5)
            for key in ("left", "top", "right", "bottom", "width", "height")}


before = {
    2: "p2-five-details-before-430-v1",
    3: "p3-ui-colors-visual-430-v1",
    4: "p4-ui-colors-visual-430-v1",
    5: "p5-ui-colors-native-texture-430-v1",
    6: "p6-ui-colors-visual-430-v1",
}
old = {page: srgb(f"{stem}.png") for page, stem in before.items()}
new = {page: srgb(f"p{page}-five-details-after-430-v1.png") for page in before}
old_nodes = {page: nodes(stem) for page, stem in before.items()}
new_nodes = {page: nodes(f"p{page}-five-details-after-430-v1") for page in before}

geometry = [
    {"page": page, "selector": selector,
     "delta": delta(old_nodes[page][selector], new_nodes[page][selector])}
    for page, selectors in (
        (2, (".catalog", ".catalog__offers")),
        (3, (".balance-card", ".balance-card__renew", ".hour-card")),
    )
    for selector in selectors
]
geometry.append({
    "page": 5, "selector": "menu inner surface",
    "delta": delta(old_nodes[5][".profile >>> .action-card"],
                   new_nodes[5][".profile__menu-surface"]),
})


def crop_device(image, box):
    return image.crop(tuple(round(value * scale) for value, scale in zip(
        box, (image.width / 430, image.height / 932) * 2,
    )))


def modal(image, box):
    return Counter(crop_device(image, box).get_flattened_data()).most_common(1)[0][0]


def shadow_probe(page, selector):
    result = []
    for label, image, measurements in (
        ("before", old[page], old_nodes[page]),
        ("after", new[page], new_nodes[page]),
    ):
        edge = measurements[selector]["bottom"]
        result.append({
            "version": label,
            "samples": [
                {"pxBelowEdge": offset,
                 "rgb": modal(image, (90, edge + offset, 180, edge + offset + 1))}
                for offset in (2, 4, 8)
            ],
        })
    return result


panels = [
    (2, "P2: bottom seam / button shadow",
     (0, 760, 430, 932), (0, 760, 430, 932)),
    (3, "P3: translucent white",
     (42, 344, 182, 400), (42, 344, 182, 400)),
    (4, "P4: centered bold arrows",
     (346, 244, 380, 365), (346, 244, 380, 365)),
    (5, "P5: menu yellow",
     (30, 443, 404, 722), (30, 443, 404, 722)),
    (6, "P6: photo and lesson entry",
     (27, 132, 403, 365), (27, 132, 403, 365)),
]
for selector, label in (
    (".growth-feedback", "P6: feedback lower shadow"),
    (".growth-review", "P6: review lower shadow"),
):
    edges = [measurements[6][selector]["bottom"]
             for measurements in (old_nodes, new_nodes)]
    panels.append((6, label,
                   (27, edges[0] - 18, 403, edges[0] + 10),
                   (27, edges[1] - 18, 403, edges[1] + 10)))

height = 360
sheet = Image.new("RGB", (980, height * len(panels)), "white")
draw = ImageDraw.Draw(sheet)
for index, (page, title, old_box, new_box) in enumerate(panels):
    y = index * height
    draw.text((12, y + 8), title, fill="black")
    for x, label, image, box in (
        (12, "Before", old[page], old_box),
        (502, "After", new[page], new_box),
    ):
        draw.text((x, y + 28), label, fill="black")
        detail = crop_device(image, box)
        ratio = min(466 / detail.width, 298 / detail.height)
        detail = detail.resize(
            (round(detail.width * ratio), round(detail.height * ratio)),
            Image.Resampling.LANCZOS,
        )
        sheet.paste(detail, (x, y + 50))
sheet.save(IMAGE)

receipt = {
    "space": "sRGB",
    "note": "Local details and layout deltas only, not whole-page equality.",
    "unchangedGeometry": geometry,
    "allComparedGeometryUnchanged": all(
        not any(item["delta"].values()) for item in geometry
    ),
    "catalogMascotDelta": delta(
        old_nodes[2][".catalog__mascot"], new_nodes[2][".catalog__mascot"],
    ),
    "catalogMascotAfterBottom": new_nodes[2][".catalog__mascot"]["bottom"],
    "whiteTextColors": {
        selector: new_nodes[3][selector]["color"]
        for selector in (".balance-card__label", ".balance-card__meta-label",
                         ".balance-card__meta-value")
    },
    "menuInteriorModal": {
        label: modal(image, (48, 450, 380, 710))
        for label, image in (("before", old[5]), ("after", new[5]))
    },
    "lowerShadows": {
        label: shadow_probe(page, selector)
        for page, selector, label in (
            (2, ".catalog__offers", "catalog button"),
            (6, ".growth-feedback", "growth feedback"),
            (6, ".growth-review", "growth review"),
        )
    },
}
RECEIPT.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
print(json.dumps(receipt, indent=2))
