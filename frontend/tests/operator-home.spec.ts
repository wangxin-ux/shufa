import * as fs from 'fs';
import * as path from 'path';
import {
  buildOperatorHomePageModel,
  OPERATOR_HOME_ACTIONS,
  resolveOperatorHomeAction,
} from '../pages/operator/runtime/services/operator-home.presenter';
import { OperatorDashboard } from '../pages/operator/runtime/types/operator';

const dashboard: OperatorDashboard = {
  manager: { displayName: '周园长' },
  campus: {
    id: '10000000-0000-4000-8000-000000000001',
    name: '启明青少年成长中心旗舰校区',
  },
  activeStudentCount: 106,
  todayLessonCount: 12,
  pendingLeaveCount: 2,
  latestPendingLeave: {
    id: 'leave-1',
    studentName: '陈晨',
    courseName: '创意基础',
    startsAt: '2026-08-30T14:00:00+08:00',
  },
  serverTime: '2026-08-30T08:00:00+08:00',
};

describe('campus manager home presenter', () => {
  it('builds stable Chinese statistics and pending-leave content', () => {
    expect(buildOperatorHomePageModel(dashboard)).toEqual({
      managerName: '周园长',
      campusName: '启明青少年成长中心旗舰校区',
      pendingCount: '2',
      pendingUnit: '请假',
      latestLabel: '最近审批 陈晨请假申请',
      latestStatus: '待审批请假',
      latestLeaveId: 'leave-1',
      stats: [
        { key: 'students', label: '在读学员', value: '106', unit: '人', compact: true },
        { key: 'lessons', label: '今日课程', value: '12', unit: '节', compact: false },
        { key: 'pending', label: '待处理事项', value: '2', unit: '件', compact: false },
      ],
    });
  });

  it('keeps the empty dashboard truthful without inventing approval data', () => {
    expect(
      buildOperatorHomePageModel({
        ...dashboard,
        activeStudentCount: 0,
        todayLessonCount: 0,
        pendingLeaveCount: 0,
        latestPendingLeave: null,
      }),
    ).toMatchObject({
      pendingCount: '0',
      latestLabel: '最近暂无待审批请假',
      latestStatus: '审批事项已处理',
      latestLeaveId: null,
    });
  });

  it('exposes only the four PSD home shortcuts', () => {
    expect(OPERATOR_HOME_ACTIONS.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'schedule', label: '排课管理' },
      { key: 'approvals', label: '请假审批' },
      { key: 'warnings', label: '预警名单' },
      { key: 'student-create', label: '新增学员' },
    ]);
  });

  it.each([
    ['schedule', '/pages/operator/schedule/index'],
    ['approvals', '/pages/operator/leave-requests/index'],
    ['warnings', '/pages/operator/warnings/index'],
    ['student-create', '/pages/operator/students/index?quick=1'],
    ['students', '/pages/operator/students/index'],
    ['teacher-archives', '/pages/operator/teacher-archives/index'],
    ['rankings', '/pages/operator/rankings/index'],
    ['lesson-account', '/pages/operator/lesson-account/index'],
    ['settings', '/pages/operator/campus-settings/index'],
    ['profile', '/pages/operator/profile/index'],
    ['more', '/pages/operator/profile/index'],
  ])('maps %s to its planned manager route', (key, url) => {
    expect(resolveOperatorHomeAction(key)).toEqual({ kind: 'navigate', url });
  });

  it('rejects unknown commands with a Chinese message', () => {
    expect(resolveOperatorHomeAction('unknown')).toEqual({
      kind: 'unavailable',
      message: '入口暂不可用',
    });
  });

  it('keeps the standard page dynamic, stateful, and free of banned branding', () => {
    const pageDir = path.resolve(__dirname, '../pages/operator/home');
    const wxml = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8');
    const wxss = fs.readFileSync(path.join(pageDir, 'index.wxss'), 'utf8');
    const json = fs.readFileSync(path.join(pageDir, 'index.json'), 'utf8');
    const source = [wxml, wxss, json].join('\n');

    for (const state of ['loading', 'ready', 'empty', 'error', 'forbidden']) {
      expect(source).toContain(state);
    }
    expect(wxml).toContain('/pages/operator/assets/home-character.png');
    expect(wxml).toContain('operator-stat-strip');
    expect(wxml).toContain("item.key === 'student-create' ? 'quick-action--active' : ''");
    expect(wxml).toContain("item.key === 'student-create'");
    expect(wxml).toContain("menuExpanded ? '收起菜单' : '查看更多'");
    expect(wxml).toContain('data-key="settings"');
    expect(wxml).toContain('data-key="profile"');
    expect(wxss).toContain('var(--operator-touch-min)');
    expect(wxss).toMatch(/pointer-events:\s*none/);
    expect(source).not.toMatch(/凯曼|教育赋能|Kaiman|Education Empowerment/i);
  });
});
