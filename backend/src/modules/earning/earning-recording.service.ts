import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  calculateTeacherEarningForRule,
  type LessonKind,
} from './earning-calculator';
import {
  EarningRuleService,
  toTeacherEarningRuleSnapshot,
} from './earning-rule.service';

export interface CompletedLessonEarningInput {
  campusId: string;
  teacherProfileId: string;
  teachingRecordId: string;
  lessonSessionId: string;
  lessonKind: LessonKind;
  lessonUnits: number;
  completedAt: Date;
}

export interface ReversedLessonEarningInput {
  teachingRecordId: string;
  reversedAt: Date;
}

@Injectable()
export class EarningRecordingService {
  constructor(private readonly earningRuleService: EarningRuleService) {}

  async recordCompletedLesson(
    transaction: Prisma.TransactionClient,
    input: CompletedLessonEarningInput,
  ): Promise<void> {
    const existing = await transaction.teacherEarningBasis.findUnique({
      where: { teachingRecordId: input.teachingRecordId },
      select: { id: true },
    });
    if (existing) {
      return;
    }

    const attendance = await transaction.attendanceRecord.findMany({
      where: {
        campusId: input.campusId,
        lessonSessionId: input.lessonSessionId,
      },
      orderBy: { studentId: 'asc' },
      select: { studentId: true, status: true },
    });
    const attendanceSnapshot = attendance.map(({ studentId, status }) => ({
      studentId,
      status,
    }));
    const actualAttendeeCount = attendance.filter(
      ({ status }) => status === 'PRESENT',
    ).length;
    const rule = await this.earningRuleService.findEffectiveRule(
      {
        campusId: input.campusId,
        teacherProfileId: input.teacherProfileId,
        at: input.completedAt,
      },
      transaction,
    );

    if (!rule) {
      await transaction.teacherEarningBasis.create({
        data: {
          campusId: input.campusId,
          teacherProfileId: input.teacherProfileId,
          teachingRecordId: input.teachingRecordId,
          lessonSessionId: input.lessonSessionId,
          selectedRuleId: null,
          lessonKind: input.lessonKind,
          lessonUnits: input.lessonUnits,
          attendeeCount: actualAttendeeCount,
          attendanceSnapshot,
          completedAt: input.completedAt,
          status: 'UNPRICED',
        },
      });
      return;
    }

    const countedAttendeeCount = attendance.filter(({ status }) =>
      rule.countedAttendanceStatuses.includes(status),
    ).length;
    const amountFen = calculateTeacherEarningForRule({
      basisType: rule.basisType,
      unitAmountFen: rule.unitAmountFen,
      lessonUnits: input.lessonUnits,
      lessonKind: input.lessonKind,
      eligibleLessonKinds: rule.eligibleLessonKinds,
      attendanceStatuses: attendance.map(({ status }) => status),
      countedAttendanceStatuses: rule.countedAttendanceStatuses,
    });
    const basis = await transaction.teacherEarningBasis.create({
      data: {
        campusId: input.campusId,
        teacherProfileId: input.teacherProfileId,
        teachingRecordId: input.teachingRecordId,
        lessonSessionId: input.lessonSessionId,
        selectedRuleId: rule.id,
        lessonKind: input.lessonKind,
        lessonUnits: input.lessonUnits,
        attendeeCount: actualAttendeeCount,
        attendanceSnapshot,
        completedAt: input.completedAt,
        status: 'PRICED',
      },
      select: { id: true },
    });

    if (amountFen === 0) {
      return;
    }

    const snapshot = {
      ...toTeacherEarningRuleSnapshot(rule),
      lessonKind: input.lessonKind,
      lessonUnits: input.lessonUnits,
      attendeeCount: countedAttendeeCount,
      calculation: calculationExpression(
        rule.basisType,
        rule.unitAmountFen,
        input.lessonUnits,
        countedAttendeeCount,
      ),
      amountFen,
    };
    await transaction.teacherEarningEntry.create({
      data: {
        campusId: input.campusId,
        teacherProfileId: input.teacherProfileId,
        earningBasisId: basis.id,
        entryType: 'ACCRUAL',
        amountFen,
        status: 'PENDING_REVIEW',
        ruleSnapshot: snapshot,
        reviewableAt: new Date(
          input.completedAt.getTime() +
            rule.settlementDelayDays * 24 * 60 * 60 * 1_000,
        ),
      },
    });
  }

  async recordReversedLesson(
    transaction: Prisma.TransactionClient,
    input: ReversedLessonEarningInput,
  ): Promise<void> {
    const basis = await transaction.teacherEarningBasis.findUnique({
      where: { teachingRecordId: input.teachingRecordId },
      include: {
        entries: {
          orderBy: { createdAt: 'asc' },
          include: { reversedBy: { select: { id: true } } },
        },
      },
    });
    if (!basis || basis.status === 'REVERSED') {
      return;
    }

    const original = basis.entries.find(
      ({ entryType }) => entryType === 'ACCRUAL',
    );
    if (original && !original.reversedBy) {
      await transaction.teacherEarningEntry.create({
        data: {
          campusId: original.campusId,
          teacherProfileId: original.teacherProfileId,
          earningBasisId: original.earningBasisId,
          entryType: 'REVERSAL',
          amountFen: -original.amountFen,
          status: 'REVERSED',
          ruleSnapshot: original.ruleSnapshot as Prisma.InputJsonValue,
          reviewableAt: input.reversedAt,
          reversalOfId: original.id,
        },
      });
      await transaction.teacherEarningEntry.update({
        where: { id: original.id },
        data: { status: 'REVERSED', version: { increment: 1 } },
      });
    }

    await transaction.teacherEarningBasis.update({
      where: { id: basis.id },
      data: { status: 'REVERSED' },
    });
  }
}

function calculationExpression(
  basisType: string,
  unitAmountFen: number,
  lessonUnits: number,
  attendeeCount: number,
): string {
  if (basisType === 'PER_LESSON_UNIT') {
    return `${unitAmountFen}*${lessonUnits}/100`;
  }
  if (basisType === 'PER_PRESENT_ATTENDEE') {
    return `${unitAmountFen}*${attendeeCount}`;
  }
  return String(unitAmountFen);
}
