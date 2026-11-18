"""Export the complete account mascot from the approved six-artboard PSD."""
from pathlib import Path
from PIL import Image
from psd_tools import PSDImage

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / '素材/UI更新/教师端/教师端.psd'
TARGET = ROOT / 'frontend/pages/teacher/assets/account-mascot.png'


def main():
    psd = PSDImage.open(SOURCE)
    boards = [layer for layer in psd if tuple(layer.bbox) == (3697, 0, 4822, 2436)]
    if len(boards) != 1:
        raise RuntimeError('Expected the approved teacher account artboard')
    matches = [layer for layer in boards[0].descendants()
               if layer.name == '图层 25' and tuple(layer.bbox) == (4093, 298, 4744, 1074)]
    if len(matches) != 1:
        raise RuntimeError('Expected one complete account character layer')
    image = matches[0].composite().convert('RGBA')
    image.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(TARGET, optimize=True)
    if TARGET.stat().st_size > 160 * 1024:
        raise RuntimeError('Account character exceeds its allocated 160 KB')
    print(f'{TARGET.name}: {image.width}x{image.height}, {TARGET.stat().st_size} bytes')


if __name__ == '__main__':
    main()
