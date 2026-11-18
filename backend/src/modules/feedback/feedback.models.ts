import type { Prisma } from '@prisma/client';

export interface TeacherFeedbackRatings {
  classroomPerformance: number | null;
  workCompletion: number | null;
  communication: number | null;
  overall: number | null;
}

export function toTeacherFeedbackRatings(value: Prisma.JsonValue | null): TeacherFeedbackRatings | null {
  return value === null ? null : value as unknown as TeacherFeedbackRatings;
}
