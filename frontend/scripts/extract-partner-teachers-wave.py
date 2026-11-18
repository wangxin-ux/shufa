"""Export the approved P7 cached curve without text, people or layer effects."""

from __future__ import annotations

import argparse
import hashlib
import json
from io import BytesIO
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage


ROOT = Path(__file__).resolve().parents[2]
PSD = ROOT / (
    "\u7d20\u6750/744d4760802762ec45611935fa516fd9_3359126753859121857_m(1)/"
    "\u5bb6\u957f+\u5408\u4f5c\u65b9/\u5408\u4f5c\u65b9\u7aef/\u5408\u4f5c\u65b9\u7aef.psd"
)
PSD_HASH = "A009715BC119E42AC2C680A994BC4B5A7FFD463D792488419874F3A037C97FFF"
CROP = (4900, 0, 6025, 360)
OUTPUT = ROOT / "frontend/pages/partner/assets/teachers-top-wave.png"


def export() -> bytes:
    if hashlib.sha256(PSD.read_bytes()).hexdigest().upper() != PSD_HASH:
        raise RuntimeError("The approved partner PSD fingerprint changed")
    psd = PSDImage.open(PSD)
    artboard, = [layer for layer in psd if tuple(layer.bbox) == (4900, 0, 6025, 2436)]
    curve, = [layer for layer in artboard[0] if layer.layer_id == 742]
    shadow, = list(curve.effects)
    if (type(shadow).__name__, shadow.angle, shadow.distance, shadow.size,
            shadow.choke, shadow.opacity, shadow.blend_mode) != (
        "DropShadow", 90, 7, 51, 0, 28, b"Mltp",
    ):
        raise RuntimeError("The approved P7 curve effect changed")
    cached = curve.topil(apply_icc=True)
    if cached is None:
        raise RuntimeError("P7 curve cached pixels missing")
    image = Image.new("RGBA", (1125, 360))
    image.paste(cached.convert("RGBA"), (curve.left - CROP[0], curve.top - CROP[1]))
    image = image.resize((750, 240), Image.Resampling.LANCZOS)
    output = BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data = export()
    if len(data) > 500 * 1024:
        raise RuntimeError("P7 curve exceeds the existing per-image budget")
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != data:
            raise RuntimeError("The product P7 curve differs from the pinned export")
    else:
        OUTPUT.write_bytes(data)
    print(json.dumps({
        "sourceSha256": PSD_HASH, "layer": 742, "cropSourcePixels": CROP,
        "size": [750, 240], "sha256": hashlib.sha256(data).hexdigest().upper(),
        "bytes": len(data), "effectsBaked": False, "verified": args.check,
    }))
