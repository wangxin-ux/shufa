"""Export only the approved P5 background layers, without people or branding."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter
from psd_tools import PSDImage


ROOT = Path(__file__).resolve().parents[2]
PSD = ROOT / (
    "\u7d20\u6750/744d4760802762ec45611935fa516fd9_3359126753859121857_m(1)/"
    "\u5bb6\u957f+\u5408\u4f5c\u65b9/\u5408\u4f5c\u65b9\u7aef/\u5408\u4f5c\u65b9\u7aef.psd"
)
PSD_HASH = "A009715BC119E42AC2C680A994BC4B5A7FFD463D792488419874F3A037C97FFF"
ARTBOARD = (3675, 0, 4800, 2436)
CROP = (3675, 2076, 4800, 2436)
OUTPUT = ROOT / "frontend/pages/partner/assets/campaign-footer.png"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


def cached_layer(layer, viewport):
    image = layer.topil(apply_icc=True)
    if image is None:
        raise RuntimeError(f"Missing cached pixels for layer {layer.layer_id}")
    result = Image.new("RGBA", (viewport[2] - viewport[0], viewport[3] - viewport[1]))
    result.paste(image.convert("RGBA"), (layer.left - viewport[0], layer.top - viewport[1]))
    return result


def export() -> bytes:
    if digest(PSD.read_bytes()) != PSD_HASH:
        raise RuntimeError("The approved partner PSD fingerprint changed")
    psd = PSDImage.open(PSD)
    artboard, = [layer for layer in psd if tuple(layer.bbox) == ARTBOARD]
    background, curve = artboard[0], artboard[1]
    if (background.layer_id, curve.layer_id) != (382, 383):
        raise RuntimeError("Unexpected P5 background layers")
    shadow, = list(curve.effects)
    if type(shadow).__name__ != "DropShadow":
        raise RuntimeError("Unexpected curve effect")
    if (shadow.angle, shadow.distance, shadow.size, shadow.choke, shadow.opacity) != (
        90, 7, 51, 0, 28,
    ):
        raise RuntimeError("The approved curve shadow parameters changed")

    # Pad before blurring so the cropped strip has no artificial edge shadow.
    pad = math.ceil(shadow.size * 3 + shadow.distance)
    viewport = (CROP[0] - pad, CROP[1] - pad, CROP[2] + pad, CROP[3] + pad)
    gold = cached_layer(background, viewport)
    white = cached_layer(curve, viewport)
    mask = ImageChops.offset(white.getchannel("A"), 0, round(shadow.distance))
    # Gaussian blur approximates Photoshop's size; the cached contour is unchanged.
    mask = mask.filter(ImageFilter.GaussianBlur(shadow.size / 3))
    mask = mask.point(lambda value: round(value * shadow.opacity / 100))
    color = tuple(round(float(shadow.color[key])) for key in (b"Rd  ", b"Grn ", b"Bl  "))
    shade = Image.new("RGBA", gold.size, color + (0,))
    shade.putalpha(mask)
    result = Image.alpha_composite(Image.alpha_composite(gold, shade), white)
    result = result.crop((pad, pad, pad + 1125, pad + 360))
    result = result.resize((750, 240), Image.Resampling.LANCZOS).convert("RGB")
    output = BytesIO()
    result.save(output, format="PNG", optimize=True)
    return output.getvalue()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data = export()
    if len(data) > 500 * 1024:
        raise RuntimeError("Footer exceeds the existing per-image budget")
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != data:
            raise RuntimeError("The product footer differs from the pinned export")
    else:
        OUTPUT.write_bytes(data)
    print(json.dumps({
        "sourceSha256": PSD_HASH,
        "layers": [382, 383],
        "cropSourcePixels": CROP,
        "size": [750, 240],
        "sha256": digest(data),
        "bytes": len(data),
        "shadow": "Gaussian approximation; not Photoshop pixel equivalence",
        "verified": args.check,
    }))
