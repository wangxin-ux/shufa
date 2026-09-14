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
  },
  serverTime: '2026-08-31T08:00:00+08:00',
};

describe('partner home presenter', () => {
  it('builds stable Chinese highlight and operating statistics', () => {
    expect(buildPartnerHomePageModel(dashboard)).toEqual({
      partnerName: '朱元璋', campusName: '启明东校区',
      highlightValue: '4', highlightUnit: '节',
      highlightStudent: '林一诺', highlightClass: '创意美术 A 班',
      highlightSummary: '低课时 · 当前 4 节',
      stats: [
        { key: 'students', label: '在读学员', value: '106', unit: '人', compact: true },
        { key: 'consumed', label: '本月课耗', value: '72', unit: '节', compact: false },
        { key: 'attendance', label: '出勤率', value: '96', unit: '%', compact: false },
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
        expect.objectContaining({ value: '--' }),
      ],
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
    expect(source).toContain('data-key="more"');
    expect(source).not.toContain('data-key="lesson-account"');
    expect(source).toContain('data-key="profile"');
    expect(source).toMatch(
      /\.focus__number\s*\{[^}]*position:\s*relative/s,
    );
    expect(source).toMatch(
      /\.focus__unit\s*\{[^}]*position:\s*absolute[^}]*right:[^}]*bottom:/s,
    );
    expect(source).toMatch(
      /\.focus__number\s*\{[^}]*top:\s*20rpx/s,
    );
    expect(source).toMatch(
      /\.focus__label\s*\{[^}]*margin-top:\s*8rpx/s,
    );
    expect(source).toMatch(/pointer-events:\s*none/);
    expect(source).not.toMatch(/凯曼|教育赋能|Kaiman|Empowering Education/i);
  });
});
