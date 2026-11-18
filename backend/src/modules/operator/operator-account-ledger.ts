import { LessonLedgerEntryType, Prisma } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  lessonBalanceSelect,
  summarizeLessonBalances,
} from '../lesson-ledger/lesson-balance';
import {
  partnerLedgerPackageSelect,
  toPartnerLedgerPayment,
} from '../partner/partner-ledger-payment';

type Balance = Prisma.CoursePackageGetPayload<{
  select: typeof lessonBalanceSelect;
}>;

export function accountSourceInvalid(): never {
  throw new DomainError(
    ErrorCode.INTERNAL_SERVER_ERROR,
    '账户来源异常，请稍后重试或联系管理员核对',
    500,
  );
}

export function accountBalances(packages: Balance[]) {
  for (const pack of packages) {
    if (
      Object.values(pack).some(
        (value) => !Number.isSafeInteger(value) || value < 0,
      ) ||
      pack.mainReservedUnits > pack.mainBalanceUnits ||
      pack.giftReservedUnits > pack.giftBalanceUnits
    )
      accountSourceInvalid();
  }
  const result = summarizeLessonBalances(packages);
  if (
    Object.values(result).some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  )
    accountSourceInvalid();
  return result;
}

type Aggregate = {
  entryType: LessonLedgerEntryType;
  bucket: 'MAIN' | 'GIFT';
  delta: bigint;
  invalidCount: bigint;
};

export async function accountActivityTotals(
  tx: Prisma.TransactionClient,
  campusId: string,
) {
  // Keep historical facts even when a student has left; invalid links poison their own bucket.
  const groups = await tx.$queryRaw<Aggregate[]>(Prisma.sql`
    SELECT l."entryType", l."bucket", SUM(l."deltaUnits") AS "delta",
      COUNT(*) FILTER (WHERE
        p."id" IS NULL OR p."campusId" <> l."campusId"
        OR p."studentId" <> l."studentId"
        OR l."balanceBeforeUnits" < 0 OR l."balanceAfterUnits" < 0
        OR l."balanceBeforeUnits"::bigint + l."deltaUnits"::bigint <> l."balanceAfterUnits"::bigint
        OR (l."entryType" IN ('GRANT', 'REVERSAL') AND l."deltaUnits" <= 0)
        OR (l."entryType" IN ('CONSUME', 'REFUND', 'CORRECTION') AND l."deltaUnits" >= 0)
      ) AS "invalidCount"
    FROM "LessonLedgerEntry" l
    LEFT JOIN "CoursePackage" p ON p."id" = l."coursePackageId"
    WHERE l."campusId" = ${campusId}::uuid
    GROUP BY l."entryType", l."bucket"
  `);
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  const value = (type: LessonLedgerEntryType, bucket: 'MAIN' | 'GIFT') => {
    const group = groups.find(
      (row) => row.entryType === type && row.bucket === bucket,
    );
    if (!group) return 0;
    return group.invalidCount !== 0n ||
      group.delta > limit ||
      group.delta < -limit
      ? null
      : Number(group.delta);
  };
  return Object.values(LessonLedgerEntryType).map((entryType) => {
    const mainDeltaUnits = value(entryType, 'MAIN');
    const giftDeltaUnits = value(entryType, 'GIFT');
    const total =
      mainDeltaUnits === null || giftDeltaUnits === null
        ? null
        : mainDeltaUnits + giftDeltaUnits;
    return {
      entryType,
      mainDeltaUnits,
      giftDeltaUnits,
      totalDeltaUnits: Number.isSafeInteger(total) ? total : null,
    };
  });
}

export const accountLedgerSelect = {
  id: true,
  studentId: true,
  subjectId: true,
  subjectName: true,
  entryType: true,
  bucket: true,
  deltaUnits: true,
  balanceBeforeUnits: true,
  balanceAfterUnits: true,
  reason: true,
  createdAt: true,
  student: { select: { displayName: true } },
  coursePackage: { select: partnerLedgerPackageSelect },
  lessonSession: {
    select: {
      campusId: true,
      startsAt: true,
      classGroup: { select: { campusId: true, courseName: true } },
      teacher: {
        select: { campusId: true, user: { select: { displayName: true } } },
      },
    },
  },
} satisfies Prisma.LessonLedgerEntrySelect;

type LedgerRow = Prisma.LessonLedgerEntryGetPayload<{
  select: typeof accountLedgerSelect;
}>;

export function toAccountLedgerRow(campusId: string, entry: LedgerRow) {
  if (
    entry.coursePackage.campusId !== campusId ||
    entry.coursePackage.studentId !== entry.studentId ||
    !Number.isSafeInteger(entry.deltaUnits) ||
    !Number.isSafeInteger(entry.balanceBeforeUnits) ||
    !Number.isSafeInteger(entry.balanceAfterUnits) ||
    entry.balanceBeforeUnits < 0 ||
    entry.balanceAfterUnits < 0 ||
    entry.balanceBeforeUnits + entry.deltaUnits !== entry.balanceAfterUnits
  )
    accountSourceInvalid();
  const lesson = entry.lessonSession;
  return {
    id: entry.id,
    studentId: entry.studentId,
    studentName: entry.student.displayName,
    packageName: entry.coursePackage.name,
    subject:
      entry.subjectId && entry.subjectName
        ? { id: entry.subjectId, name: entry.subjectName }
        : null,
    entryType: entry.entryType,
    bucket: entry.bucket,
    deltaUnits: entry.deltaUnits,
    balanceBeforeUnits: entry.balanceBeforeUnits,
    balanceAfterUnits: entry.balanceAfterUnits,
    reason: entry.reason,
    createdAt: entry.createdAt.toISOString(),
    paymentContext: toPartnerLedgerPayment(
      campusId,
      entry.studentId,
      entry.coursePackage,
    ),
    teachingContext:
      lesson?.campusId === campusId &&
      lesson.classGroup.campusId === campusId &&
      lesson.teacher.campusId === campusId
        ? {
            courseName: lesson.classGroup.courseName,
            teacherName: lesson.teacher.user.displayName,
            lessonStartsAt: lesson.startsAt.toISOString(),
          }
        : null,
  };
}
