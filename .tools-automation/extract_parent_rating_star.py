from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = Image.open(root / ".tools-automation/parent-p6-reference.png").convert("RGBA")
star = source.crop((480, 1068, 554, 1145))
for y in range(star.height):
    for x in range(star.width):
        red, green, blue, alpha = star.getpixel((x, y))
        if green < 165 and blue < 75:
            star.putpixel((x, y), (red, green, blue, 0))
bounds = star.getbbox()
if bounds:
    star = star.crop(bounds)
target = root / "frontend/pages/parent/assets/rating-star.png"
star.save(target, optimize=True)
print(f"{target.name}: {star.width}x{star.height}, {target.stat().st_size} bytes")
