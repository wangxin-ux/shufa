import type {
  OperatorTeacherArchive, OperatorTeacherEvaluationRevision, OperatorTeacherPerformance,
} from '../../types/operator';

export const OPERATOR_TEACHER_ARCHIVES: readonly OperatorTeacherArchive[] =
  Array.from({ length: 21 }, (_, index) => ({
    id: `d2000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    displayName: index < 2 ? '李老师' : `王老师${index + 1}`,
    specialties: ['书法', '国画'],
    classes: [{
      id: `d3000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      className: `书法第${index + 1}班`, courseName: '硬笔书法',
    }],
  }));

export function mockTeacherPerformance(teacherId: string, month = '2026-10'): OperatorTeacherPerformance {
  const noPlan = teacherId === OPERATOR_TEACHER_ARCHIVES[1].id;
  return {
    teacherId, periodMonth: month, timezone: 'Asia/Shanghai', asOf: `${month}-28T08:00:00.000Z`,
    scheduledLessonCount: noPlan ? 0 : 10, completedLessonCount: noPlan ? 0 : 8,
    completionRateBasisPoints: noPlan ? null : 8000,
    evaluation: noPlan ? null : {
      id: 'd4000000-0000-4000-8000-000000000001', teacherId, periodMonth: month, version: 21,
      teachingRating: 1, communicationRating: 3, attendanceRating: 8, overallRating: 10,
      guidance: '继续加强课堂互动，保留个别学员的学习反馈。', authorName: '王校长', canEdit: false,
      createdAt: `${month}-01T08:00:00.000Z`, updatedAt: `${month}-28T08:00:00.000Z`,
    },
  };
}

export function mockTeacherRevisions(teacherId: string, month = '2026-10'): OperatorTeacherEvaluationRevision[] {
  if (teacherId === OPERATOR_TEACHER_ARCHIVES[1].id) return [];
  return Array.from({ length: 21 }, (_, index) => ({
    periodMonth: month, version: 21 - index, teachingRating: 1, communicationRating: 3,
    attendanceRating: 8, overallRating: 10, guidance: `第${21 - index}版：继续关注课堂互动和学员进步。`,
    authorName: '王校长', savedAt: `${month}-28T08:00:00.000Z`,
  }));
}
