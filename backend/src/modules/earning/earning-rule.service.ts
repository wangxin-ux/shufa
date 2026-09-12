import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  AttendanceStatus,
  LessonKind,
  TeacherEarningBasisType,
} from './earning-calculator';

export interface TeacherEarningRuleCandidate {
  id: string;
  campusId: string;
  teacherProfileId: string | null;
  basisType: TeacherEarningBasisType;
  unitAmountFen: number;
  eligibleLessonKinds: readonly LessonKind[];
  countedAttendanceStatuses: readonly AttendanceStatus[];
  settlementDelayDays: number;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdAt: Date;
}

export interface TeacherEarningRuleSnapshot {
  ruleId: string;
  ruleVersion: number;
  basisType: TeacherEarningBasisType;
  unitAmountFen: number;
  eligibleLessonKinds: readonly LessonKind[];
  countedAttendanceStatuses: readonly AttendanceStatus[];
  settlementDelayDays: number;
}

type RuleReader = Pick<Prisma.TransactionClient, 'teacherEarningRule'>;

@Injectable()
export class EarningRuleService {
  constructor(private readonly prisma: PrismaService) {}

  async findEffectiveRule(
    input: {
      campusId: string;
      teacherProfileId: string;
      at: Date;
    },
    client: RuleReader = this.prisma,
  ): Promise<TeacherEarningRuleCandidate | null> {
    const candidates = await client.teacherEarningRule.findMany({
      where: {
        campusId: input.campusId,
        status: 'ACTIVE',
        effectiveFrom: { lte: input.at },
        AND: [
          {
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.at } }],
          },
          {
            OR: [
              { teacherProfileId: input.teacherProfileId },
              { teacherProfileId: null },
            ],
          },
        ],
      },
    });

    return selectTeacherEarningRule(candidates, input.teacherProfileId);
  }
}

export function selectTeacherEarningRule<T extends TeacherEarningRuleCandidate>(
  rules: readonly T[],
  teacherProfileId: string,
): T | null {
  const teacherRules = rules.filter(
    (rule) => rule.teacherProfileId === teacherProfileId,
  );
  if (teacherRules.length > 1) {
    throw overlappingRuleError('teacher', teacherProfileId, teacherRules);
  }
  if (teacherRules.length === 1) {
    return teacherRules[0];
  }

  const campusRules = rules.filter((rule) => rule.teacherProfileId === null);
  if (campusRules.length > 1) {
    throw overlappingRuleError('campus', rules[0]?.campusId, campusRules);
  }
  return campusRules[0] ?? null;
}

export function toTeacherEarningRuleSnapshot(
  rule: TeacherEarningRuleCandidate,
): TeacherEarningRuleSnapshot {
  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    basisType: rule.basisType,
    unitAmountFen: rule.unitAmountFen,
    eligibleLessonKinds: [...rule.eligibleLessonKinds],
    countedAttendanceStatuses: [...rule.countedAttendanceStatuses],
    settlementDelayDays: rule.settlementDelayDays,
  };
}

function overlappingRuleError(
  scope: 'teacher' | 'campus',
  scopeId: string | undefined,
  rules: readonly TeacherEarningRuleCandidate[],
): DomainError {
  return new DomainError(
    ErrorCode.EARNING_RULE_OVERLAP,
    'Overlapping teacher earning rules',
    409,
    { scope, scopeId, ruleIds: rules.map(({ id }) => id) },
  );
}
