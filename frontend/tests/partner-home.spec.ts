import * as fs from 'fs';
import * as path from 'path';
import {
  buildPartnerHomePageModel,
  PARTNER_HOME_ACTIONS,
  resolvePartnerHomeAction,
} from '../services/partner-home.presenter';
import { PartnerDashboard } from '../types/partner';

const dashboard: PartnerDashboard = {
  partner: { displayName: '朱元璋' },
  campus: {
    id: 'campus-east', code: 'EAST', name: '启明东校区',
    timezone: 'Asia/Shanghai', lessonWarningThresholdUnits: 500,
  },
  activeStudentCount: 106,
  activeClassCount: 12,
  activeTeacherCount: 8,
  remainingMainUnits: 3700,
  remainingGiftUnits: 1200,
  monthConsumedUnits: 7200,
  attendanceRateBasisPoints: 9600,
  highlight: {
    studentId: 'student-1', studentName: '林一诺',
    classNames: ['创意美术 A 班'], mainBalanceUnits: 300,
    giftBalanceUnits: 100, totalBalanceUnits: 400, thresholdUnits: 500,
    classes: [],
    attendance: {
      presentCount: 0, absentCount: 0, leaveCount: 0, recordedCount: 0,
      attendanceRateBasisPoints: null,
    },
  },
  serverTime: '2026-08-31T08:00:00+08:00',
};

describe('partner home presenter', () => {
  it('keeps course and teacher pairs and uses personal rather than campus attendance', () => {
    const model = buildPartnerHomePageModel({
      ...dashboard,
      highlight: {
        ...dashboard.highlight!,
        classes: [
          { id: 'a', className: 'A班', courseName: '创意美术', teacherName: '林老师' },
          { id: 'b', className: 'B班', courseName: '硬笔书法', teacherName: '王老师' },
        ],
        attendance: {
          presentCount: 1, absentCount: 1, leaveCount: 1, recordedCount: 3,
          attendanceRateBasisPoints: 3333,
        },
      } as any,
    });
    expect(model).toMatchObject({
      highlightCourses: [
        { id: 'a', label: '创意美术 · 林老师', className: 'A班' },
        { id: 'b', label: '硬笔书法 · 王老师', className: 'B班' },
      ],
      highlightAttendance: '个人到课 1/3 · 33.33%',
    });
  });

  it.each([null, 0])('distinguishes unknown personal attendance from zero %s', (rate) => {
    const model = buildPartnerHomePageModel({
      ...dashboard,
      highlight: {
        ...dashboard.highlight!,
        classes: [],
        attendance: {
          presentCount: 0, absentCount: rate === null ? 0 : 1,
          leaveCount: 0, recordedCount: rate === null ? 0 : 1,
          attendanceRateBasisPoints: rate,
        },
      } as any,
    });
    expect(model).toMatchObject({
      highlightCourses: [],
      highlightAttendance: rate === null ? '暂无有效出勤' : '个人到课 0/1 · 0%',
    });
  });
  it('builds stable Chinese highlight and operating statistics', () => {
    expect(buildPartnerHomePageModel(dashboard)).toEqual({
      partnerName: '朱元璋', campusName: '启明东校区',
      highlightValue: '4', highlightFontSizeRpx: 152, highlightUnit: '节',
      highlightStudent: '林一诺', highlightClass: '创意美术 A 班',
      highlightSummary: '低课时 · 当前 4 节',
      highlightCourses: [],
      highlightAttendance: '暂无有效出勤',
      stats: [
        { key: 'students', label: '在读学员', value: '106', unit: '人', compact: true },
        { key: 'consumed', label: '本月课耗', value: '72', unit: '节', compact: false },
        { key: 'teachers', label: '授课教师', value: '8', unit: '人', compact: false },
      ],
    });
  });

  it('keeps an empty dashboard truthful', () => {
    expect(buildPartnerHomePageModel({
      ...dashboard, activeStudentCount: 0, monthConsumedUnits: 0,
      attendanceRateBasisPoints: null, highlight: null,
    })).toMatchObject({
      highlightValue: '0', highlightStudent: '暂无课时预警',
      highlightSummary: '当前校区暂无低课时学员',
      stats: [
        expect.objectContaining({ value: '0' }),
        expect.objectContaining({ value: '0' }),
        expect.objectContaining({ value: '8' }),
      ],
    });
  });

  it('does not use the campus name as a student class when no current class exists', () => {
    expect(buildPartnerHomePageModel({
      ...dashboard,
      highlight: { ...dashboard.highlight!, classNames: [], classes: [] },
    })).toMatchObject({
      highlightClass: '暂无在读班级',
      highlightCourses: [],
    });
  });

  it('exposes the four PSD shortcuts and overview entries', () => {
    expect(PARTNER_HOME_ACTIONS.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'warnings', label: '课时预警' },
      { key: 'attendance', label: '出勤统计' },
      { key: 'teachers', label: '教师信息' },
      { key: 'students', label: '学员档案' },
    ]);
    expect(resolvePartnerHomeAction('profile')).toEqual({
      kind: 'navigate', url: '/pages/partner/profile/index',
    });
    expect(resolvePartnerHomeAction('more')).toEqual({
      kind: 'navigate', url: '/pages/partner/group-campaigns/index',
    });
  });

  it('fits multi-digit and fractional balances within a fixed number region', () => {
    for (const units of [99900, 99999, 12345678900]) {
      const model = buildPartnerHomePageModel({
        ...dashboard,
        highlight: { ...dashboard.highlight!, totalBalanceUnits: units },
      });
      expect(model.highlightFontSizeRpx).toBeGreaterThan(0);
      expect(model.highlightFontSizeRpx * model.highlightValue.length * 0.75).toBeLessThanOrEqual(210);
    }
  });

  it('does not send application applicants to campaigns or pretend submission is ready', () => {
    expect(resolvePartnerHomeAction('application')).toEqual({
      kind: 'navigate', url: '/pages/partner/application/index',
    });
  });

  it('keeps the page dynamic, stateful and free of independent branding', () => {
    const pageDir = path.resolve(__dirname, '../pages/partner/home');
    const source = ['index.wxml', 'index.wxss', 'index.json']
      .map((name) => fs.readFileSync(path.join(pageDir, name), 'utf8'))
      .join('\n');
    for (const state of ['loading', 'ready', 'empty', 'error', 'forbidden']) {
      expect(source).toContain(state);
    }
    expect(source).toContain('/pages/partner/assets/home-character.png');
    expect(source).toContain('partner-stat-strip');
    expect(source).toContain('data-key="application"');
    expect(source).not.toContain('data-key="lesson-account"');
    expect(source).toContain('data-key="profile"');
    expect(source).toMatch(
      /\.focus__number\s*\{[^}]*position:\s*relative/s,
    );
    expect(source).toContain('class="focus__student-row"');
    expect(source).not.toContain('class="focus__unit"');
    expect(source).toMatch(
      /\.focus__label\s*\{[^}]*margin-top:\s*14rpx/s,
    );
    expect(source).toMatch(/pointer-events:\s*none/);
    expect(source).not.toMatch(/凯曼|教育赋能|Kaiman|Empowering Education/i);
  });
});
