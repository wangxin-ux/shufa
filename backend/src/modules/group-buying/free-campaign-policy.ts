import type {
  Campaign,
  CampaignRegistration,
  CampaignVersion,
  PartnerCampaignDraft,
  StoredFile,
} from '@prisma/client';
import type { StoredFileService } from '../file/stored-file.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { FreeSettingsDto } from './dto/free-campaign.dto';
import type { GroupPageQueryDto } from './dto/group-buying.dto';

export const MAX_VERSION = 2_147_483_647;
export function notFound(): never {
  throw new DomainError(ErrorCode.RESOURCE_NOT_FOUND, '活动或记录不存在', 404);
}
export function versionConflict(): never {
  throw new DomainError(
    ErrorCode.FREE_CAMPAIGN_VERSION_CONFLICT,
    '活动版本或状态已更新，请重新读取',
    409,
  );
}
export function unavailable(): never {
  throw new DomainError(
    ErrorCode.FREE_CAMPAIGN_NOT_AVAILABLE,
    '当前活动不能报名或发布',
    409,
  );
}
export function invalid(): never {
  throw new DomainError(
    ErrorCode.VALIDATION_FAILED,
    '活动配置不完整或格式不符合要求',
    400,
  );
}
export function reasonText(value: string): string {
  const text = value.trim();
  if (
    !text ||
    Array.from(text).length > 1000 ||
    text.includes('\u0000') ||
    /[\ud800-\udfff]/u.test(text)
  )
    invalid();
  return text;
}
export function normalizeSettings(input: FreeSettingsDto) {
  const startsAt = input.startsAt === null ? null : new Date(input.startsAt);
  const endsAt = input.endsAt === null ? null : new Date(input.endsAt);
  if (
    (startsAt && !Number.isFinite(startsAt.getTime())) ||
    (endsAt && !Number.isFinite(endsAt.getTime())) ||
    (startsAt && endsAt && endsAt <= startsAt) ||
    (input.capacityMode === 'UNLIMITED' && input.maxRegistrations !== null)
  )
    invalid();
  return {
    freeStartsAt: startsAt,
    freeEndsAt: endsAt,
    freeCapacityMode: input.capacityMode,
    freeMaxRegistrations: input.maxRegistrations,
  };
}
export function settings(draft: PartnerCampaignDraft) {
  return {
    startsAt: draft.freeStartsAt?.toISOString() ?? null,
    endsAt: draft.freeEndsAt?.toISOString() ?? null,
    capacityMode: draft.freeCapacityMode,
    maxRegistrations: draft.freeMaxRegistrations,
  };
}
export function draftReceipt(draft: PartnerCampaignDraft) {
  return {
    draftId: draft.id,
    status: 'DRAFT',
    version: draft.version,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}
export function configuration(
  version: CampaignVersion & {
    coverImage?: StoredFile | null;
    shareImage?: StoredFile | null;
  },
  files?: StoredFileService,
) {
  return {
    title: version.title,
    campaignType: version.campaignType,
    shareDescription: version.shareDescription,
    contactPhone: version.contactPhone,
    activityContent: version.activityContent,
    images: {
      cover: files?.toPartnerCampaignImageView(version.coverImage) ?? null,
      share: files?.toPartnerCampaignImageView(version.shareImage) ?? null,
    },
    startsAt: version.startsAt.toISOString(),
    endsAt: version.endsAt.toISOString(),
    timezone: version.timezone,
    capacityMode: version.capacityMode,
    maxRegistrations: version.maxRegistrations,
    feeFen: version.feeFen,
    benefitMode: version.benefitMode,
    registrationLimit: version.registrationLimit,
  };
}
export function reviewSummary(version: CampaignVersion, draftId: string) {
  return {
    versionId: version.id,
    campaignId: version.campaignId,
    draftId,
    campusId: version.campusId,
    title: version.title,
    status: version.status,
    version: version.version,
    sequence: version.sequence,
    submittedAt: version.submittedAt.toISOString(),
    reviewedAt: version.reviewedAt?.toISOString() ?? null,
    reviewReason: version.reviewReason,
  };
}
export function registrationReceipt(row: CampaignRegistration) {
  return {
    registrationId: row.id,
    campaignId: row.campaignId,
    versionId: row.versionId,
    studentId: row.studentId,
    status: row.status,
    version: row.version,
    registeredAt: row.registeredAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}
export function registrationDetail(
  row: CampaignRegistration,
  version: CampaignVersion,
  now: Date,
) {
  return {
    ...registrationReceipt(row),
    title: version.title,
    timezone: version.timezone,
    startsAt: version.startsAt.toISOString(),
    endsAt: version.endsAt.toISOString(),
    canCancel: row.status === 'REGISTERED' && now < version.endsAt,
  };
}
export function availability(
  campaign: Campaign,
  version: CampaignVersion,
  count: number,
  now: Date,
) {
  if (campaign.lifecycle === 'CLOSED') return 'CLOSED';
  if (campaign.publishedVersionId !== version.id) return 'REPLACED';
  if (now < version.startsAt) return 'NOT_STARTED';
  if (now >= version.endsAt) return 'ENDED';
  if (version.maxRegistrations !== null && count >= version.maxRegistrations)
    return 'FULL';
  return 'AVAILABLE';
}
export function remaining(version: CampaignVersion, count: number) {
  return version.maxRegistrations === null
    ? null
    : Math.max(0, version.maxRegistrations - count);
}
export function pageMeta(query: GroupPageQueryDto, total: number) {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}
