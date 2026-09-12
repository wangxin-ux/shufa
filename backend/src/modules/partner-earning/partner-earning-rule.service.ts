import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface PartnerEarningRuleCandidate {
  id: string;
  campusId: string;
  scopeKey: string;
  unitPriceFen: number;
  shareBasisPoints: number;
  eligibleLessonKinds: readonly ('REGULAR' | 'MAKEUP' | 'TRIAL')[];
  countedAttendanceStatuses: readonly ('PRESENT' | 'LEAVE' | 'ABSENT')[];
  settlementDelayDays: number;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdAt: Date;
}

export interface PartnerEarningRuleSnapshot {
  ruleId: string;
  ruleVersion: number;
  unitPriceFen: number;
  shareBasisPoints: number;
  eligibleLessonKinds: readonly ('REGULAR' | 'MAKEUP' | 'TRIAL')[];
  countedAttendanceStatuses: readonly ('PRESENT' | 'LEAVE' | 'ABSENT')[];
  settlementDelayDays: number;
}

type RuleReader = Pick<Prisma.TransactionClient, 'partnerEarningRule'>;

@Injectable()
export class PartnerEarningRuleService {
  constructor(private readonly prisma: PrismaService) {}

  async findEffectiveRule(
    input: { campusId: string; at: Date },
    client: RuleReader = this.prisma,
  ): Promise<PartnerEarningRuleCandidate | null> {
    const rules = await client.partnerEarningRule.findMany({
      where: {
        campusId: input.campusId,
        scopeKey: partnerEarningScopeKey(input.campusId),
        status: 'ACTIVE',
        effectiveFrom: { lte: input.at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.at } }],
      },
    });
    if (rules.length > 1) {
      throw new DomainError(
        ErrorCode.EARNING_RULE_OVERLAP,
        'Overlapping partner earning rules',
        409,
        { campusId: input.campusId, ruleIds: rules.map(({ id }) => id) },
      );
    }
    return rules[0] ?? null;
  }
}

export function partnerEarningScopeKey(campusId: string): string {
  return `campus:${campusId}:partner`;
}

export function toPartnerEarningRuleSnapshot(
  rule: PartnerEarningRuleCandidate,
): PartnerEarningRuleSnapshot {
  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    unitPriceFen: rule.unitPriceFen,
    shareBasisPoints: rule.shareBasisPoints,
    eligibleLessonKinds: [...rule.eligibleLessonKinds],
    countedAttendanceStatuses: [...rule.countedAttendanceStatuses],
    settlementDelayDays: rule.settlementDelayDays,
  };
}
