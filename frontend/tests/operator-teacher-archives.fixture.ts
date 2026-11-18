import type {
  OperatorTeacherArchive, OperatorTeacherEvaluationRevision, OperatorTeacherPerformance,
} from '../pages/operator/runtime/types/operator';

export const teacherArchives: OperatorTeacherArchive[] = Array.from({ length: 21 }, (_, index) => ({
  id: `e2000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  displayName: '李老师',
  specialties: ['书法', '国画'],
  classes: [{ id: `e3000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    className: `书法第${index + 1}班`, courseName: '硬笔书法' }],
}));

export const teacherPerformance = (teacherId = teacherArchives[0].id, periodMonth = '2026-10'): OperatorTeacherPerformance => ({
  teacherId, periodMonth, timezone: 'Asia/Shanghai', asOf: `${periodMonth}-28T08:00:00.000Z`,
  scheduledLessonCount: 10, completedLessonCount: 8, completionRateBasisPoints: 8000,
  evaluation: {
    id: 'e4000000-0000-4000-8000-000000000001', teacherId, periodMonth, version: 21,
    teachingRating: 1, communicationRating: 3, attendanceRating: 8, overallRating: 10,
    guidance: '继续加强课堂互动。', authorName: '王校长', canEdit: false,
    createdAt: `${periodMonth}-01T08:00:00.000Z`, updatedAt: `${periodMonth}-28T08:00:00.000Z`,
  },
});

export const teacherRevisions = (periodMonth = '2026-10'): OperatorTeacherEvaluationRevision[] =>
  Array.from({ length: 21 }, (_, index) => ({
    periodMonth, version: 21 - index, teachingRating: 1, communicationRating: 3,
    attendanceRating: 8, overallRating: 10, guidance: `第${21 - index}版指导语`,
    authorName: '原作者王校长', savedAt: `${periodMonth}-28T08:00:00.000Z`,
  }));

export const archivePage = <T>(data: T[], page = 1, total = data.length) => ({
  data, meta: { page, pageSize: 20, total, totalPages: Math.ceil(total / 20) },
  requestId: 'synthetic-d02',
});
