import * as fs from 'fs';
import * as path from 'path';
import {
  buildCampusManagerHomePageModel,
  CAMPUS_MANAGER_HOME_ACTIONS,
  resolveCampusManagerHomeAction,
} from '../services/campus-manager-home.presenter';
import { CampusManagerDashboard } from '../types/campus-manager';

const dashboard: CampusManagerDashboard = {
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
    expect(buildCampusManagerHomePageModel(dashboard)).toEqual({
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
      buildCampusManagerHomePageModel({
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
    expect(CAMPUS_MANAGER_HOME_ACTIONS.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'schedule', label: '排课管理' },
      { key: 'approvals', label: '请假审批' },
      { key: 'warnings', label: '预警名单' },
      { key: 'students', label: '人员管理' },
    ]);
  });

  it.each([
    ['schedule', '/pages/campus-manager/schedule/index'],
    ['approvals', '/pages/campus-manager/leave-requests/index'],
    ['warnings', '/pages/campus-manager/warnings/index'],
    ['student-create', '/pages/campus-manager/students/index?quick=1'],
    ['students', '/pages/campus-manager/students/index'],
    ['settings', '/pages/campus-manager/campus-settings/index'],
    ['profile', '/pages/campus-manager/profile/index'],
    ['more', '/pages/campus-manager/profile/index'],
  ])('maps %s to its planned manager route', (key, url) => {
    expect(resolveCampusManagerHomeAction(key)).toEqual({ kind: 'navigate', url });
  });

  it('rejects unknown commands with a Chinese message', () => {
    expect(resolveCampusManagerHomeAction('unknown')).toEqual({
      kind: 'unavailable',
      message: '入口暂不可用',
    });
  });

  it('keeps the standard page dynamic, stateful, and free of banned branding', () => {
    const pageDir = path.resolve(__dirname, '../pages/campus-manager/home');
    const wxml = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8');
    const wxss = fs.readFileSync(path.join(pageDir, 'index.wxss'), 'utf8');
    const json = fs.readFileSync(path.join(pageDir, 'index.json'), 'utf8');
    const source = [wxml, wxss, json].join('\n');

    for (const state of ['loading', 'ready', 'empty', 'error', 'forbidden']) {
      expect(source).toContain(state);
    }
    expect(wxml).toContain('/pages/campus-manager/assets/home-character.png');
    expect(wxml).toContain('campus-manager-stat-strip');
    expect(wxml).toContain("item.key === 'students' ? 'quick-action--active' : ''");
    expect(wxml).toContain('data-key="student-create"');
    expect(wxml).toContain('>快捷录入</button>');
    expect(wxml).toContain('data-key="settings"');
    expect(wxml).toContain('data-key="profile"');
    expect(wxss).toContain('var(--campus-manager-touch-min)');
    expect(wxss).toMatch(/pointer-events:\s*none/);
    expect(source).not.toMatch(/凯曼|教育赋能|Kaiman|Education Empowerment/i);
  });
});
