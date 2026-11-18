import type { ParentLessonReview } from '@prisma/client';

export function toParentLessonReviewView(
  review: Pick<
    ParentLessonReview,
    | 'id'
    | 'lessonSessionId'
    | 'studentId'
    | 'teaching'
    | 'communication'
    | 'environment'
    | 'overall'
    | 'note'
    | 'createdAt'
  >,
  lessonStatus: string,
) {
  return {
    id: review.id,
    lessonSessionId: review.lessonSessionId,
    studentId: review.studentId,
    teaching: review.teaching,
    communication: review.communication,
    environment: review.environment,
    overall: review.overall,
    note: review.note,
    createdAt: review.createdAt.toISOString(),
    valid: lessonStatus === 'COMPLETED',
  };
}
