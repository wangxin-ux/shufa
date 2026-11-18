import { SessionServiceError } from '../../../services/session.service';

export type CampaignImageSlot = 'cover' | 'share';
export interface CampaignImage {
  id: string; mimeType: 'image/png' | 'image/jpeg'; sizeBytes: number;
  accessUrl: string; accessUrlExpiresAt: string;
}
export interface CampaignImages {
  draftId: string; version: number; images: { cover: CampaignImage | null; share: CampaignImage | null };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid(): never { throw new SessionServiceError(502, 'INVALID_RESPONSE', '活动图片响应无效，请重试'); }
function exact(value: unknown, fields: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(k => Object.prototype.hasOwnProperty.call(value, k));
}
export function campaignImageSlot(value: unknown): value is CampaignImageSlot {
  return value === 'cover' || value === 'share';
}
export function parseCampaignImages(value: unknown, id: string, base: string): CampaignImages {
  if (!exact(value, ['draftId', 'version', 'images']) || value.draftId !== id ||
    !Number.isInteger(value.version) || Number(value.version) < 1 || Number(value.version) > 2147483647 ||
    !exact(value.images, ['cover', 'share'])) invalid();
  if (!/^https?:\/\/[^/?#@]+(?:\/[^?#]*)?$/.test(base)) invalid();
  const parse = (v: unknown): CampaignImage | null => {
    if (v === null) return null;
    if (!exact(v, ['id', 'mimeType', 'sizeBytes', 'accessUrl', 'accessUrlExpiresAt']) ||
      typeof v.id !== 'string' || !UUID.test(v.id) || !['image/png', 'image/jpeg'].includes(String(v.mimeType)) ||
      !Number.isInteger(v.sizeBytes) || Number(v.sizeBytes) < 1 || Number(v.sizeBytes) > 3145728 ||
      typeof v.accessUrl !== 'string' ||
      !new RegExp(`^/media/partner-campaign-images/${v.id}\\?expires=[0-9]+&signature=[a-f0-9]{64}$`).test(v.accessUrl) ||
      typeof v.accessUrlExpiresAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.accessUrlExpiresAt) ||
      !Number.isFinite(Date.parse(v.accessUrlExpiresAt))) invalid();
    return { ...v, accessUrl: base.replace(/\/+$/, '') + v.accessUrl } as unknown as CampaignImage;
  };
  return { draftId: id, version: Number(value.version), images: { cover: parse(value.images.cover), share: parse(value.images.share) } };
}
