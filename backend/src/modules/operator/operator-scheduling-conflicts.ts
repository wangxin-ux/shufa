import type { Prisma } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';

export async function lockOperatorScheduleResources(
  transaction: Prisma.TransactionClient,
  teacherId: string,
  classGroupId: string,
) {
  // All ordinary operator schedule writers use the same ordered resource locks.
  for (const key of [
    `operator-schedule:class:${classGroupId}`,
    `operator-schedule:teacher:${teacherId}`,
  ].sort()) {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
  }
}

export async function assertOperatorScheduleAvailable(
  transaction: Prisma.TransactionClient,
  input: {
    campusId: string;
    teacherId: string;
    classGroupId: string;
    startsAt: Date;
    endsAt: Date;
    excludeId?: string;
  },
) {
  const conflicts = await transaction.lessonSession.findMany({
    where: {
      campusId: input.campusId,
      status: { not: 'CANCELLED' },
      OR: [
        { teacherId: input.teacherId },
        { classGroupId: input.classGroupId },
      ],
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
    select: { id: true },
    take: 1,
  });
  if (conflicts.length) {
    throw new DomainError(
      ErrorCode.CONFLICT,
      'The teacher or class has an overlapping lesson',
      409,
      {
        conflictDates: [
          new Date(input.startsAt.getTime() + 8 * 3_600_000)
            .toISOString()
            .slice(0, 10),
        ],
      },
    );
  }
}
