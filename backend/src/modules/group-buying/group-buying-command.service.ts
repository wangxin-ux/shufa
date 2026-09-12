import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { ParentScope } from '../../common/auth/parent-scope.service';
import { ParentScopeService } from '../../common/auth/parent-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { PaymentAdapter } from '../../infrastructure/payment/payment.adapter';
import { PAYMENT_ADAPTER } from '../../infrastructure/payment/payment.constants';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { JoinExistingTeamDto, JoinGroupDto } from './dto/group-buying.dto';
import { loadGroupJoinView } from './group-buying-query.service';

const CREATE_TEAM_ROUTE = '/parents/me/group-teams';
const joinTeamRoute = (teamId: string) =>
  `/parents/me/group-teams/${teamId}/members`;

@Injectable()
export class GroupBuyingCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parentScopeService: ParentScopeService,
    private readonly idempotency: IdempotencyService,
    @Inject(PAYMENT_ADAPTER) private readonly paymentAdapter: PaymentAdapter,
  ) {}

  async createTeam(
    scope: ParentScope,
    dto: JoinGroupDto,
    idempotencyKey: string,
  ) {
    await this.parentScopeService.resolveStudent(scope, dto.studentId);
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route: CREATE_TEAM_ROUTE,
        request: dto,
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }

      const campaign = await this.requireActiveCampaign(
        transaction,
        dto.campaignId,
        scope.campusId,
      );
      await this.rejectDuplicateStudent(
        transaction,
        campaign.id,
        dto.studentId,
      );
      const team = await transaction.groupTeam.create({
        data: {
          campaignId: campaign.id,
          leaderUserId: scope.userId,
        },
      });
      const result = await this.createPendingMember(
        transaction,
        scope,
        campaign,
        team.id,
        dto.studentId,
      );
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route: CREATE_TEAM_ROUTE,
        responseBody: result as Prisma.InputJsonValue,
      });
      return result;
    });
  }

  async joinTeam(
    scope: ParentScope,
    teamId: string,
    dto: JoinExistingTeamDto,
    idempotencyKey: string,
  ) {
    await this.parentScopeService.resolveStudent(scope, dto.studentId);
    const route = joinTeamRoute(teamId);
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }

      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "GroupTeam" WHERE "id" = ${teamId}::uuid FOR UPDATE`,
      );
      const team = await transaction.groupTeam.findFirst({
        where: {
          id: teamId,
          status: 'OPEN',
          campaign: { campusId: scope.campusId },
        },
        include: { campaign: { include: { courseProduct: true } } },
      });
      if (!team) {
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Open group team not found',
          404,
        );
      }
      this.assertCampaignActive(team.campaign);
      await this.rejectDuplicateStudent(
        transaction,
        team.campaignId,
        dto.studentId,
      );

      const occupiedCount = await transaction.groupMember.count({
        where: {
          teamId,
          OR: [
            { status: { in: ['PAID', 'SETTLED', 'REFUNDING'] } },
            {
              status: 'PENDING_PAYMENT',
              reservationExpiresAt: { gt: new Date() },
            },
          ],
        },
      });
      if (occupiedCount >= team.campaign.maxPaidMembers) {
        throw new DomainError(
          ErrorCode.GROUP_TEAM_FULL,
          'Group team has no remaining slot',
          409,
        );
      }

      const result = await this.createPendingMember(
        transaction,
        scope,
        team.campaign,
        teamId,
        dto.studentId,
      );
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: result as Prisma.InputJsonValue,
      });
      return result;
    });
  }

  private async createPendingMember(
    transaction: Prisma.TransactionClient,
    scope: ParentScope,
    campaign: {
      id: string;
      title: string;
      campusId: string;
      courseProductId: string;
      priceFen: number;
      courseProduct: { validityDays: number };
    },
    teamId: string,
    studentId: string,
  ) {
    const orderNo = createBusinessNo('GROUP');
    const outTradeNo = createBusinessNo('GPAY');
    const order = await transaction.enrollmentOrder.create({
      data: {
        orderNo,
        parentUserId: scope.userId,
        studentId,
        campusId: campaign.campusId,
        courseProductId: campaign.courseProductId,
        productNameSnapshot: campaign.title,
        priceFenSnapshot: campaign.priceFen,
        mainUnitsSnapshot: 100,
        giftUnitsSnapshot: 0,
        validityDaysSnapshot: campaign.courseProduct.validityDays,
        status: 'AWAITING_PAYMENT',
      },
    });
    const member = await transaction.groupMember.create({
      data: {
        campaignId: campaign.id,
        teamId,
        parentUserId: scope.userId,
        studentId,
        enrollmentOrderId: order.id,
        reservationExpiresAt: new Date(Date.now() + 30 * 60 * 1_000),
      },
    });
    await transaction.paymentTransaction.create({
      data: {
        groupMemberId: member.id,
        enrollmentOrderId: order.id,
        type: 'PAYMENT',
        provider: this.paymentAdapter.mode,
        outTradeNo,
        amountFen: campaign.priceFen,
      },
    });
    const invocation = await this.paymentAdapter.createJsapiPayment({
      outTradeNo,
      amountFen: campaign.priceFen,
      description: campaign.title,
      payerOpenId: scope.userId,
    });
    return loadGroupJoinView(
      transaction,
      member.id,
      scope.userId,
      invocation,
    );
  }

  private async requireActiveCampaign(
    transaction: Prisma.TransactionClient,
    campaignId: string,
    campusId: string,
  ) {
    const campaign = await transaction.groupCampaign.findFirst({
      where: { id: campaignId, campusId },
      include: { courseProduct: true },
    });
    if (!campaign) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Group campaign not found',
        404,
      );
    }
    this.assertCampaignActive(campaign);
    return campaign;
  }

  private assertCampaignActive(campaign: {
    status: string;
    startsAt: Date;
    endsAt: Date;
    courseProduct: { status: string };
  }): void {
    const now = Date.now();
    if (
      campaign.status !== 'ACTIVE' ||
      campaign.courseProduct.status !== 'ACTIVE' ||
      campaign.startsAt.getTime() > now ||
      campaign.endsAt.getTime() <= now
    ) {
      throw new DomainError(
        ErrorCode.GROUP_CAMPAIGN_NOT_ACTIVE,
        'Group campaign is not active',
        409,
      );
    }
  }

  private async rejectDuplicateStudent(
    transaction: Prisma.TransactionClient,
    campaignId: string,
    studentId: string,
  ): Promise<void> {
    const existing = await transaction.groupMember.findUnique({
      where: { campaignId_studentId: { campaignId, studentId } },
      select: { id: true },
    });
    if (existing) {
      throw new DomainError(
        ErrorCode.GROUP_ALREADY_JOINED,
        'The student has already joined this campaign',
        409,
      );
    }
  }
}

function createBusinessNo(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
