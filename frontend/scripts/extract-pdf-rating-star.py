"""Export one complete approved PSD star without redrawing its texture."""
from pathlib import Path
from psd_tools import PSDImage

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / '素材/UI更新/教师端/教师端.psd'


def main():
    psd = PSDImage.open(SOURCE)
    board = next(layer for layer in psd if tuple(layer.bbox) == (2472, 0, 3597, 2436))
    candidates = [layer for layer in board.descendants()
                  if tuple(layer.bbox) == (2957, 1154, 3053, 1245) and layer.kind == 'pixel']
    if len(candidates) != 1:
        raise RuntimeError('Expected exactly one full rating star from the approved detail board')
    star = candidates[0].composite().convert('RGBA')
    for role in ('teacher', 'operator'):
        target = ROOT / 'frontend/pages' / role / 'assets/rating-star.png'
        star.save(target, optimize=True)
        print(f'{role}: {star.width}x{star.height}, {target.stat().st_size} bytes')


if __name__ == '__main__':
    main()
