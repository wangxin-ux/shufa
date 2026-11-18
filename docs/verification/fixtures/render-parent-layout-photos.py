from pathlib import Path

from PIL import Image, ImageDraw


out = Path(__file__).resolve().parents[1] / "parent-ui-alignment-2026-10-07"
out.mkdir(parents=True, exist_ok=True)


def render(name, size):
    image = Image.new("RGB", size, "#f6d468")
    draw = ImageDraw.Draw(image)
    w, h = size
    draw.rectangle((0, 0, w // 2, h // 2), fill="#fe8319")
    draw.rectangle((w // 2, h // 2, w, h), fill="#2c4240")
    draw.line((0, 0, w - 1, h - 1), fill="#ffffff", width=8)
    draw.text((16, 16), "SYNTHETIC LAYOUT ONLY", fill="#000000")
    target = out / name
    if target.exists():
        raise SystemExit(f"Evidence file exists; use a new filename: {target}")
    image.save(target)


render("student-synthetic.png", (900, 420))
render("classroom-synthetic.png", (420, 600))
