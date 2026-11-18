import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type {
  FreeReasonedActionDto,
  FreeReviewQueryDto,
  FreeVersionedActionDto,
} from './dto/free-campaign.dto';
import {
  configuration,
  MAX_VERSION,
  notFound,
  pageMeta,
  reasonText,
  reviewSummary,
  unavailable,
  versionConflict,
} from './free-campaign-policy';
import { FreeCampaignScopeService } from './free-campaign-scope.service';
import { StoredFileService } from '../file/stored-file.service';

@Injectable()
export class FreeCampaignReviewService {
  constructor(
    private readonly scope: FreeCampaignScopeService,
    private readonly idempotency: IdempotencyService,
    private readonly files: StoredFileService,
  ) {}

  list(user: AuthenticatedUser, query: FreeReviewQueryDto) {
    return this.scope.snapshot(user, 'SUPER_ADMIN', async (tx) => {
      const where = { ...(query.status ? { status: query.status } : {}) };
      const total = await tx.campaignVersion.count({ where });
      const rows = await tx.campaignVersion.findMany({
        where,
        include: { campaign: { select: { draftId: true } } },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return {
        data: rows.map((v) => reviewSummary(v, v.campaign.draftId)),
        meta: pageMeta(query, total),
      };
    });
  }

  get(user: AuthenticatedUser, id: string) {
    return this.scope.snapshot(user, 'SUPER_ADMIN', async (tx) => {
      const row = await tx.campaignVersion.findUnique({
        where: { id },
        include: { campaign: true, coverImage: true, shareImage: true },
      });
      if (!row) notFound();
      return {
        ...reviewSummary(row, row.campaign.draftId),
        configuration: configuration(row, this.files),
        sourceDraftVersion: row.sourceDraftVersion,
        campaignVersion: row.campaign.version,
        lifecycle: row.campaign.lifecycle,
        publishedVersionId: row.campaign.publishedVersionId,
      };
    });
  }

  decide(
    user: AuthenticatedUser,
    id: string,
    input: FreeVersionedActionDto,
    key: string,
    decision: 'APPROVED' | 'REJECTED',
    reason: string | null = null,
  ) {
    const route = `/management/campaign-reviews/${id}/${decision === 'APPROVED' ? 'approve' : 'reject'}`;
    const normalizedReason =
      decision === 'REJECTED' ? reasonText(reason ?? '') : null;
    return this.scope.withActor(user, 'SUPER_ADMIN', async (tx, actor) => {
      const locator = await tx.campaignVersion.findUnique({
        where: { id },
        select: {
          campaignId: true,
          campusId: true,
          campaign: { select: { draftId: true } },
        },
      });
      if (!locator) notFound();
      const draft = await this.scope.draft(
        tx,
        locator.campaign.draftId,
        locator.campusId,
        true,
      );
      const campaign = await this.scope.campaign(tx, locator.campaignId);
      await tx.$queryRaw`SELECT "id" FROM "CampaignVersion" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const current = await tx.campaignVersion.findUniqueOrThrow({
        where: { id },
      });
      if (
        actor.userId === draft.createdByUserId ||
        actor.userId === current.submittedByUserId
      )
        throw new DomainError(
          ErrorCode.FORBIDDEN,
          '不能审核本人创建或提交的活动',
          403,
        );
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        actorUserId: actor.userId,
        campusId: campaign.campusId,
        request: {
          expectedVersion: input.expectedVersion,
          ...(decision === 'REJECTED' ? { reason: normalizedReason } : {}),
        },
      });
      if (claim.replayed) return claim.responseBody;
      if (
        current.status !== 'SUBMITTED' ||
        input.expectedVersion !== current.version ||
        current.version === MAX_VERSION
      )
        versionConflict();
      if (decision === 'APPROVED') {
        if (campaign.lifecycle !== 'OPEN' || current.endsAt <= new Date())
          unavailable();
        if (campaign.version === MAX_VERSION) versionConflict();
        const count = await tx.campaignRegistration.count({
          where: { campaignId: campaign.id, status: 'REGISTERED' },
        });
        if (
          current.maxRegistrations !== null &&
          count > current.maxRegistrations
        )
          throw new DomainError(
            ErrorCode.FREE_CAMPAIGN_FULL,
            '新名额上限不能少于当前报名人数',
            409,
          );
      }
      const updated = await tx.campaignVersion.update({
        where: { id },
        data: {
          status: decision,
          version: { increment: 1 },
          reviewedAt: new Date(),
          reviewedByUserId: actor.userId,
          reviewReason: normalizedReason,
        },
      });
      if (decision === 'APPROVED')
        await tx.campaign.update({
          where: { id: campaign.id },
          data: { publishedVersionId: id, version: { increment: 1 } },
        });
      await this.audit(
        tx,
        actor.userId,
        campaign.campusId,
        `FREE_CAMPAIGN_${decision}`,
        id,
        {
          campaignId: campaign.id,
          previousVersion: current.version,
          version: updated.version,
          ...(normalizedReason ? { reason: normalizedReason } : {}),
        },
      );
      const receipt = reviewSummary(updated, draft.id);
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: receipt,
      });
      return receipt;
    });
  }

  close(
    user: AuthenticatedUser,
    id: string,
    input: FreeReasonedActionDto,
    key: string,
  ) {
    const reason = reasonText(input.reason);
    const route = `/management/campaigns/${id}/close`;
    return this.scope.withActor(user, 'SUPER_ADMIN', async (tx, actor) => {
      const locator = await tx.campaign.findUnique({
        where: { id },
        select: { draftId: true, campusId: true },
      });
      if (!locator) notFound();
      await this.scope.draft(tx, locator.draftId, locator.campusId, true);
      const campaign = await this.scope.campaign(tx, id);
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        actorUserId: actor.userId,
        campusId: campaign.campusId,
        request: { expectedVersion: input.expectedVersion, reason },
      });
      if (claim.replayed) return claim.responseBody;
      if (
        campaign.lifecycle !== 'OPEN' ||
        campaign.version !== input.expectedVersion ||
        campaign.version === MAX_VERSION
      )
        versionConflict();
      const updated = await tx.campaign.update({
        where: { id },
        data: {
          lifecycle: 'CLOSED',
          version: { increment: 1 },
          closedAt: new Date(),
          closedByUserId: actor.userId,
          closeReason: reason,
        },
      });
      await this.audit(
        tx,
        actor.userId,
        campaign.campusId,
        'FREE_CAMPAIGN_CLOSE',
        id,
        { previousVersion: campaign.version, version: updated.version, reason },
      );
      const receipt = {
        campaignId: id,
        lifecycle: updated.lifecycle,
        version: updated.version,
      };
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: receipt,
      });
      return receipt;
    });
  }

  private audit(
    tx: Prisma.TransactionClient,
    userId: string,
    campusId: string,
    action: string,
    id: string,
    details: Prisma.InputJsonObject,
  ) {
    return tx.auditLog.create({
      data: {
        campusId,
        actorUserId: userId,
        action,
        resourceType: 'Campaign',
        resourceId: id,
        outcome: 'SUCCESS',
        details,
      },
    });
  }
}
