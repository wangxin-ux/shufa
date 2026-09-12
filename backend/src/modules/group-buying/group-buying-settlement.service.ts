import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';

export interface GroupBenefit {
  mainUnits: number;
  giftUnits: number;
}

const GROUP_BENEFITS: Readonly<Record<number, GroupBenefit>> = {
  1: { mainUnits: 100, giftUnits: 0 },
  2: { mainUnits: 100, giftUnits: 200 },
  3: { mainUnits: 100, giftUnits: 400 },
};

export function resolveGroupBenefit(paidMemberCount: number): GroupBenefit {
  const benefit = GROUP_BENEFITS[paidMemberCount];
  if (!benefit || !Number.isInteger(paidMemberCount)) {
    throw new DomainError(
      ErrorCode.GROUP_MEMBER_STATUS_CONFLICT,
      'Group benefit requires one to three paid members',
      409,
      { paidMemberCount },
    );
  }

  return { ...benefit };
}

@Injectable()
export class GroupBuyingSettlementService {
  async settleTeam(
    transaction: Prisma.TransactionClient,
    teamId: string,
    settledAt = new Date(),
  ): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "GroupTeam" WHERE "id" = ${teamId}::uuid FOR UPDATE`,
    );
    const team = await transaction.groupTeam.findUnique({
      where: { id: teamId },
      include: {
        campaign: { include: { courseProduct: true } },
        members: {
          where: { status: { in: ['PAID', 'SETTLED'] } },
          include: { enrollmentOrder: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!team) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Group team not found',
        404,
      );
    }
    if (team.status === 'SETTLED') {
      return;
    }
    if (team.status !== 'OPEN') {
      throw new DomainError(
        ErrorCode.GROUP_MEMBER_STATUS_CONFLICT,
        'Group team cannot be settled',
        409,
      );
    }

    const benefit = resolveGroupBenefit(team.members.length);
    for (const member of team.members) {
      if (member.status === 'SETTLED') {
        continue;
      }
      const expiresAt = new Date(settledAt);
      expiresAt.setUTCDate(
        expiresAt.getUTCDate() + member.enrollmentOrder.validityDaysSnapshot,
      );
      const coursePackage = await transaction.coursePackage.create({
        data: {
          campusId: team.campaign.campusId,
          studentId: member.studentId,
          name: team.campaign.title,
          mainBalanceUnits: benefit.mainUnits,
          giftBalanceUnits: benefit.giftUnits,
          paidAmountFen: member.enrollmentOrder.priceFenSnapshot,
          validFrom: settledAt,
          expiresAt,
          sourceOrderId: member.enrollmentOrderId,
        },
      });
      await transaction.lessonLedgerEntry.create({
        data: {
          campusId: team.campaign.campusId,
          studentId: member.studentId,
          coursePackageId: coursePackage.id,
          entryType: 'GRANT',
          bucket: 'MAIN',
          deltaUnits: benefit.mainUnits,
          balanceBeforeUnits: 0,
          balanceAfterUnits: benefit.mainUnits,
          idempotencyKey: `group-settle:${team.id}:${member.id}:main`,
          actorUserId: team.campaign.createdByUserId,
          reason: `拼团 ${team.members.length} 人档主课时发放`,
          createdAt: settledAt,
        },
      });
      if (benefit.giftUnits > 0) {
        await transaction.lessonLedgerEntry.create({
          data: {
            campusId: team.campaign.campusId,
            studentId: member.studentId,
            coursePackageId: coursePackage.id,
            entryType: 'GRANT',
            bucket: 'GIFT',
            deltaUnits: benefit.giftUnits,
            balanceBeforeUnits: 0,
            balanceAfterUnits: benefit.giftUnits,
            idempotencyKey: `group-settle:${team.id}:${member.id}:gift`,
            actorUserId: team.campaign.createdByUserId,
            reason: `拼团 ${team.members.length} 人档赠送课时发放`,
            createdAt: settledAt,
          },
        });
      }
      await transaction.enrollmentOrder.update({
        where: { id: member.enrollmentOrderId },
        data: {
          status: 'EFFECTIVE',
          mainUnitsSnapshot: benefit.mainUnits,
          giftUnitsSnapshot: benefit.giftUnits,
          version: { increment: 1 },
        },
      });
      await transaction.groupMember.update({
        where: { id: member.id },
        data: {
          status: 'SETTLED',
          settledAt,
          grantedMainUnits: benefit.mainUnits,
          grantedGiftUnits: benefit.giftUnits,
          version: { increment: 1 },
        },
      });
    }
    await transaction.groupTeam.update({
      where: { id: team.id },
      data: {
        status: 'SETTLED',
        paidMemberCount: team.members.length,
        finalTier: team.members.length,
        settledAt,
        version: { increment: 1 },
      },
    });
  }
}
