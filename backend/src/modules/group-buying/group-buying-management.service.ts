import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  GROUP_CAMPAIGN_POSTER_OPTIONS,
  StoredFileService,
  type UploadedStoredFile,
} from '../file/stored-file.service';
import type {
  GroupCampaignPosterOrderDto,
  GroupCampaignMutationDto,
  VersionedGroupActionDto,
  VersionedGroupCampaignMutationDto,
  VersionedReasonedGroupActionDto,
} from './dto/group-buying.dto';
import {
  loadGroupOrderView,
  loadManagementCampaignView,
} from './group-buying-query.service';
import { GroupBuyingPaymentService } from './group-buying-payment.service';
import { GroupBuyingSettlementService } from './group-buying-settlement.service';

const CREATE_CAMPAIGN_ROUTE = '/management/group-campaigns';
const campaignRoute = (campaignId: string) =>
  `/management/group-campaigns/${campaignId}`;
const activateRoute = (campaignId: string) =>
  `/management/group-campaigns/${campaignId}/activate`;
const closeRoute = (campaignId: string) =>
  `/management/group-campaigns/${campaignId}/close`;
const cancelRoute = (campaignId: string) =>
  `/management/group-campaigns/${campaignId}/cancel`;
const posterUploadRoute = (campaignId: string) =>
  `/management/group-campaigns/${campaignId}/posters`;
const posterReorderRoute = (campaignId: string) =>
  `/management/group-campaigns/${campaignId}/posters/reorder`;
const posterDetachRoute = (campaignId: string, posterId: string) =>
  `/management/group-campaigns/${campaignId}/posters/${posterId}/detach`;
const refundRoute = (orderId: string) =>
  `/management/group-orders/${orderId}/refund`;

@Injectable()
export class GroupBuyingManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly settlementService: GroupBuyingSettlementService,
    private readonly paymentService: GroupBuyingPaymentService,
    private readonly storedFileService: StoredFileService,
  ) {}

  async createCampaign(
    user: AuthenticatedUser,
    dto: GroupCampaignMutationDto,
    idempotencyKey: string,
  ) {
    this.validateTimeRange(dto.startsAt, dto.endsAt);
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route: CREATE_CAMPAIGN_ROUTE,
        request: dto,
        campusId: dto.campusId,
        actorUserId: user.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }
      await this.requireProduct(transaction, dto.campusId, dto.courseProductId);
      const campaign = await transaction.groupCampaign.create({
        data: {
          code: createCampaignCode(),
          campusId: dto.campusId,
          courseProductId: dto.courseProductId,
          title: dto.title,
          description: dto.description,
          priceFen: dto.priceFen,
          maxPaidMembers: 3,
          startsAt: new Date(dto.startsAt),
          endsAt: new Date(dto.endsAt),
          status: 'DRAFT',
          createdByUserId: user.userId,
        },
      });
      await this.audit(transaction, user.userId, campaign.campusId, {
        action: 'GROUP_CAMPAIGN_CREATED',
        campaignId: campaign.id,
        details: { code: campaign.code, version: campaign.version },
      });
      const result = await loadManagementCampaignView(
        transaction,
        campaign.id,
        this.storedFileService,
      );
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route: CREATE_CAMPAIGN_ROUTE,
        responseBody: result as Prisma.InputJsonValue,
      });
      return result;
    });
  }

  async updateCampaign(
    user: AuthenticatedUser,
    campaignId: string,
    dto: VersionedGroupCampaignMutationDto,
    idempotencyKey: string,
  ) {
    this.validateTimeRange(dto.startsAt, dto.endsAt);
    const route = campaignRoute(campaignId);
    return this.prisma.$transaction(async (transaction) => {
      const existing = await this.requireCampaign(transaction, campaignId);
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: existing.campusId,
        actorUserId: user.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }
      await this.requireProduct(transaction, dto.campusId, dto.courseProductId);
      const updated = await transaction.groupCampaign.updateMany({
        where: {
          id: campaignId,
          status: 'DRAFT',
          version: dto.expectedVersion,
        },
        data: {
          campusId: dto.campusId,
          courseProductId: dto.courseProductId,
          title: dto.title,
          description: dto.description,
          priceFen: dto.priceFen,
          startsAt: new Date(dto.startsAt),
          endsAt: new Date(dto.endsAt),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        this.versionConflict('Only the current draft campaign can be updated');
      }
      await this.audit(transaction, user.userId, dto.campusId, {
        action: 'GROUP_CAMPAIGN_UPDATED',
        campaignId,
        details: { previousVersion: dto.expectedVersion },
      });
      const result = await loadManagementCampaignView(
        transaction,
        campaignId,
        this.storedFileService,
      );
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: result as Prisma.InputJsonValue,
      });
      return result;
    });
  }

  async activateCampaign(
    user: AuthenticatedUser,
    campaignId: string,
    dto: VersionedGroupActionDto,
    idempotencyKey: string,
  ) {
    const route = activateRoute(campaignId);
    return this.prisma.$transaction(async (transaction) => {
      const existing = await this.requireCampaign(transaction, campaignId);
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: existing.campusId,
        actorUserId: user.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }
      const updated = await transaction.groupCampaign.updateMany({
        where: {
          id: campaignId,
          status: 'DRAFT',
          version: dto.expectedVersion,
        },
        data: { status: 'ACTIVE', version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        this.versionConflict('Only the current draft campaign can be activated');
      }
      await this.audit(transaction, user.userId, existing.campusId, {
        action: 'GROUP_CAMPAIGN_ACTIVATED',
        campaignId,
        details: { previousVersion: dto.expectedVersion },
      });
      const result = await loadManagementCampaignView(
        transaction,
        campaignId,
        this.storedFileService,
      );
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: result as Prisma.InputJsonValue,
      });
      return result;
    });
  }

  async closeCampaign(
    user: AuthenticatedUser,
    campaignId: string,
    dto: VersionedGroupActionDto,
    idempotencyKey: string,
  ) {
    const route = closeRoute(campaignId);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "GroupCampaign" WHERE "id" = ${campaignId}::uuid FOR UPDATE`,
      );
      const existing = await this.requireCampaign(transaction, campaignId);
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: existing.campusId,
        actorUserId: user.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }
      if (existing.status !== 'ACTIVE' || existing.version !== dto.expectedVersion) {
        this.versionConflict('Only the current active campaign can be closed');
      }

      const teams = await transaction.groupTeam.findMany({
        where: { campaignId, status: 'OPEN' },
        select: { id: true },
      });
      for (const team of teams) {
        const paidCount = await transaction.groupMember.count({
          where: { teamId: team.id, status: 'PAID' },
        });
        if (paidCount > 0) {
          await this.settlementService.settleTeam(transaction, team.id);
        } else {
          await this.cancelUnpaidTeam(transaction, team.id);
        }
      }
      await transaction.groupCampaign.update({
        where: { id: campaignId },
        data: { status: 'CLOSED', version: { increment: 1 } },
      });
      await this.audit(transaction, user.userId, existing.campusId, {
        action: 'GROUP_CAMPAIGN_CLOSED',
        campaignId,
        details: { previousVersion: dto.expectedVersion },
      });
      const result = await loadManagementCampaignView(
        transaction,
        campaignId,
        this.storedFileService,
      );
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: result as Prisma.InputJsonValue,
      });
      return result;
    });
  }

  async cancelCampaign(
    user: AuthenticatedUser,
    campaignId: string,
    dto: VersionedReasonedGroupActionDto,
    idempotencyKey: string,
  ) {
    const route = cancelRoute(campaignId);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "GroupCampaign" WHERE "id" = ${campaignId}::uuid FOR UPDATE`,
      );
      const existing = await this.requireCampaign(transaction, campaignId);
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: existing.campusId,
        actorUserId: user.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }
      if (
        !['DRAFT', 'ACTIVE'].includes(existing.status) ||
        existing.version !== dto.expectedVersion
      ) {
        this.versionConflict('Only the current unsettled campaign can be cancelled');
      }
      const settledTeam = await transaction.groupTeam.findFirst({
        where: { campaignId, status: 'SETTLED' },
        select: { id: true },
      });
      if (settledTeam) {
        throw new DomainError(
          ErrorCode.REFUND_NOT_ALLOWED,
          'A campaign with settled teams cannot be cancelled',
          409,
        );
      }

      const teams = await transaction.groupTeam.findMany({
        where: { campaignId, status: 'OPEN' },
        include: { members: { orderBy: { createdAt: 'asc' } } },
      });
      for (const team of teams) {
        for (const member of team.members) {
          if (member.status === 'PAID') {
            await this.paymentService.refundMember(
              transaction,
              member.id,
              user.userId,
              dto.reason,
            );
          } else if (member.status === 'PENDING_PAYMENT') {
            await transaction.groupMember.update({
              where: { id: member.id },
              data: { status: 'CANCELLED', version: { increment: 1 } },
            });
            await transaction.enrollmentOrder.update({
              where: { id: member.enrollmentOrderId },
              data: {
                status: 'CANCELLED',
                cancelledAt: new Date(),
                version: { increment: 1 },
              },
            });
            await transaction.paymentTransaction.updateMany({
              where: {
                groupMemberId: member.id,
                type: 'PAYMENT',
                status: 'PENDING',
              },
              data: { status: 'FAILED', failedAt: new Date() },
            });
          }
        }
        await transaction.groupTeam.update({
          where: { id: team.id },
          data: {
            status: 'CANCELLED',
            paidMemberCount: 0,
            version: { increment: 1 },
          },
        });
      }
      await transaction.groupCampaign.update({
        where: { id: campaignId },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      await this.audit(transaction, user.userId, existing.campusId, {
        action: 'GROUP_CAMPAIGN_CANCELLED',
        campaignId,
        details: { previousVersion: dto.expectedVersion, reason: dto.reason },
      });
      const result = await loadManagementCampaignView(
        transaction,
        campaignId,
        this.storedFileService,
      );
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: result as Prisma.InputJsonValue,
      });
      return result;
    });
  }

  async uploadCampaignPoster(
    user: AuthenticatedUser,
    campaignId: string,
    dto: VersionedGroupActionDto,
    file: UploadedStoredFile | undefined,
    idempotencyKey: string,
  ) {
    const stored = await this.storedFileService.store(
      user,
      file,
      GROUP_CAMPAIGN_POSTER_OPTIONS,
    );
    let attached = false;
    try {
      const outcome = await this.prisma.$transaction(async (transaction) => {
        await this.lockCampaign(transaction, campaignId);
        const existing = await this.requireCampaign(transaction, campaignId);
        const route = posterUploadRoute(campaignId);
        const claim = await this.idempotency.claim(transaction, {
          key: idempotencyKey,
          route,
          request: {
            expectedVersion: dto.expectedVersion,
            sha256: stored.sha256,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
          },
          campusId: existing.campusId,
          actorUserId: user.userId,
        });
        if (claim.replayed) {
          return { replayed: true as const, response: claim.responseBody };
        }
        this.requireMutablePosterCampaign(existing, dto.expectedVersion);
        const posterCount = await transaction.groupCampaignPoster.count({
          where: { campaignId },
        });
        if (posterCount >= 6) {
          throw new DomainError(
            ErrorCode.CONFLICT,
            'A campaign can contain at most six poster images',
            409,
          );
        }
        const poster = await transaction.groupCampaignPoster.create({
          data: {
            campaignId,
            storedFileId: stored.id,
            sortOrder: posterCount,
          },
        });
        await transaction.groupCampaign.update({
          where: { id: campaignId },
          data: { version: { increment: 1 } },
        });
        await this.audit(transaction, user.userId, existing.campusId, {
          action: 'GROUP_CAMPAIGN_POSTER_UPLOADED',
          campaignId,
          details: {
            posterId: poster.id,
            storedFileId: stored.id,
            sortOrder: poster.sortOrder,
            previousVersion: dto.expectedVersion,
          },
        });
        const response = await loadManagementCampaignView(
          transaction,
          campaignId,
          this.storedFileService,
        );
        await this.idempotency.complete(transaction, {
          key: idempotencyKey,
          route,
          responseBody: response as Prisma.InputJsonValue,
        });
        return { replayed: false as const, response };
      });
      if (outcome.replayed) {
        await this.storedFileService.discard(stored.id).catch(() => undefined);
      } else {
        attached = true;
      }
      return outcome.response;
    } catch (error: unknown) {
      if (!attached) {
        await this.storedFileService.discard(stored.id).catch(() => undefined);
      }
      throw error;
    }
  }

  async reorderCampaignPosters(
    user: AuthenticatedUser,
    campaignId: string,
    dto: GroupCampaignPosterOrderDto,
    idempotencyKey: string,
  ) {
    const route = posterReorderRoute(campaignId);
    return this.prisma.$transaction(async (transaction) => {
      await this.lockCampaign(transaction, campaignId);
      const existing = await this.requireCampaign(transaction, campaignId);
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: existing.campusId,
        actorUserId: user.userId,
      });
      if (claim.replayed) return claim.responseBody;
      this.requireMutablePosterCampaign(existing, dto.expectedVersion);
      const posters = await transaction.groupCampaignPoster.findMany({
        where: { campaignId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      const currentIds = new Set(posters.map(({ id }) => id));
      if (
        posters.length !== dto.posterIds.length ||
        dto.posterIds.some((posterId) => !currentIds.has(posterId))
      ) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          'Poster order must contain every attached campaign poster exactly once',
          400,
        );
      }
      await this.resequencePosters(transaction, dto.posterIds);
      await transaction.groupCampaign.update({
        where: { id: campaignId },
        data: { version: { increment: 1 } },
      });
      await this.audit(transaction, user.userId, existing.campusId, {
        action: 'GROUP_CAMPAIGN_POSTERS_REORDERED',
        campaignId,
        details: {
          posterIds: dto.posterIds,
          previousVersion: dto.expectedVersion,
        },
      });
      const result = await loadManagementCampaignView(
        transaction,
        campaignId,
        this.storedFileService,
      );
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: result as Prisma.InputJsonValue,
      });
      return result;
    });
  }

  async detachCampaignPoster(
    user: AuthenticatedUser,
    campaignId: string,
    posterId: string,
    dto: VersionedGroupActionDto,
    idempotencyKey: string,
  ) {
    const route = posterDetachRoute(campaignId, posterId);
    return this.prisma.$transaction(async (transaction) => {
      await this.lockCampaign(transaction, campaignId);
      const existing = await this.requireCampaign(transaction, campaignId);
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: existing.campusId,
        actorUserId: user.userId,
      });
      if (claim.replayed) return claim.responseBody;
      this.requireMutablePosterCampaign(existing, dto.expectedVersion);
      const poster = await transaction.groupCampaignPoster.findFirst({
        where: { id: posterId, campaignId },
        select: { id: true, storedFileId: true },
      });
      if (!poster) {
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Group campaign poster not found',
          404,
        );
      }
      await transaction.groupCampaignPoster.delete({
        where: { id: poster.id },
      });
      const remaining = await transaction.groupCampaignPoster.findMany({
        where: { campaignId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      await this.resequencePosters(
        transaction,
        remaining.map(({ id }) => id),
      );
      await transaction.groupCampaign.update({
        where: { id: campaignId },
        data: { version: { increment: 1 } },
      });
      await this.audit(transaction, user.userId, existing.campusId, {
        action: 'GROUP_CAMPAIGN_POSTER_DETACHED',
        campaignId,
        details: {
          posterId,
          storedFileId: poster.storedFileId,
          previousVersion: dto.expectedVersion,
        },
      });
      const result = await loadManagementCampaignView(
        transaction,
        campaignId,
        this.storedFileService,
      );
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: result as Prisma.InputJsonValue,
      });
      return result;
    });
  }

  async refundOrder(
    user: AuthenticatedUser,
    orderId: string,
    dto: VersionedReasonedGroupActionDto,
    idempotencyKey: string,
  ) {
    const route = refundRoute(orderId);
    return this.prisma.$transaction(async (transaction) => {
      const member = await transaction.groupMember.findUnique({
        where: { enrollmentOrderId: orderId },
        include: { campaign: true },
      });
      if (!member) {
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Group order not found',
          404,
        );
      }
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: member.campaign.campusId,
        actorUserId: user.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }
      if (member.version !== dto.expectedVersion) {
        this.versionConflict('Group order version has changed');
      }
      await this.paymentService.refundMember(
        transaction,
        member.id,
        user.userId,
        dto.reason,
      );
      await transaction.auditLog.create({
        data: {
          campusId: member.campaign.campusId,
          actorUserId: user.userId,
          action: 'GROUP_ORDER_REFUNDED',
          resourceType: 'GroupOrder',
          resourceId: orderId,
          outcome: 'SUCCESS',
          details: {
            campaignId: member.campaignId,
            previousVersion: dto.expectedVersion,
            reason: dto.reason,
          },
        },
      });
      const result = await loadGroupOrderView(transaction, member.id);
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: result as Prisma.InputJsonValue,
      });
      return result;
    });
  }

  private async cancelUnpaidTeam(
    transaction: Prisma.TransactionClient,
    teamId: string,
  ): Promise<void> {
    const cancelledAt = new Date();
    const pendingMembers = await transaction.groupMember.findMany({
      where: { teamId, status: 'PENDING_PAYMENT' },
      select: { id: true, enrollmentOrderId: true },
    });
    await transaction.groupMember.updateMany({
      where: { teamId, status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED', version: { increment: 1 } },
    });
    await transaction.enrollmentOrder.updateMany({
      where: {
        id: { in: pendingMembers.map(({ enrollmentOrderId }) => enrollmentOrderId) },
      },
      data: {
        status: 'CANCELLED',
        cancelledAt,
        version: { increment: 1 },
      },
    });
    await transaction.paymentTransaction.updateMany({
      where: {
        groupMemberId: { in: pendingMembers.map(({ id }) => id) },
        type: 'PAYMENT',
        status: 'PENDING',
      },
      data: { status: 'FAILED', failedAt: cancelledAt },
    });
    await transaction.groupTeam.update({
      where: { id: teamId },
      data: {
        status: 'CANCELLED',
        paidMemberCount: 0,
        version: { increment: 1 },
      },
    });
  }

  private validateTimeRange(startsAt: string, endsAt: string): void {
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        'Campaign end time must be after its start time',
        400,
      );
    }
  }

  private async lockCampaign(
    transaction: Prisma.TransactionClient,
    campaignId: string,
  ): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "GroupCampaign" WHERE "id" = ${campaignId}::uuid FOR UPDATE`,
    );
  }

  private requireMutablePosterCampaign(
    campaign: { status: string; version: number },
    expectedVersion: number,
  ): void {
    if (
      !['DRAFT', 'ACTIVE'].includes(campaign.status) ||
      campaign.version !== expectedVersion
    ) {
      this.versionConflict(
        'Only the current draft or active campaign can change posters',
      );
    }
  }

  private async resequencePosters(
    transaction: Prisma.TransactionClient,
    posterIds: string[],
  ): Promise<void> {
    for (const [index, posterId] of posterIds.entries()) {
      await transaction.groupCampaignPoster.update({
        where: { id: posterId },
        data: { sortOrder: -(index + 1) },
      });
    }
    for (const [index, posterId] of posterIds.entries()) {
      await transaction.groupCampaignPoster.update({
        where: { id: posterId },
        data: { sortOrder: index },
      });
    }
  }

  private async requireProduct(
    transaction: Prisma.TransactionClient,
    campusId: string,
    courseProductId: string,
  ): Promise<void> {
    const product = await transaction.courseProduct.findFirst({
      where: { id: courseProductId, campusId },
      select: { id: true },
    });
    if (!product) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Course product not found in the selected campus',
        404,
      );
    }
  }

  private async requireCampaign(
    transaction: Prisma.TransactionClient,
    campaignId: string,
  ) {
    const campaign = await transaction.groupCampaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Group campaign not found',
        404,
      );
    }
    return campaign;
  }

  private async audit(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    campusId: string,
    input: {
      action: string;
      campaignId: string;
      details: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        campusId,
        actorUserId,
        action: input.action,
        resourceType: 'GroupCampaign',
        resourceId: input.campaignId,
        outcome: 'SUCCESS',
        details: input.details,
      },
    });
  }

  private versionConflict(message: string): never {
    throw new DomainError(
      ErrorCode.CONFLICT,
      message,
      409,
    );
  }
}

function createCampaignCode(): string {
  return `GROUP-MGMT-${Date.now()}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}
