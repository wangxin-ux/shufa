import {
  buildPartnerOperationsPageModel,
  buildPartnerPeriodQuery,
} from '../services/partner-operations.presenter';
import { buildPartnerStudentDetailPageModel } from '../services/partner-student-detail.presenter';
import {
  PartnerOperationsSummary,
  PartnerStudentDetail,
} from '../types/partner';

const student: PartnerStudentDetail = {
  id: 'student-1',
  displayName: '林一诺',
  birthDate: '2017-06-18',
  classNames: ['硬笔书法 A 班'],
  mainBalanceUnits: 300,
  giftBalanceUnits: 100,
  totalBalanceUnits: 400,
  classes: [
    {
      id: 'class-1',
      className: '硬笔书法 A 班',
      courseName: '硬笔书法',
      teacherName: '王老师',
    },
  ],
  attendance: {
    presentCount: 1,
    absentCount: 0,
    leaveCount: 0,
    recordedCount: 1,
    attendanceRateBasisPoints: 10000,
  },
  recentAttendance: [
    {
      id: 'attendance-1',
      studentId: 'student-1',
      studentName: '林一诺',
      courseName: '硬笔书法',
      teacherName: '王老师',
      startsAt: '2026-09-01T06:00:00.000Z',
      status: 'PRESENT',
      recordedAt: '2026-09-01T07:30:00.000Z',
    },
  ],
  recentLessonLedger: [
    {
      id: 'ledger-1',
      studentId: 'student-1',
      studentName: '林一诺',
      packageName: '硬笔书法课包',
      entryType: 'CONSUME',
      bucket: 'MAIN',
      deltaUnits: -100,
      balanceBeforeUnits: 400,
      balanceAfterUnits: 300,
      reason: '课程完成扣课',
      createdAt: '2026-09-01T07:30:00.000Z',
    },
  ],
};

const operations: PartnerOperationsSummary = {
  period: 'MONTH',
  anchorDate: '2026-09-01',
  rangeStart: '2026-08-31T16:00:00.000Z',
  rangeEnd: '2026-09-30T16:00:00.000Z',
  consumedLessonUnits: 7200,
  completedLessonCount: 32,
  presentCount: 96,
  absentCount: 2,
  leaveCount: 2,
  recordedCount: 100,
  attendanceRateBasisPoints: 9600,
  teacherMetrics: [
    {
      teacherId: 'teacher-1',
      displayName: '林老师',
      completedLessonCount: 18,
      attendeeCount: 58,
    },
  ],
};

describe('partner operations presentation', () => {
  it('maps the student detail to Chinese read-only sections', () => {
    expect(
      buildPartnerStudentDetailPageModel(student, 'Asia/Shanghai'),
    ).toMatchObject({
      displayName: '林一诺',
      birthDateLabel: '2017年6月18日',
      balances: {
        mainBalanceLabel: '3',
        giftBalanceLabel: '1',
        totalBalanceLabel: '4',
      },
      attendance: {
        attendanceRateLabel: '100%',
        presentCountLabel: '1',
      },
      classes: [
        {
          id: 'class-1',
          className: '硬笔书法 A 班',
          courseName: '硬笔书法',
          teacherLabel: '王老师',
        },
      ],
      recentAttendance: [
        expect.objectContaining({
          statusLabel: '到课',
          lessonLabel: '9月1日 14:00 · 硬笔书法',
        }),
      ],
      recentLessonLedger: [
        expect.objectContaining({
          typeLabel: '完成扣课',
          deltaLabel: '-1',
          balanceAfterLabel: '剩余 3 节',
        }),
      ],
    });
  });

  it('maps server-derived operating totals and teacher teaching metrics', () => {
    expect(buildPartnerPeriodQuery('MONTH', '2026-09-01')).toEqual({
      period: 'MONTH',
      anchorDate: '2026-09-01',
    });
    expect(buildPartnerOperationsPageModel(operations)).toEqual({
      periodLabel: '2026年9月',
      consumedLessonLabel: '72',
      completedLessonCountLabel: '32',
      attendanceRateLabel: '96%',
      presentCountLabel: '96',
      absentCountLabel: '2',
      leaveCountLabel: '2',
      recordedCountLabel: '100',
      teacherMetrics: [
        {
          teacherId: 'teacher-1',
          displayName: '林老师',
          completedLessonCountLabel: '18 节',
          attendeeCountLabel: '58 人次',
        },
      ],
    });
  });
});
