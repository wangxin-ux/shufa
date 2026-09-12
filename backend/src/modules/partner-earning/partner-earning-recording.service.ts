import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LessonKind } from '../earning/earning-calculator';
import { calculatePartnerEarning } from './partner-earning-calculator';
import {
  PartnerEarningRuleService,
  toPartnerEarningRuleSnapshot,
} from './partner-earning-rule.service';

export interface CompletedPartnerEarningInput {
  campusId: string;
  teachingRecordId: string;
  lessonSessionId: string;
  lessonKind: LessonKind;
  lessonUnits: number;
  completedAt: Date;
}

export interface ReversedPartnerEarningInput {
  teachingRecordId: string;
  reversedAt: Date;
}

@Injectable()
export class PartnerEarningRecordingService {
  constructor(private readonly ruleService: PartnerEarningRuleService) {}

  async recordCompletedLesson(
    transaction: Prisma.TransactionClient,
    input: CompletedPartnerEarningInput,
  ): Promise<void> {
    const existing = await transaction.partnerEarningBasis.findUnique({
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
    const rule = await this.ruleService.findEffectiveRule(
      { campusId: input.campusId, at: input.completedAt },
      transaction,
    );

    if (!rule) {
      await transaction.partnerEarningBasis.create({
        data: {
          campusId: input.campusId,
          teachingRecordId: input.teachingRecordId,
          lessonSessionId: input.lessonSessionId,
          selectedRuleId: null,
          lessonKind: input.lessonKind,
          lessonUnits: input.lessonUnits,
          actualAttendeeCount,
          countedAttendeeCount: 0,
          attendanceSnapshot,
          completedAt: input.completedAt,
          status: 'UNPRICED',
        },
      });
      return;
    }

    const lessonEligible = rule.eligibleLessonKinds.includes(input.lessonKind);
    const countedStatuses = new Set(rule.countedAttendanceStatuses);
    const countedAttendeeCount = lessonEligible
      ? attendance.filter(({ status }) => countedStatuses.has(status)).length
      : 0;
    const calculation = calculatePartnerEarning({
      unitPriceFen: rule.unitPriceFen,
      shareBasisPoints: rule.shareBasisPoints,
      countedAttendeeCount,
    });
    const basis = await transaction.partnerEarningBasis.create({
      data: {
        campusId: input.campusId,
        teachingRecordId: input.teachingRecordId,
        lessonSessionId: input.lessonSessionId,
        selectedRuleId: rule.id,
        lessonKind: input.lessonKind,
        lessonUnits: input.lessonUnits,
        actualAttendeeCount,
        countedAttendeeCount,
        attendanceSnapshot,
        completedAt: input.completedAt,
        status: 'PRICED',
      },
      select: { id: true },
    });
    if (calculation.amountFen === 0) {
      return;
    }

    await transaction.partnerEarningEntry.create({
      data: {
        campusId: input.campusId,
        earningBasisId: basis.id,
        entryType: 'ACCRUAL',
        amountFen: calculation.amountFen,
        status: 'PENDING_REVIEW',
        ruleSnapshot: {
          ...toPartnerEarningRuleSnapshot(rule),
          lessonKind: input.lessonKind,
          lessonUnits: input.lessonUnits,
          actualAttendeeCount,
          countedAttendeeCount,
          perAttendeeAmountFen: calculation.perAttendeeAmountFen,
          calculation: `round(${rule.unitPriceFen}*${rule.shareBasisPoints}/10000)*${countedAttendeeCount}`,
          amountFen: calculation.amountFen,
        },
        reviewableAt: new Date(
          input.completedAt.getTime() +
            rule.settlementDelayDays * 24 * 60 * 60 * 1_000,
        ),
      },
    });
  }

  async recordReversedLesson(
    transaction: Prisma.TransactionClient,
    input: ReversedPartnerEarningInput,
  ): Promise<void> {
    const basis = await transaction.partnerEarningBasis.findUnique({
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
      await transaction.partnerEarningEntry.create({
        data: {
          campusId: original.campusId,
          earningBasisId: original.earningBasisId,
          entryType: 'REVERSAL',
          amountFen: -original.amountFen,
          status: 'REVERSED',
          ruleSnapshot: original.ruleSnapshot as Prisma.InputJsonValue,
          reviewableAt: input.reversedAt,
          reversalOfId: original.id,
        },
      });
      await transaction.partnerEarningEntry.update({
        where: { id: original.id },
        data: { status: 'REVERSED', version: { increment: 1 } },
      });
    }
    await transaction.partnerEarningBasis.update({
      where: { id: basis.id },
      data: { status: 'REVERSED' },
    });
  }
}
