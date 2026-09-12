import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TeacherScope } from '../../common/auth/teacher-scope.service';

export interface LessonBalance {
  mainUnits: number;
  giftUnits: number;
}

export interface BalanceEntry {
  bucket: 'MAIN' | 'GIFT';
  deltaUnits: number;
  balanceAfterUnits: number;
}

export interface ConsumptionPackage {
  id: string;
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  mainReservedUnits?: number;
  giftReservedUnits?: number;
  isActive: boolean;
  validFrom: Date;
  expiresAt: Date | null;
}

export interface PlannedLedgerEntry extends BalanceEntry {
  packageId: string;
  balanceBeforeUnits: number;
}

export class InsufficientLessonBalanceError extends Error {
  constructor(
    public readonly requiredUnits: number,
    public readonly availableUnits: number,
  ) {
    super('The student has insufficient lesson balance');
    this.name = InsufficientLessonBalanceError.name;
  }
}

export function consumeLessonUnits(
  input: LessonBalance,
  requestedUnits: number,
): { entries: BalanceEntry[]; balance: LessonBalance } {
  assertUnits(requestedUnits);
  assertBalance(input.mainUnits, 'mainUnits');
  assertBalance(input.giftUnits, 'giftUnits');
  const availableUnits = input.mainUnits + input.giftUnits;
  if (availableUnits < requestedUnits) {
    throw new InsufficientLessonBalanceError(requestedUnits, availableUnits);
  }

  let remainingUnits = requestedUnits;
  const mainConsumed = Math.min(input.mainUnits, remainingUnits);
  remainingUnits -= mainConsumed;
  const giftConsumed = Math.min(input.giftUnits, remainingUnits);
  const balance = {
    mainUnits: input.mainUnits - mainConsumed,
    giftUnits: input.giftUnits - giftConsumed,
  };
  const entries: BalanceEntry[] = [];
  if (mainConsumed > 0) {
    entries.push({
      bucket: 'MAIN',
      deltaUnits: -mainConsumed,
      balanceAfterUnits: balance.mainUnits,
    });
  }
  if (giftConsumed > 0) {
    entries.push({
      bucket: 'GIFT',
      deltaUnits: -giftConsumed,
      balanceAfterUnits: balance.giftUnits,
    });
  }

  return { entries, balance };
}

export function planPackageConsumption(
  packages: readonly ConsumptionPackage[],
  requestedUnits: number,
  at: Date,
) {
  assertUnits(requestedUnits);
  const eligible = packages
    .filter(
      (coursePackage) =>
        coursePackage.isActive &&
        coursePackage.validFrom <= at &&
        (coursePackage.expiresAt === null || coursePackage.expiresAt >= at),
    )
    .map((coursePackage) => {
      assertBalance(coursePackage.mainBalanceUnits, 'mainBalanceUnits');
      assertBalance(coursePackage.giftBalanceUnits, 'giftBalanceUnits');
      assertReservation(
        coursePackage.mainReservedUnits ?? 0,
        coursePackage.mainBalanceUnits,
      );
      assertReservation(
        coursePackage.giftReservedUnits ?? 0,
        coursePackage.giftBalanceUnits,
      );
      return { ...coursePackage };
    })
    .sort(comparePackageExpiry);
  const availableUnits = eligible.reduce(
    (sum, coursePackage) =>
      sum +
      coursePackage.mainBalanceUnits +
      coursePackage.giftBalanceUnits -
      (coursePackage.mainReservedUnits ?? 0) -
      (coursePackage.giftReservedUnits ?? 0),
    0,
  );
  if (availableUnits < requestedUnits) {
    throw new InsufficientLessonBalanceError(requestedUnits, availableUnits);
  }

  let remainingUnits = requestedUnits;
  const entries: PlannedLedgerEntry[] = [];
  for (const bucket of ['MAIN', 'GIFT'] as const) {
    const balanceKey =
      bucket === 'MAIN' ? 'mainBalanceUnits' : 'giftBalanceUnits';
    for (const coursePackage of eligible) {
      if (remainingUnits === 0) {
        break;
      }
      const balanceBeforeUnits = coursePackage[balanceKey];
      const reservedUnits =
        bucket === 'MAIN'
          ? (coursePackage.mainReservedUnits ?? 0)
          : (coursePackage.giftReservedUnits ?? 0);
      const consumedUnits = Math.min(
        balanceBeforeUnits - reservedUnits,
        remainingUnits,
      );
      if (consumedUnits === 0) {
        continue;
      }

      coursePackage[balanceKey] -= consumedUnits;
      remainingUnits -= consumedUnits;
      entries.push({
        packageId: coursePackage.id,
        bucket,
        deltaUnits: -consumedUnits,
        balanceBeforeUnits,
        balanceAfterUnits: coursePackage[balanceKey],
      });
    }
  }

  return {
    entries,
    packages: eligible.map((coursePackage) => ({
      packageId: coursePackage.id,
      mainBalanceUnits: coursePackage.mainBalanceUnits,
      giftBalanceUnits: coursePackage.giftBalanceUnits,
    })),
  };
}

interface LockedCoursePackage extends ConsumptionPackage {
  version: number;
}

export interface ConsumeStudentLessonUnitsInput {
  scope: TeacherScope;
  studentId: string;
  lessonSessionId: string;
  requestedUnits: number;
  idempotencyKey: string;
  occurredAt: Date;
  reason: string;
}

export interface StudentConsumptionResult {
  studentId: string;
  mainUnits: number;
  giftUnits: number;
}

@Injectable()
export class LessonLedgerService {
  async consumeStudentLessonUnits(
    transaction: Prisma.TransactionClient,
    input: ConsumeStudentLessonUnitsInput,
  ): Promise<StudentConsumptionResult> {
    assertUnits(input.requestedUnits);
    const replay = await transaction.lessonLedgerEntry.findMany({
      where: {
        idempotencyKey: input.idempotencyKey,
        studentId: input.studentId,
        lessonSessionId: input.lessonSessionId,
        entryType: 'CONSUME',
      },
      select: { bucket: true, deltaUnits: true },
    });
    if (replay.length > 0) {
      return this.toConsumptionResult(input.studentId, replay);
    }

    const packages = await transaction.$queryRaw<LockedCoursePackage[]>`
      SELECT
        "id",
        "mainBalanceUnits",
        "giftBalanceUnits",
        "mainReservedUnits",
        "giftReservedUnits",
        "version",
        "isActive",
        "validFrom",
        "expiresAt"
      FROM "CoursePackage"
      WHERE "campusId" = ${input.scope.campusId}::uuid
        AND "studentId" = ${input.studentId}::uuid
        AND "isActive" = true
        AND "validFrom" <= ${input.occurredAt}
        AND ("expiresAt" IS NULL OR "expiresAt" >= ${input.occurredAt})
        AND ("mainBalanceUnits" + "giftBalanceUnits") > 0
      ORDER BY "id" ASC
      FOR UPDATE
    `;
    const plan = planPackageConsumption(
      packages,
      input.requestedUnits,
      input.occurredAt,
    );
    const originalById = new Map(
      packages.map((coursePackage) => [coursePackage.id, coursePackage]),
    );
    for (const balance of plan.packages) {
      const original = originalById.get(balance.packageId);
      if (!original) {
        throw new Error('Locked course package disappeared from the plan');
      }
      if (
        original.mainBalanceUnits === balance.mainBalanceUnits &&
        original.giftBalanceUnits === balance.giftBalanceUnits
      ) {
        continue;
      }

      const update = await transaction.coursePackage.updateMany({
        where: {
          id: original.id,
          campusId: input.scope.campusId,
          studentId: input.studentId,
          version: original.version,
          mainBalanceUnits: original.mainBalanceUnits,
          giftBalanceUnits: original.giftBalanceUnits,
        },
        data: {
          mainBalanceUnits: balance.mainBalanceUnits,
          giftBalanceUnits: balance.giftBalanceUnits,
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) {
        throw new Error('Course package version changed while locked');
      }
    }

    for (const entry of plan.entries) {
      await transaction.lessonLedgerEntry.create({
        data: {
          campusId: input.scope.campusId,
          studentId: input.studentId,
          coursePackageId: entry.packageId,
          lessonSessionId: input.lessonSessionId,
          entryType: 'CONSUME',
          bucket: entry.bucket,
          deltaUnits: entry.deltaUnits,
          balanceBeforeUnits: entry.balanceBeforeUnits,
          balanceAfterUnits: entry.balanceAfterUnits,
          idempotencyKey: input.idempotencyKey,
          actorUserId: input.scope.userId,
          reason: input.reason,
          createdAt: input.occurredAt,
        },
      });
    }

    return this.toConsumptionResult(input.studentId, plan.entries);
  }

  private toConsumptionResult(
    studentId: string,
    entries: ReadonlyArray<{ bucket: 'MAIN' | 'GIFT'; deltaUnits: number }>,
  ): StudentConsumptionResult {
    return {
      studentId,
      mainUnits: entries
        .filter(({ bucket }) => bucket === 'MAIN')
        .reduce((sum, { deltaUnits }) => sum - deltaUnits, 0),
      giftUnits: entries
        .filter(({ bucket }) => bucket === 'GIFT')
        .reduce((sum, { deltaUnits }) => sum - deltaUnits, 0),
    };
  }
}

function assertUnits(units: number): void {
  if (!Number.isInteger(units) || units <= 0) {
    throw new RangeError('Lesson units must be a positive integer');
  }
}

function assertBalance(units: number, field: string): void {
  if (!Number.isInteger(units) || units < 0) {
    throw new RangeError(`${field} must be a non-negative integer`);
  }
}

function assertReservation(reserved: number, balance: number): void {
  assertBalance(reserved, 'reservedUnits');
  if (reserved > balance) {
    throw new RangeError('Reserved units must not exceed the gross balance');
  }
}

function comparePackageExpiry(
  left: ConsumptionPackage,
  right: ConsumptionPackage,
): number {
  const leftExpiry = left.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightExpiry = right.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (leftExpiry !== rightExpiry) {
    return leftExpiry < rightExpiry ? -1 : 1;
  }
  const validFromDifference =
    left.validFrom.getTime() - right.validFrom.getTime();
  return validFromDifference !== 0
    ? validFromDifference
    : left.id.localeCompare(right.id);
}
