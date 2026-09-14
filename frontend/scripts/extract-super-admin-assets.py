from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image
from psd_tools import PSDImage


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SHARED_OUTPUT_DIR = PROJECT_ROOT / "frontend" / "assets" / "super-admin"
PACKAGE_OUTPUT_DIR = PROJECT_ROOT / "frontend" / "pages" / "super-admin" / "assets"
PSD_SIZE_BYTES = 50_258_135
MAX_PNG_BYTES = 500 * 1024
HOME_BBOX = (0, 0, 1125, 2436)
LEDGER_BBOX = (1225, 0, 2350, 2436)
PROFILE_BBOX = (3675, 0, 4800, 2436)


def locate_psd() -> Path:
    matches = [
        path
        for path in PROJECT_ROOT.rglob("*.psd")
        if path.stat().st_size == PSD_SIZE_BYTES
    ]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one super admin PSD, found {len(matches)}")
    return matches[0]


def select_layer(layers: Iterable, name: str, bbox: tuple[int, int, int, int]):
    matches = [
        layer
        for layer in layers
        if layer.name == name and tuple(layer.bbox) == bbox
    ]
    if len(matches) != 1:
        raise RuntimeError(
            f"Expected one layer {name!r} at {bbox}, found {len(matches)}"
        )
    return matches[0]


def composite_layer(layer, clip_bbox: tuple[int, int, int, int] | None = None):
    image = layer.composite()
    if image is None:
        raise RuntimeError(f"Layer {layer.name!r} did not render")
    image = image.convert("RGBA")
    if clip_bbox is not None:
        left, top, right, bottom = tuple(layer.bbox)
        clip_left, clip_top, clip_right, clip_bottom = clip_bbox
        intersection = (
            max(left, clip_left),
            max(top, clip_top),
            min(right, clip_right),
            min(bottom, clip_bottom),
        )
        image = image.crop(
            (
                intersection[0] - left,
                intersection[1] - top,
                intersection[2] - left,
                intersection[3] - top,
            )
        )
    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise RuntimeError(f"Layer {layer.name!r} is fully transparent")
    return image.crop(bounds)


def save_png(image: Image.Image, target: Path, max_width: int) -> None:
    if image.width > max_width:
        height = round(image.height * max_width / image.width)
        image = image.resize((max_width, height), Image.Resampling.LANCZOS)
    image.save(target, optimize=True, compress_level=9)
    if target.stat().st_size > MAX_PNG_BYTES:
        image.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(
            target, optimize=True, compress_level=9
        )
    if target.stat().st_size > MAX_PNG_BYTES:
        raise RuntimeError(f"{target.name} exceeds 500 KB")


def extract_mark_glyph(mark: Image.Image) -> Image.Image:
    cutoff = round(mark.height * 0.58)
    glyph = Image.new("RGBA", mark.size)
    source_pixels = mark.load()
    glyph_pixels = glyph.load()
    for y in range(cutoff):
        for x in range(mark.width):
            red, green, blue, alpha = source_pixels[x, y]
            if max(red, green, blue) - min(red, green, blue) > 22:
                glyph_pixels[x, y] = (red, green, blue, alpha)
    bounds = glyph.getchannel("A").getbbox()
    if bounds is None:
        raise RuntimeError("Page mark glyph extraction produced no visible pixels")
    return glyph.crop(bounds)


def main() -> None:
    psd = PSDImage.open(locate_psd())
    matches = [layer for layer in psd if tuple(layer.bbox) == HOME_BBOX]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one home artboard, found {len(matches)}")
    layers = list(matches[0].descendants())
    if not any(layer.name == "logo" for layer in layers):
        raise RuntimeError("Expected the excluded logo group in the source PSD")
    SHARED_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PACKAGE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    character = select_layer(layers, "图层 26", (143, 828, 1331, 2664))
    save_png(composite_layer(character, HOME_BBOX), PACKAGE_OUTPUT_DIR / "home-character.png", 760)

    stat_glass = composite_layer(
        select_layer(layers, "矩形 3", (72, 1686, 1050, 1951))
    )
    save_png(stat_glass, SHARED_OUTPUT_DIR / "home-stat-glass.png", 654)

    mark = select_layer(layers, "下部按钮", (37, 179, 174, 316))
    mark_image = composite_layer(mark)
    save_png(mark_image, PACKAGE_OUTPUT_DIR / "home-mark.png", 137)
    save_png(
        extract_mark_glyph(mark_image),
        PACKAGE_OUTPUT_DIR / "home-mark-glyph.png",
        80,
    )

    exports = [
        ("icon-campuses.png", "讨论", (120, 2098, 174, 2138), 108),
        ("icon-ledger.png", "练习", (235, 2091, 283, 2145), 108),
        ("icon-brand.png", "男同学", (353, 2091, 396, 2144), 108),
        ("icon-dashboard.png", "课堂", (478, 2072, 559, 2157), 162),
    ]
    for filename, name, bbox, max_width in exports:
        save_png(
            composite_layer(select_layer(layers, name, bbox)),
            PACKAGE_OUTPUT_DIR / filename,
            max_width,
        )

    ledger_matches = [layer for layer in psd if tuple(layer.bbox) == LEDGER_BBOX]
    profile_matches = [layer for layer in psd if tuple(layer.bbox) == PROFILE_BBOX]
    if len(ledger_matches) != 1 or len(profile_matches) != 1:
        raise RuntimeError("Expected one ledger and one profile artboard")
    ledger_layers = list(ledger_matches[0].descendants())
    profile_layers = list(profile_matches[0].descendants())
    if not any(layer.name == "logo" for layer in ledger_layers + profile_layers):
        raise RuntimeError("Expected excluded logo groups on derived artboards")

    save_png(
        composite_layer(
            select_layer(ledger_layers, "图层 23", (1621, 298, 2272, 1074)),
            LEDGER_BBOX,
        ),
        PACKAGE_OUTPUT_DIR / "ledger-top-character.png",
        520,
    )
    save_png(
        composite_layer(
            select_layer(ledger_layers, "图层 13 拷贝 3", (1234, 1510, 2025, 2444)),
            LEDGER_BBOX,
        ),
        PACKAGE_OUTPUT_DIR / "ledger-flow-character.png",
        600,
    )
    ledger_mark = composite_layer(
        select_layer(ledger_layers, "下部按钮", (1262, 179, 1399, 316))
    )
    save_png(
        extract_mark_glyph(ledger_mark),
        PACKAGE_OUTPUT_DIR / "ledger-mark-glyph.png",
        80,
    )
    save_png(
        composite_layer(
            select_layer(profile_layers, "图层 25 拷贝", (3980, 242, 4709, 1075)),
            PROFILE_BBOX,
        ),
        PACKAGE_OUTPUT_DIR / "profile-top-character.png",
        560,
    )
    save_png(
        composite_layer(
            select_layer(profile_layers, "图层 27 拷贝", (3632, 1373, 4470, 2686)),
            PROFILE_BBOX,
        ),
        PACKAGE_OUTPUT_DIR / "profile-lower-character.png",
        620,
    )
    profile_mark = composite_layer(
        select_layer(profile_layers, "下部按钮", (3709, 179, 3846, 316))
    )
    save_png(
        extract_mark_glyph(profile_mark),
        PACKAGE_OUTPUT_DIR / "profile-mark-glyph.png",
        80,
    )

    for target in sorted([
        *SHARED_OUTPUT_DIR.glob("*.png"),
        *PACKAGE_OUTPUT_DIR.glob("*.png"),
    ]):
        with Image.open(target) as result:
            print(
                f"{target.name}: {result.width}x{result.height}, "
                f"{target.stat().st_size / 1024:.1f} KB"
            )


if __name__ == "__main__":
    main()
