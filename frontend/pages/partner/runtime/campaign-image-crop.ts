import type { CampaignImageSlot } from './campaign-image';

export const cropTarget = (slot: CampaignImageSlot) => slot === 'cover'
  ? { width: 750, height: 1125 } : { width: 800, height: 600 };
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
export function cropRectangle(width: number, height: number, slot: CampaignImageSlot, zoom: number, x: number, y: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
    width * height > 16000000 || width > 16384 || height > 16384) throw new Error('Invalid image dimensions');
  const target = cropTarget(slot);
  const ratio = target.width / target.height;
  const cropHeight = Math.min(height, width / ratio) / clamp(zoom, 1, 4);
  const cropWidth = cropHeight * ratio;
  return { x: Math.max(0, width - cropWidth) * clamp(x, 0, 1),
    y: Math.max(0, height - cropHeight) * clamp(y, 0, 1), width: cropWidth, height: cropHeight };
}
export function moveCrop(width: number, height: number, rectangle: ReturnType<typeof cropRectangle>,
  viewWidth: number, x: number, y: number, dx: number, dy: number) {
  const scale = rectangle.width / viewWidth;
  return {
    x: width - rectangle.width > .001 ? clamp(x - dx * scale / (width - rectangle.width), 0, 1) : .5,
    y: height - rectangle.height > .001 ? clamp(y - dy * scale / (height - rectangle.height), 0, 1) : .5,
  };
}
