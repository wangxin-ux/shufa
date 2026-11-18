"""Extract the PDF's isolated application artwork without repainting it."""

from collections import deque
import hashlib
from pathlib import Path

from PIL import Image
import pypdfium2 as pdfium


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "素材" / "UI更新家长+合作方.pdf"
OUTPUT = ROOT / "frontend" / "pages" / "partner" / "assets" / "icon-application.png"
EXPECTED_SHA = "ca0a978c5edb8bbcd3c0141e128ef951ebe3e2e9c58beaaa937cd37d34cc786d"
# Physical page 16, coordinates in the original 3507 x 2480 embedded image.
CROP = (811, 1721, 982, 1892)


def remove_exterior_white(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    pixels = image.load()
    width, height = image.size
    queue = deque(
        [(x, y) for x in range(width) for y in (0, height - 1)]
        + [(x, y) for y in range(height) for x in (0, width - 1)]
    )
    visited = set()
    while queue:
        x, y = queue.popleft()
        if (x, y) in visited:
            continue
        visited.add((x, y))
        red, green, blue, _alpha = pixels[x, y]
        if min(red, green, blue) < 248:
            continue
        pixels[x, y] = (red, green, blue, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                queue.append((nx, ny))
    return image


def main() -> None:
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != EXPECTED_SHA:
        raise RuntimeError("Reference PDF changed; remeasure the artwork before export")
    with pdfium.PdfDocument(SOURCE) as document:
        page = document[15]
        objects = list(page.get_objects())
        if len(objects) != 1 or objects[0].type != 3:
            raise RuntimeError("Expected the pinned P8 image-only reference")
        if objects[0].get_px_size() != (3507, 2480):
            raise RuntimeError("Unexpected source image dimensions")
        bitmap = objects[0].get_bitmap()
        try:
            image = bitmap.to_pil().convert("RGB").crop(CROP)
        finally:
            bitmap.close()
        page.close()
    result = remove_exterior_white(image)
    bounds = result.getchannel("A").getbbox()
    if bounds is None:
        raise RuntimeError("Application artwork is empty")
    result = result.crop(bounds)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    result.save(OUTPUT, optimize=True)
    print(f"{OUTPUT.name}: {result.width}x{result.height}, {OUTPUT.stat().st_size} bytes")
    print(f"SHA256 {hashlib.sha256(OUTPUT.read_bytes()).hexdigest().upper()}")


if __name__ == "__main__":
    main()
