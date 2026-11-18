export const archive = {
  id: 'synthetic-student-a', displayName: '陈晨', ageYears: 8, photo: null as null | {
    id: string; mimeType: string; sizeBytes: number; accessUrl: string;
  },
  classes: [{ id: 'synthetic-class-a', className: '创意班', courseName: '创意基础', teacherName: '王老师' }],
  enrollmentSummary: { receivedAmountFen: 123456, refundedAmountFen: 0,
    initialMainUnits: 2000, initialGiftUnits: null as number | null, pendingIssuanceCount: 1 },
  mainBalanceUnits: 1200, giftBalanceUnits: 200, totalBalanceUnits: 1400,
  mainReservedUnits: 100, giftReservedUnits: 0, reservedTotalUnits: 100,
  mainAvailableUnits: 1100, giftAvailableUnits: 200, availableTotalUnits: 1300,
  warningThresholdUnits: 1500, lowBalance: true,
  attendance: { presentCount: 3, absentCount: 1, leaveCount: 0, recordedCount: 4,
    attendanceRateBasisPoints: 7500 as number | null },
  serverTime: '2026-10-27T06:00:00Z',
};

export const image = {
  id: 'synthetic-image-a', mimeType: 'image/png', sizeBytes: 120,
  accessUrl: `/operators/me/students/${archive.id}/archive/media/synthetic-image-a`,
};

export const growth = {
  lessonSessionId: 'synthetic-lesson-a', studentId: archive.id,
  courseName: '创意基础', campusName: '启明东校区', teacherName: '授课王老师',
  startsAt: '2026-10-26T06:00:00Z', lessonStatus: 'COMPLETED' as 'COMPLETED' | 'REVERSED',
  attendanceStatus: 'PRESENT' as 'PRESENT' | 'ABSENT' | 'LEAVE' | null,
  feedback: '能够独立完成作品。' as string | null, performanceRating: 8 as number | null,
  teacherRatings: { classroomPerformance: 0 as number | null, workCompletion: 7 as number | null,
    communication: null as number | null, overall: 9 as number | null },
  feedbackVersion: 2, feedbackAuthorName: '反馈李老师' as string | null, feedbackValid: true,
  review: {
    id: 'synthetic-review-a', lessonSessionId: 'synthetic-lesson-a', studentId: archive.id,
    teaching: 10, communication: 9, environment: 8, overall: 9, note: '孩子很喜欢这节课。',
    createdAt: '2026-10-26T08:00:00Z', valid: true,
  },
  reviewAuthorName: '陈家长' as string | null, feedbackImages: [] as typeof image[],
  feedbackUpdatedAt: '2026-10-26T07:30:00Z' as string | null,
};
