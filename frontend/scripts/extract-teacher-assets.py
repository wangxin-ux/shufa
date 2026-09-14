from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image, ImageFilter
from psd_tools import PSDImage


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SHARED_OUTPUT_DIR = PROJECT_ROOT / "frontend" / "assets" / "teacher"
PACKAGE_OUTPUT_DIR = PROJECT_ROOT / "frontend" / "pages" / "teacher" / "assets"
PSD_SIZE_BYTES = 43_365_609
MAX_PNG_BYTES = 500 * 1024


def locate_psd() -> Path:
    matches = [
        path
        for path in PROJECT_ROOT.rglob("*.psd")
        if path.stat().st_size == PSD_SIZE_BYTES
    ]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one teacher PSD, found {len(matches)}")
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
            raise RuntimeError(f"Layer {layer.name!r} is outside its teacher artboard")
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


def save_budgeted_png(image: Image.Image, target: Path, max_width: int) -> None:
    if image.width > max_width:
        height = round(image.height * max_width / image.width)
        image = image.resize((max_width, height), Image.Resampling.LANCZOS)
    image.save(target, optimize=True, compress_level=9)
    if target.stat().st_size > MAX_PNG_BYTES:
        image.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(
            target,
            optimize=True,
            compress_level=9,
        )
    if target.stat().st_size > MAX_PNG_BYTES:
        raise RuntimeError(f"{target.name} exceeds 500 KB after optimization")


def build_home_stat_glass(source: Path, target: Path) -> None:
    with Image.open(source) as mascot:
        mascot = mascot.convert("RGBA")
        glass = mascot.crop((-38, 555, 644, 739))
        glass = glass.filter(ImageFilter.GaussianBlur(radius=18))
        glass = glass.resize((654, 176), Image.Resampling.LANCZOS)
        alpha = glass.getchannel("A").point(lambda value: round(value * 0.78))
        glass.putalpha(alpha)
        save_budgeted_png(glass, target, 654)


def main() -> None:
    psd = PSDImage.open(locate_psd())
    home = select_artboard(psd, (0, 0, 1125, 2436))
    profile = select_artboard(psd, (3675, 0, 4800, 2436))
    SHARED_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PACKAGE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    exports = [
        (
            "home-mascot.png",
            select_layer(home.descendants(), "\u56fe\u5c42 17", (147, 831, 1414, 2812)),
            (0, 0, 1125, 2436),
            None,
            720,
        ),
        (
            "profile-card-mascot.png",
            select_layer(profile.descendants(), "\u56fe\u5c42 14", (4107, 220, 4875, 1087)),
            (3675, 0, 4800, 2436),
            None,
            620,
        ),
        (
            "profile-footer-mascot.png",
            select_layer(
                profile.descendants(),
                "\u56fe\u5c42 13 \u62f7\u8d1d 2",
                (3576, 1320, 4535, 2452),
            ),
            (3675, 0, 4800, 2436),
            None,
            620,
        ),
        (
            "icon-student-record.png",
            select_layer(home.descendants(), "\u8ba8\u8bba", (120, 2098, 174, 2138)),
            None,
            None,
            108,
        ),
        (
            "icon-confirm.png",
            select_layer(home.descendants(), "\u7ec3\u4e60", (235, 2091, 283, 2145)),
            None,
            None,
            108,
        ),
        (
            "icon-students.png",
            select_layer(home.descendants(), "\u7537\u540c\u5b66", (353, 2091, 396, 2144)),
            None,
            None,
            108,
        ),
        (
            "icon-schedule.png",
            select_layer(home.descendants(), "\u8bfe\u5802", (478, 2072, 559, 2157)),
            None,
            None,
            162,
        ),
    ]

    for filename, layer, clip_bbox, content_crop, max_width in exports:
        target_dir = SHARED_OUTPUT_DIR if filename == "home-mascot.png" else PACKAGE_OUTPUT_DIR
        target = target_dir / filename
        image = composite_layer(layer, clip_bbox=clip_bbox)
        if content_crop is not None:
            image = image.crop(content_crop)
        save_budgeted_png(
            image,
            target,
            max_width,
        )
        with Image.open(target) as result:
            print(
                f"{filename}: {result.width}x{result.height}, "
                f"{target.stat().st_size / 1024:.1f} KB"
            )

    stat_glass = SHARED_OUTPUT_DIR / "home-stat-glass.png"
    build_home_stat_glass(SHARED_OUTPUT_DIR / "home-mascot.png", stat_glass)
    with Image.open(stat_glass) as result:
        print(
            f"{stat_glass.name}: {result.width}x{result.height}, "
            f"{stat_glass.stat().st_size / 1024:.1f} KB"
        )


if __name__ == "__main__":
    main()
