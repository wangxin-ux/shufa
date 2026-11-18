import * as fs from 'fs';
import * as path from 'path';
import {
  buildTeacherProfilePageModel,
  resolveTeacherProfileAction,
  teacherAvatarInitial,
  TEACHER_PROFILE_ACTIONS,
  TEACHER_PRIMARY_PROFILE_ACTIONS,
  TEACHER_MORE_PROFILE_ACTIONS,
} from '../services/teacher-profile.presenter';

describe('teacher profile presenter', () => {
  it('uses API identity fields and supports long names', () => {
    const model = buildTeacherProfilePageModel({
      displayName: '林老师名字很长但仍需完整显示',
      subjectLabel: '综合材料创作与跨学科艺术课程',
      campusName: '城东青少年成长中心旗舰校区',
      responsibleStudentCount: 135,
      roleCode: 'TEACHER',
    });

    expect(model).toEqual({
      displayName: '林老师名字很长但仍需完整显示',
      avatarInitial: '林',
      subjectLabel: '综合材料创作与跨学科艺术课程',
      subjectLines: ['综合材料创作与跨学科艺术课程'],
      campusName: '城东青少年成长中心旗舰校区',
      studentCount: '135',
      studentCountCompact: true,
    });
  });

  it('derives the avatar badge from the first visible character only', () => {
    expect(teacherAvatarInitial('  周敏')).toBe('周');
    expect(teacherAvatarInitial('周')).toBe('周');
    expect(teacherAvatarInitial('')).toBe('师');
    expect(teacherAvatarInitial('   ')).toBe('师');
    // 代理对字符不能被截成半个汉字（Array.from 按码点切分）
    expect(teacherAvatarInitial('𠮷老师')).toBe('𠮷');
  });

  it('splits multiple course names into deliberate rows', () => {
    expect(
      buildTeacherProfilePageModel({
        displayName: '林老师',
        subjectLabel: '创意基础 / 团体创意工坊',
        campusName: '启明东校区',
        responsibleStudentCount: 2,
        roleCode: 'TEACHER',
      }).subjectLines,
    ).toEqual(['创意基础', '团体创意工坊']);
  });

  it('keeps a zero student count explicit', () => {
    expect(
      buildTeacherProfilePageModel({
        displayName: '林老师',
        subjectLabel: '美术',
        campusName: '城东校区',
        responsibleStudentCount: 0,
        roleCode: 'TEACHER',
      }).studentCount,
    ).toBe('0');
  });

  it('keeps the active teacher commands without a separate account-settings entry', () => {
    expect(TEACHER_PROFILE_ACTIONS.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: 'schedule', label: '我的课表' },
      { key: 'students', label: '我的学员' },
      { key: 'feedback', label: '课堂反馈' },
      { key: 'ledger', label: '扣课记录' },
      { key: 'earnings', label: '我的收益' },
      { key: 'group-campaigns', label: '活动中心' },
    ]);

    expect(resolveTeacherProfileAction('schedule')).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/schedule/index',
    });
    expect(resolveTeacherProfileAction('students')).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/students/index',
    });
    expect(resolveTeacherProfileAction('feedback')).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/feedback/index',
    });
    expect(resolveTeacherProfileAction('ledger')).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/ledger/index',
    });
    expect(resolveTeacherProfileAction('earnings')).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/earnings/index',
    });
    expect(resolveTeacherProfileAction('group-campaigns')).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/group-campaigns/index',
    });
  });

  it('places the shared logout control below the teacher action list', () => {
    const root = path.resolve(__dirname, '..');
    const markup = fs.readFileSync(
      path.join(root, 'pages/teacher/profile/index.wxml'),
      'utf8',
    );
    const config = JSON.parse(
      fs.readFileSync(
        path.join(root, 'pages/teacher/profile/index.json'),
        'utf8',
      ),
    ) as { usingComponents?: Record<string, string> };

    expect(markup).not.toContain('账号设置');
    expect(markup).toContain('<session-logout id="sessionLogout" />');
    expect(markup.indexOf('<session-logout')).toBeGreaterThan(
      markup.indexOf('class="profile-actions"'),
    );
    expect(config.usingComponents?.['session-logout']).toBe(
      '/components/session-logout/session-logout',
    );
  });

  it('keeps the white source page while demoting the mark beside the back control', () => {    const root = path.resolve(__dirname, '..');
    const pageMarkup = fs.readFileSync(
      path.join(root, 'pages/teacher/profile/index.wxml'),
      'utf8',
    );
    const shellMarkup = fs.readFileSync(
      path.join(root, 'components/teacher-page-shell/teacher-page-shell.wxml'),
      'utf8',
    );
    const markStyles = fs.readFileSync(
      path.join(root, 'components/teacher-page-mark/teacher-page-mark.wxss'),
      'utf8',
    );

    expect(pageMarkup).toContain('tone="white"');
    expect(pageMarkup).toContain('plainMark="{{true}}"');
    expect(shellMarkup).toContain('plain="{{plainMark}}"');
    expect(markStyles).toMatch(
      /\.mark--plain\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s,
    );
  });

  it('keeps the complete subject name visible without an ellipsis', () => {
    const root = path.resolve(__dirname, '..');
    const markup = fs.readFileSync(
      path.join(root, 'pages/teacher/profile/index.wxml'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.join(root, 'pages/teacher/profile/index.wxss'),
      'utf8',
    );
    const subjectRule = styles.match(/\.profile__subject\s*\{([^}]*)\}/s)?.[1] ?? '';

    expect(markup).toContain('aria-label="授课科目"');
    expect(markup).toContain('wx:for="{{subjectLines}}"');
    expect(markup).toContain('{{studentCount}}人');
    expect(styles).toMatch(
      /\.profile__meta\s*\{[^}]*flex-wrap:\s*wrap/s,
    );
    expect(subjectRule).toContain('white-space: normal');
    expect(subjectRule).not.toContain('text-overflow: ellipsis');
  });
});

it('keeps the approved PDF primary order and every existing route in More', () => {
  expect(TEACHER_PRIMARY_PROFILE_ACTIONS.map(item => item.key)).toEqual(["schedule", "students", "earnings"]);
  expect([...TEACHER_PRIMARY_PROFILE_ACTIONS, ...TEACHER_MORE_PROFILE_ACTIONS].map(item => item.key).sort()).toEqual(TEACHER_PROFILE_ACTIONS.map(item => item.key).sort());
});
