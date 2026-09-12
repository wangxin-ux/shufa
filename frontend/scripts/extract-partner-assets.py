from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageFilter
from psd_tools import PSDImage


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SHARED_OUTPUT_DIR = PROJECT_ROOT / "frontend" / "assets" / "partner"
PACKAGE_OUTPUT_DIR = PROJECT_ROOT / "frontend" / "pages" / "partner" / "assets"
PSD_SIZE_BYTES = 46_200_283
PSD_SHA256 = "5CEB0A380745BDFFF75776FBE6037005A942C3DCC2BE3041D712E128166B1FD7"
MAX_PNG_BYTES = 500 * 1024
HOME_BBOX = (0, 0, 1125, 2436)
LESSON_ACCOUNT_BBOX = (1225, 0, 2350, 2436)
PROFILE_BBOX = (3675, 0, 4800, 2436)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def locate_psd() -> Path:
    matches = [
        path
        for path in PROJECT_ROOT.rglob("*.psd")
        if path.stat().st_size == PSD_SIZE_BYTES and sha256(path) == PSD_SHA256
    ]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one pinned partner PSD, found {len(matches)}")
    return matches[0]


def select_artboard(psd: PSDImage, bbox: tuple[int, int, int, int]):
    matches = [layer for layer in psd if tuple(layer.bbox) == bbox]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one artboard at {bbox}, found {len(matches)}")
    return matches[0]


def select_layer(
    layers: Iterable,
    name: str,
    bbox: tuple[int, int, int, int],
):
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
        if intersection[0] >= intersection[2] or intersection[1] >= intersection[3]:
            raise RuntimeError(f"Layer {layer.name!r} is outside its artboard")
        image = image.crop(
            (
                intersection[0] - left,
                intersection[1] - top,
                intersection[2] - left,
                intersection[3] - top,
            )
        )
    alpha_bounds = image.getchannel("A").getbbox()
    if alpha_bounds is None:
        raise RuntimeError(f"Layer {layer.name!r} is fully transparent")
    return image.crop(alpha_bounds)


def crop_global(layer, bbox: tuple[int, int, int, int]) -> Image.Image:
    image = layer.topil()
    if image is None:
        raise RuntimeError(f"Layer {layer.name!r} has no pixel data")
    left, top, right, bottom = tuple(layer.bbox)
    crop_left, crop_top, crop_right, crop_bottom = bbox
    if crop_left < left or crop_top < top or crop_right > right or crop_bottom > bottom:
        raise RuntimeError(f"Crop {bbox} exceeds layer {layer.name!r} bounds")
    return image.convert("RGBA").crop(
        (crop_left - left, crop_top - top, crop_right - left, crop_bottom - top)
    )


def save_budgeted_png(
    image: Image.Image,
    target: Path,
    max_width: int,
    force_palette: bool = False,
) -> None:
    if image.width > max_width:
        height = round(image.height * max_width / image.width)
        image = image.resize((max_width, height), Image.Resampling.LANCZOS)
    if force_palette:
        image.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(
            target,
            optimize=True,
            compress_level=9,
        )
    else:
        image.save(target, optimize=True, compress_level=9)
    if target.stat().st_size > MAX_PNG_BYTES:
        image.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(
            target,
            optimize=True,
            compress_level=9,
        )
    if target.stat().st_size > MAX_PNG_BYTES:
        raise RuntimeError(f"{target.name} exceeds 500 KB after optimization")


def build_mark_glyph(image: Image.Image) -> Image.Image:
    source = image.convert("RGBA")
    glyph = Image.new("RGBA", source.size)
    pixels = []
    for red, green, blue, _alpha in source.getdata():
        saturation = max(red, green, blue) - min(red, green, blue)
        alpha = min(255, round(saturation * 255 / 160))
        pixels.append((255, 116, 71, alpha))
    glyph.putdata(pixels)
    alpha_bounds = glyph.getchannel("A").getbbox()
    if alpha_bounds is None:
        raise RuntimeError("Page mark glyph is fully transparent")
    return glyph.crop(alpha_bounds)


def main() -> None:
    psd = PSDImage.open(locate_psd())
    home = select_artboard(psd, HOME_BBOX)
    layers = list(home.descendants())
    SHARED_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PACKAGE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    independent_logos = [
        layer for layer in layers if layer.name.strip().casefold() == "logo"
    ]
    if not independent_logos:
        raise RuntimeError("Expected the independent logo group to be present and excluded")

    character = select_layer(layers, "图层 20", (140, 800, 1309, 2512))
    save_budgeted_png(
        composite_layer(character, clip_bbox=HOME_BBOX),
        PACKAGE_OUTPUT_DIR / "home-character.png",
        720,
    )

    character_copy = select_layer(
        layers,
        "图层 20 拷贝",
        (94, 757, 1355, 2512),
    )
    stat_glass = crop_global(character_copy, (94, 1686, 1050, 1951))
    stat_glass = stat_glass.filter(ImageFilter.GaussianBlur(radius=16))
    save_budgeted_png(stat_glass, SHARED_OUTPUT_DIR / "home-stat-glass.png", 654)

    home_mark_source = select_layer(
        layers,
        "首 页                          进货                       订单       11",
        (-57, 172, 1068, 406),
    )
    home_mark = crop_global(home_mark_source, (37, 179, 174, 316))
    save_budgeted_png(home_mark, PACKAGE_OUTPUT_DIR / "home-mark.png", 137)
    save_budgeted_png(
        build_mark_glyph(home_mark),
        PACKAGE_OUTPUT_DIR / "home-mark-glyph.png",
        64,
    )

    exports = [
        ("icon-warnings.png", "讨论", (120, 2098, 174, 2138), 108),
        ("icon-attendance.png", "练习", (235, 2091, 283, 2145), 108),
        ("icon-teachers.png", "男同学", (353, 2091, 396, 2144), 108),
        ("icon-students.png", "课堂", (478, 2072, 559, 2157), 162),
    ]
    for filename, name, bbox, max_width in exports:
        save_budgeted_png(
            composite_layer(select_layer(layers, name, bbox)),
            PACKAGE_OUTPUT_DIR / filename,
            max_width,
        )

    lesson_account = select_artboard(psd, LESSON_ACCOUNT_BBOX)
    lesson_account_layers = list(lesson_account.descendants())
    save_budgeted_png(
        composite_layer(
            select_layer(
                lesson_account_layers,
                "图层 23",
                (1621, 298, 2272, 1074),
            ),
            clip_bbox=LESSON_ACCOUNT_BBOX,
        ),
        PACKAGE_OUTPUT_DIR / "lesson-account-top-character.png",
        520,
        force_palette=True,
    )
    save_budgeted_png(
        composite_layer(
            select_layer(
                lesson_account_layers,
                "图层 13 拷贝 3",
                (1234, 1510, 2025, 2444),
            ),
            clip_bbox=LESSON_ACCOUNT_BBOX,
        ),
        PACKAGE_OUTPUT_DIR / "lesson-account-lower-character.png",
        500,
        force_palette=True,
    )
    lesson_account_mark_source = select_layer(
        lesson_account_layers,
        "首 页                          进货                       订单       11 拷贝",
        (900, 172, 2025, 406),
    )
    lesson_account_mark = crop_global(
        lesson_account_mark_source,
        (1262, 179, 1399, 316),
    )
    save_budgeted_png(
        lesson_account_mark,
        PACKAGE_OUTPUT_DIR / "lesson-account-mark.png",
        137,
    )
    save_budgeted_png(
        build_mark_glyph(lesson_account_mark),
        PACKAGE_OUTPUT_DIR / "lesson-account-mark-glyph.png",
        64,
    )

    profile = select_artboard(psd, PROFILE_BBOX)
    profile_layers = list(profile.descendants())
    save_budgeted_png(
        composite_layer(
            select_layer(profile_layers, "图层 14", (4107, 220, 4875, 1087)),
            clip_bbox=PROFILE_BBOX,
        ),
        PACKAGE_OUTPUT_DIR / "profile-top-character.png",
        480,
        force_palette=True,
    )
    save_budgeted_png(
        composite_layer(
            select_layer(profile_layers, "图层 25", (3615, 1532, 4394, 2490)),
        ),
        PACKAGE_OUTPUT_DIR / "profile-lower-character.png",
        500,
        force_palette=True,
    )
    profile_mark_source = select_layer(
        profile_layers,
        "首 页                          进货                       订单       11 拷贝 3",
        (2797, 172, 3922, 406),
    )
    profile_mark = crop_global(profile_mark_source, (3709, 179, 3846, 316))
    save_budgeted_png(
        profile_mark,
        PACKAGE_OUTPUT_DIR / "profile-mark.png",
        137,
    )
    save_budgeted_png(
        build_mark_glyph(profile_mark),
        PACKAGE_OUTPUT_DIR / "profile-mark-glyph.png",
        64,
    )

    for target in sorted([
        *SHARED_OUTPUT_DIR.glob("*.png"),
        *PACKAGE_OUTPUT_DIR.glob("*.png"),
    ]):
        with Image.open(target) as result:
            print(
                f"{target.name}: {result.width}x{result.height}, "
                f"{target.stat().st_size / 1024:.1f} KB, "
                f"SHA256 {sha256(target)}"
            )


if __name__ == "__main__":
    main()
