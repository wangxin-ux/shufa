import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { StoredFileService } from '../file/stored-file.service';
import type {
  FreeConfigurationMutationDto,
  FreeVersionedActionDto,
} from './dto/free-campaign.dto';
import type { GroupPageQueryDto } from './dto/group-buying.dto';
import {
  draftReceipt,
  invalid,
  MAX_VERSION,
  normalizeSettings,
  notFound,
  pageMeta,
  reviewSummary,
  settings,
  unavailable,
  versionConflict,
} from './free-campaign-policy';
import { FreeCampaignScopeService } from './free-campaign-scope.service';

@Injectable()
export class FreeCampaignConfigService {
  constructor(
    private readonly scope: FreeCampaignScopeService,
    private readonly idempotency: IdempotencyService,
    private readonly files: StoredFileService,
  ) {}

  get(user: AuthenticatedUser, id: string) {
    return this.scope.snapshot(
      user,
      'PARTNER',
      async (tx, actor) => {
        const campusId = this.scope.campus(actor);
        const draft = await this.scope.draft(tx, id, campusId);
        const campus = await tx.campus.findUniqueOrThrow({
          where: { id: campusId },
          select: { timezone: true },
        });
        const campaign = await tx.campaign.findUnique({
          where: { draftId: id },
          include: { publishedVersion: { include: { shareImage: true } } },
        });
        if (
          campaign?.publishedVersionId &&
          campaign.publishedVersion?.status !== 'APPROVED'
        )
          notFound();
        return {
          draftId: id,
          version: draft.version,
          campusTimezone: campus.timezone,
          freeRegistration: settings(draft),
          campaignId: campaign?.id ?? null,
          publishedVersionId: campaign?.publishedVersionId ?? null,
          publishedVersion: campaign?.publishedVersion
            ? reviewSummary(campaign.publishedVersion, id)
            : null,
          publishedShareImage: this.files.toPartnerCampaignImageView(
            campaign?.publishedVersion?.shareImage,
          ),
          campaignVersion: campaign?.version ?? null,
          lifecycle: campaign?.lifecycle ?? null,
        };
      },
      async (tx, actor) => {
        await this.scope.draft(tx, id, this.scope.campus(actor));
      },
    );
  }

  save(
    user: AuthenticatedUser,
    id: string,
    input: FreeConfigurationMutationDto,
  ) {
    const next = normalizeSettings(input.freeRegistration);
    return this.scope.withActor(user, 'PARTNER', async (tx, actor) => {
      const campusId = this.scope.campus(actor);
      const draft = await this.scope.draft(tx, id, campusId, true);
      if (draft.campaignType !== 'FREE_REGISTRATION') invalid();
      const same =
        draft.freeStartsAt?.getTime() === next.freeStartsAt?.getTime() &&
        draft.freeEndsAt?.getTime() === next.freeEndsAt?.getTime() &&
        draft.freeCapacityMode === next.freeCapacityMode &&
        draft.freeMaxRegistrations === next.freeMaxRegistrations;
      if (
        same &&
        (input.expectedVersion === draft.version ||
          input.expectedVersion === draft.version - 1)
      )
        return draftReceipt(draft);
      if (
        input.expectedVersion !== draft.version ||
        draft.version === MAX_VERSION
      )
        versionConflict();
      const updated = await tx.partnerCampaignDraft.update({
        where: { id },
        data: { ...next, version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          campusId,
          actorUserId: actor.userId,
          action: 'FREE_CAMPAIGN_CONFIGURATION_SAVE',
          resourceType: 'PartnerCampaignDraft',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { previousVersion: draft.version, version: updated.version },
        },
      });
      return draftReceipt(updated);
    });
  }

  submit(
    user: AuthenticatedUser,
    id: string,
    input: FreeVersionedActionDto,
    key: string,
  ) {
    const route = `/partners/me/campaign-drafts/${id}/submit`;
    return this.scope.withActor(user, 'PARTNER', async (tx, actor) => {
      const campusId = this.scope.campus(actor);
      const draft = await this.scope.draft(tx, id, campusId, true);
      let campaign = await tx.campaign.findUnique({ where: { draftId: id } });
      if (campaign)
        campaign = await this.scope.campaign(tx, campaign.id, campusId);
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: input,
        actorUserId: actor.userId,
        campusId,
      });
      if (claim.replayed) return claim.responseBody;
      if (input.expectedVersion !== draft.version) versionConflict();
      if (
        draft.campaignType !== 'FREE_REGISTRATION' ||
        !draft.title ||
        !draft.shareDescription ||
        !draft.freeStartsAt ||
        !draft.freeEndsAt ||
        !draft.freeCapacityMode ||
        (draft.freeCapacityMode === 'LIMITED' && !draft.freeMaxRegistrations)
      )
        invalid();
      if (draft.freeEndsAt <= new Date() || campaign?.lifecycle === 'CLOSED')
        unavailable();
      if (!campaign)
        campaign = await tx.campaign.create({
          data: { draftId: id, campusId },
        });
      if (
        await tx.campaignVersion.count({
          where: { campaignId: campaign.id, status: 'SUBMITTED' },
        })
      )
        versionConflict();
      const latest = await tx.campaignVersion.aggregate({
        where: { campaignId: campaign.id },
        _max: { sequence: true },
      });
      const sequence = (latest._max.sequence ?? 0) + 1;
      if (sequence > MAX_VERSION) versionConflict();
      const campus = await tx.campus.findUniqueOrThrow({
        where: { id: campusId },
        select: { timezone: true },
      });
      const version = await tx.campaignVersion.create({
        data: {
          campaignId: campaign.id,
          campusId,
          sequence,
          sourceDraftVersion: draft.version,
          title: draft.title,
          shareDescription: draft.shareDescription,
          contactPhone: draft.contactPhone,
          activityContent: draft.activityContent,
          coverImageId: draft.coverImageId,
          shareImageId: draft.shareImageId,
          snapshotSchemaVersion: 3,
          startsAt: draft.freeStartsAt,
          endsAt: draft.freeEndsAt,
          timezone: campus.timezone,
          capacityMode: draft.freeCapacityMode,
          maxRegistrations: draft.freeMaxRegistrations,
          submittedByUserId: actor.userId,
        },
      });
      await tx.auditLog.create({
        data: {
          campusId,
          actorUserId: actor.userId,
          action: 'FREE_CAMPAIGN_SUBMIT',
          resourceType: 'CampaignVersion',
          resourceId: version.id,
          outcome: 'SUCCESS',
          details: {
            campaignId: campaign.id,
            sourceDraftVersion: draft.version,
            sequence,
          },
        },
      });
      const receipt = reviewSummary(version, id);
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: receipt,
      });
      return receipt;
    });
  }

  versions(user: AuthenticatedUser, id: string, query: GroupPageQueryDto) {
    return this.scope.snapshot(
      user,
      'PARTNER',
      async (tx, actor) => {
        await this.scope.draft(tx, id, this.scope.campus(actor));
        const where = { campaign: { draftId: id, campusId: actor.campusId! } };
        const total = await tx.campaignVersion.count({ where });
        const rows = await tx.campaignVersion.findMany({
          where,
          orderBy: { sequence: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        });
        return {
          data: rows.map((v) => reviewSummary(v, id)),
          meta: pageMeta(query, total),
        };
      },
      async (tx, actor) => {
        await this.scope.draft(tx, id, this.scope.campus(actor));
      },
    );
  }
}
