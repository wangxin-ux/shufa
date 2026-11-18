"""Export only the source page glyphs; keep all labels as live WXML text."""
from pathlib import Path
from PIL import Image
from psd_tools import PSDImage

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / '素材/UI更新/教师端/教师端.psd'


def main():
    psd = PSDImage.open(SOURCE)
    for board_left, region, name in (
        (1247, (50, 180, 160, 265), 'profile-mark-pdf.png'),
        (3697, (90, 179, 186, 258), 'page-mark-pdf.png'),
    ):
        board = next(item for item in psd if item.bbox[0] == board_left)
        crop = board.composite().convert('RGB').crop(region)
        mask = Image.new('L', crop.size)
        mask.putdata([255 if r > 180 and 50 < g < 210 and b < 150 and r > g * 1.15 else 0
                      for r, g, b in crop.getdata()])
        box = mask.getbbox()
        if not box:
            raise RuntimeError('Source page glyph was not found')
        glyph = crop.crop((max(0, box[0]-2), max(0, box[1]-2), min(crop.width, box[2]+2), min(crop.height, box[3]+2)))
        for role in ('teacher', 'operator'):
            target = ROOT / 'frontend/pages' / role / 'assets' / name
            glyph.save(target, optimize=True)
            print(f'{role}/{name}: {glyph.width}x{glyph.height}, {target.stat().st_size} bytes')


if __name__ == '__main__':
    main()
