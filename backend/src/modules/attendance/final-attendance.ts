import type { Prisma } from '@prisma/client';

// Saved drafts still determine unfinished/cancelled lesson display.
export const savedOrFinalAttendanceWhere = {
  OR: [
    { includedInFinalRoster: true },
    { lessonSession: { status: { notIn: ['COMPLETED', 'REVERSED'] } } },
  ],
} satisfies Prisma.AttendanceRecordWhereInput;
