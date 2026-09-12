import {
  buildTeacherEarningRuleModel,
  buildTeacherEarningEntryModel,
  buildTeacherEarningSummaryModel,
  buildTeacherEarningStatusModel,
  buildTeacherWithdrawalModel,
  formatTeacherEarningAmount,
  getTeacherEarningStatusPresentation,
  getTeacherWithdrawalStatusPresentation,
  parseTeacherWithdrawalYuan,
} from '../services/teacher-earnings.presenter';
import { TeacherEarningRuleView } from '../types/teacher';

const rule: TeacherEarningRuleView = {
  id: '81000000-0000-4000-8000-000000000001',
  campusId: '10000000-0000-4000-8000-000000000001',
  teacherId: null,
  basisType: 'PER_COMPLETED_SESSION',
  unitAmountFen: 10000,
  eligibleLessonKinds: ['REGULAR'],
  countedAttendanceStatuses: ['PRESENT'],
  settlementDelayDays: 1,
  version: 1,
  status: 'ACTIVE',
  effectiveFrom: '2026-08-30T00:00:00+08:00',
  effectiveTo: null,
  createdAt: '2026-08-29T08:00:00+08:00',
};

describe('teacher earnings presenter', () => {
  it('formats integer fen as fixed CNY without deriving amounts', () => {
    expect(formatTeacherEarningAmount(10000)).toBe('¥100.00');
    expect(formatTeacherEarningAmount(-10000)).toBe('-¥100.00');
  });

  it('uses deterministic Chinese earning and withdrawal status labels', () => {
    expect(getTeacherEarningStatusPresentation('PENDING_REVIEW')).toEqual({
      label: '待审核',
      tone: 'warning',
    });
    expect(getTeacherEarningStatusPresentation('AVAILABLE').label).toBe(
      '可提现',
    );
    expect(getTeacherEarningStatusPresentation('REJECTED').label).toBe(
      '已驳回',
    );
    expect(getTeacherEarningStatusPresentation('REVERSED').label).toBe(
      '已撤销',
    );

    expect(getTeacherWithdrawalStatusPresentation('SUBMITTED').label).toBe(
      '待审核',
    );
    expect(getTeacherWithdrawalStatusPresentation('APPROVED').label).toBe(
      '已通过',
    );
    expect(getTeacherWithdrawalStatusPresentation('PAYING').label).toBe(
      '打款中',
    );
    expect(getTeacherWithdrawalStatusPresentation('PAID').label).toBe(
      '已完成',
    );
    expect(getTeacherWithdrawalStatusPresentation('CANCELLED').label).toBe(
      '已取消',
    );
    expect(getTeacherWithdrawalStatusPresentation('REJECTED').label).toBe(
      '已驳回',
    );
    expect(getTeacherWithdrawalStatusPresentation('FAILED').label).toBe(
      '打款失败',
    );
  });

  it('presents the configured rule and the unconfigured state truthfully', () => {
    expect(buildTeacherEarningRuleModel(rule)).toEqual({
      configured: true,
      basisLabel: '每完成一课次',
      unitAmount: '¥100.00',
      settlementLabel: '完成后 1 天可审核',
      effectiveFrom: '2026-08-30',
      scopeLabel: '校区默认规则',
    });
    expect(buildTeacherEarningRuleModel(null)).toEqual({
      configured: false,
      basisLabel: '待配置',
      unitAmount: '--',
      settlementLabel: '请联系管理员配置',
      effectiveFrom: '--',
      scopeLabel: '',
    });
  });

  it('converts strict yuan input to integer fen', () => {
    expect(parseTeacherWithdrawalYuan('100')).toEqual({
      ok: true,
      amountFen: 10000,
    });
    expect(parseTeacherWithdrawalYuan('100.50')).toEqual({
      ok: true,
      amountFen: 10050,
    });
    expect(parseTeacherWithdrawalYuan('0')).toEqual({
      ok: false,
      message: '请输入大于 0 的提现金额',
    });
    expect(parseTeacherWithdrawalYuan('100.001')).toEqual({
      ok: false,
      message: '金额最多保留两位小数',
    });
    expect(parseTeacherWithdrawalYuan('一百')).toEqual({
      ok: false,
      message: '请输入正确的提现金额',
    });
  });

  it('builds page-ready summary and immutable ledger rows from server values', () => {
    expect(
      buildTeacherEarningSummaryModel({
        todayEstimatedFen: 1200,
        weekEstimatedFen: 6800,
        monthEstimatedFen: 15200,
        estimatedTotalFen: 20000,
        pendingReviewFen: 10000,
        availableFen: 10000,
        withdrawingFen: 0,
        currency: 'CNY',
      }),
    ).toEqual([
      { key: 'today', label: '今日收益', value: '¥12.00' },
      { key: 'week', label: '本周收益', value: '¥68.00' },
      { key: 'month', label: '本月收益', value: '¥152.00' },
      { key: 'estimated', label: '累计收益', value: '¥200.00' },
    ]);

    expect(
      buildTeacherEarningStatusModel({
        todayEstimatedFen: 1200,
        weekEstimatedFen: 6800,
        monthEstimatedFen: 15200,
        estimatedTotalFen: 20000,
        pendingReviewFen: 10000,
        availableFen: 10000,
        withdrawingFen: 0,
        currency: 'CNY',
      }),
    ).toEqual([
      { key: 'pending', label: '待审核', value: '¥100.00' },
      { key: 'available', label: '可提现', value: '¥100.00' },
      { key: 'withdrawing', label: '提现中', value: '¥0.00' },
    ]);

    expect(
      buildTeacherEarningEntryModel({
        id: 'earning-1',
        campusId: 'campus-1',
        teacherId: 'teacher-1',
        teacherName: '王老师',
        teachingRecordId: 'record-1',
        lessonSessionId: 'lesson-1',
        courseName: '创意美术进阶',
        lessonStartsAt: '2026-08-30T08:00:00+08:00',
        entryType: 'ACCRUAL',
        amountFen: 10000,
        status: 'AVAILABLE',
        basisType: 'PER_COMPLETED_SESSION',
        unitAmountFen: 10000,
        lessonUnits: 100,
        attendeeCount: 3,
        reviewableAt: '2026-08-31T08:00:00+08:00',
        reviewedAt: '2026-08-31T09:00:00+08:00',
        rejectionReason: null,
        createdAt: '2026-08-30T09:00:00+08:00',
        version: 2,
      }),
    ).toMatchObject({
      id: 'earning-1',
      courseName: '创意美术进阶',
      amount: '¥100.00',
      timeLabel: '2026-08-30 08:00',
      basisLabel: '每完成一课次',
      statusLabel: '可提现',
      statusTone: 'success',
    });

    expect(
      buildTeacherWithdrawalModel({
        id: 'withdrawal-1',
        requestNo: 'TX202608300001',
        campusId: 'campus-1',
        teacherId: 'teacher-1',
        teacherName: '王老师',
        amountFen: 10000,
        status: 'SUBMITTED',
        requestedAt: '2026-08-30T10:00:00+08:00',
        reviewedAt: null,
        paidAt: null,
        rejectionReason: null,
        failureReason: null,
        payoutReference: null,
        payoutProofFileId: null,
        version: 1,
      }),
    ).toMatchObject({
      requestNo: 'TX202608300001',
      amount: '¥100.00',
      statusLabel: '待审核',
      canCancel: true,
      version: 1,
    });
  });
});
