import * as fs from 'fs';
import * as path from 'path';
import {
  buildPartnerAttendancePageModel,
  mergePartnerAttendanceItems,
} from '../services/partner-attendance.presenter';
import {
  buildPartnerLessonAccountPageModel,
  mergePartnerLessonAccountItems,
} from '../services/partner-lesson-account.presenter';
import {
  buildPartnerProfilePageModel,
  PARTNER_PROFILE_ACTIONS,
  resolvePartnerProfileAction,
} from '../services/partner-profile.presenter';
import {
  buildPartnerStudentItems,
  buildPartnerStudentQuery,
  mergePartnerStudentItems,
  PartnerStudentSearchDebouncer,
} from '../services/partner-students.presenter';
import {
  buildPartnerTeacherItems,
  buildPartnerTeacherQuery,
  mergePartnerTeacherItems,
} from '../services/partner-teachers.presenter';
import {
  buildPartnerWarningItems,
  buildPartnerWarningQuery,
  mergePartnerWarningItems,
} from '../services/partner-warnings.presenter';
import {
  PartnerAttendance,
  PartnerLessonAccount,
  PartnerProfile,
  PartnerStudent,
  PartnerTeacher,
  PartnerWarning,
} from '../types/partner';
import {
  formatPartnerLessonUnits,
  formatPartnerSignedLessonUnits,
} from '../utils/partner-format';

const student = (overrides: Partial<PartnerStudent> = {}): PartnerStudent => ({
  id: 'student-1',
  displayName: '姓名很长但必须完整可读的学员同学',
  birthDate: '2017-06-18',
  classNames: ['创意美术 A 班', '周末综合材料班'],
  mainBalanceUnits: 12300,
  giftBalanceUnits: 450,
  totalBalanceUnits: 12750,
  ...overrides,
});

const warning: PartnerWarning = {
  studentId: 'student-1',
  studentName: '林一诺',
  classNames: ['创意美术 A 班'],
  mainBalanceUnits: 300,
  giftBalanceUnits: 200,
  totalBalanceUnits: 900,
  thresholdUnits: 500,
};

const attendance: PartnerAttendance = {
  presentCount: 18,
  absentCount: 1,
  leaveCount: 1,
  recordedCount: 20,
  attendanceRateBasisPoints: 9000,
  items: [
    {
      id: 'attendance-1',
      studentId: 'student-1',
      studentName: '林一诺',
      courseName: '硬笔书法',
      teacherName: '王老师',
      startsAt: '2026-08-31T06:00:00.000Z',
      status: 'PRESENT',
      recordedAt: '2026-08-31T07:30:00.000Z',
    },
    {
      id: 'attendance-2',
      studentId: 'student-2',
      studentName: '陈晨',
      courseName: '创意基础',
      teacherName: '林老师',
      startsAt: '2026-08-30T06:00:00.000Z',
      status: 'LEAVE',
      recordedAt: '2026-08-30T07:30:00.000Z',
    },
  ],
  meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
};

const teacher: PartnerTeacher = {
  id: 'teacher-1',
  displayName: '名字很长但不应挤坏卡片的林老师',
  employeeCode: 'T-EAST-001',
  specialties: ['创意基础', '团体创意工坊'],
  classNames: ['创意基础班', '团体创意工坊'],
  activeStudentCount: 118,
  monthCompletedLessonCount: 132,
};

const lessonAccount: PartnerLessonAccount = {
  mainBalanceUnits: 3700,
  giftBalanceUnits: 1200,
  totalBalanceUnits: 4900,
  items: [
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
      createdAt: '2026-08-31T07:30:00.000Z',
    },
    {
      id: 'ledger-2',
      studentId: 'student-2',
      studentName: '陈晨',
      packageName: '创意基础课包',
      entryType: 'ADJUSTMENT',
      bucket: 'MAIN',
      deltaUnits: 4800,
      balanceBeforeUnits: 0,
      balanceAfterUnits: 4800,
      reason: null,
      createdAt: '2026-08-23T02:00:00.000Z',
    },
  ],
  meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
};

describe('partner read-only pages', () => {
  afterEach(() => jest.useRealTimers());

  it('formats lesson units without recomputing server balances', () => {
    expect(formatPartnerLessonUnits(4900)).toBe('49');
    expect(formatPartnerLessonUnits(450)).toBe('4.5');
    expect(formatPartnerSignedLessonUnits(-100)).toBe('-1');
    expect(formatPartnerSignedLessonUnits(4800)).toBe('+48');
    expect(buildPartnerWarningItems([warning])[0]).toMatchObject({
      mainBalanceLabel: '3',
      giftBalanceLabel: '2',
      totalBalanceLabel: '9',
      thresholdLabel: '5',
      urgencyLabel: '需关注',
    });
  });

  it('builds searchable, paged student models with long names and three-digit lessons', () => {
    jest.useFakeTimers();
    const callback = jest.fn();
    const debouncer = new PartnerStudentSearchDebouncer(callback, 300);
    debouncer.schedule(' 林 ');
    jest.advanceTimersByTime(200);
    debouncer.schedule(' 林一诺 ');
    jest.advanceTimersByTime(300);
    expect(callback).toHaveBeenCalledWith('林一诺');
    expect(buildPartnerStudentQuery('   ', 1, 20)).toEqual({
      page: 1,
      pageSize: 20,
    });
    expect(buildPartnerStudentQuery(' 林一诺 ', 2, 20)).toEqual({
      page: 2,
      pageSize: 20,
      query: '林一诺',
    });
    expect(buildPartnerStudentItems([student()])).toEqual([
      {
        id: 'student-1',
        displayName: '姓名很长但必须完整可读的学员同学',
        birthDateLabel: '2017年6月18日',
        classLabel: '创意美术 A 班、周末综合材料班',
        mainBalanceLabel: '123',
        giftBalanceLabel: '4.5',
        totalBalanceLabel: '127.5',
      },
    ]);
    const first = buildPartnerStudentItems([student()]);
    const next = buildPartnerStudentItems([
      student(),
      student({ id: 'student-2', displayName: '陈晨' }),
    ]);
    expect(mergePartnerStudentItems(first, next, 2).map(({ id }) => id)).toEqual([
      'student-1',
      'student-2',
    ]);
  });

  it('keeps warning search and paging stable', () => {
    expect(buildPartnerWarningQuery(' 林 ', 2, 10)).toEqual({
      page: 2,
      pageSize: 10,
      query: '林',
    });
    const first = buildPartnerWarningItems([warning]);
    const next = buildPartnerWarningItems([
      warning,
      { ...warning, studentId: 'student-2', studentName: '陈晨' },
    ]);
    expect(
      mergePartnerWarningItems(first, next, 2).map(({ studentId }) => studentId),
    ).toEqual(['student-1', 'student-2']);
  });

  it('maps attendance summary, Chinese statuses and campus-local times', () => {
    const model = buildPartnerAttendancePageModel(attendance, 'Asia/Shanghai');
    expect(model.summary).toEqual({
      attendanceRateLabel: '90%',
      presentCountLabel: '18',
      absentCountLabel: '1',
      leaveCountLabel: '1',
      recordedCountLabel: '20',
    });
    expect(model.items).toEqual([
      expect.objectContaining({
        id: 'attendance-1',
        studentName: '林一诺',
        statusLabel: '到课',
        statusTone: 'success',
        lessonLabel: '8月31日 14:00 · 硬笔书法',
        teacherLabel: '王老师',
      }),
      expect.objectContaining({
        id: 'attendance-2',
        statusLabel: '请假',
        statusTone: 'warning',
      }),
    ]);
    expect(
      mergePartnerAttendanceItems(model.items, model.items, 2),
    ).toHaveLength(2);
  });

  it('maps teacher responsibilities and paged aggregates', () => {
    expect(buildPartnerTeacherQuery(' 林 ', 1, 20)).toEqual({
      page: 1,
      pageSize: 20,
      query: '林',
    });
    expect(buildPartnerTeacherItems([teacher])).toEqual([
      {
        id: 'teacher-1',
        displayName: '名字很长但不应挤坏卡片的林老师',
        employeeCodeLabel: '教师编号 T-EAST-001',
        specialtyLabel: '创意基础、团体创意工坊',
        classLabel: '创意基础班、团体创意工坊',
        activeStudentCountLabel: '118',
        monthCompletedLessonCountLabel: '132',
      },
    ]);
    const item = buildPartnerTeacherItems([teacher])[0];
    expect(mergePartnerTeacherItems([item], [item], 2)).toHaveLength(1);
  });

  it('maps the server ledger into read-only Chinese rows', () => {
    const model = buildPartnerLessonAccountPageModel(
      lessonAccount,
      'Asia/Shanghai',
    );
    expect(model.summary).toEqual({
      mainBalanceLabel: '37',
      giftBalanceLabel: '12',
      totalBalanceLabel: '49',
    });
    expect(model.items).toEqual([
      expect.objectContaining({
        id: 'ledger-1',
        typeLabel: '完成扣课',
        bucketLabel: '主课时',
        deltaLabel: '-1',
        balanceAfterLabel: '剩余 3 节',
        timeLabel: '8月31日 15:30',
        tone: 'negative',
      }),
      expect.objectContaining({
        id: 'ledger-2',
        typeLabel: '课时调整',
        deltaLabel: '+48',
        reasonLabel: '未填写说明',
        tone: 'positive',
      }),
    ]);
    expect(
      mergePartnerLessonAccountItems(model.items, model.items, 2),
    ).toHaveLength(2);
  });

  it('labels refund, grant and receipt-correction lesson entries explicitly', () => {
    const base = lessonAccount.items[0];
    const model = buildPartnerLessonAccountPageModel({
      ...lessonAccount,
      items: [
        {
          ...base,
          id: 'ledger-refund',
          entryType: 'REFUND' as PartnerLessonAccount['items'][number]['entryType'],
        },
        {
          ...base,
          id: 'ledger-grant',
          entryType: 'GRANT' as PartnerLessonAccount['items'][number]['entryType'],
        },
        {
          ...base,
          id: 'ledger-correction',
          entryType: 'CORRECTION' as PartnerLessonAccount['items'][number]['entryType'],
        },
      ],
    });

    expect(model.items.map(({ typeLabel }) => typeLabel)).toEqual([
      '退课扣回',
      '课时发放',
      '收款纠错冲正',
    ]);
  });

  it('keeps profile identity and all confirmed read-only entries', () => {
    const profile: PartnerProfile = {
      displayName: '朱元璋',
      roleCode: 'PARTNER',
      campus: {
        id: 'campus-east',
        code: 'EAST',
        name: '启明东校区',
        timezone: 'Asia/Shanghai',
        lessonWarningThresholdUnits: 500,
        contactPhone: '0731-88886666',
        address: '长沙市岳麓区启明路 18 号',
      },
    };
    expect(buildPartnerProfilePageModel(profile)).toEqual({
      displayName: '朱元璋',
      identityLabel: '合作方',
      campusName: '启明东校区',
      campusCodeLabel: '校区编号 EAST',
      contactPhoneLabel: '0731-88886666',
      addressLabel: '长沙市岳麓区启明路 18 号',
      warningThresholdLabel: '5 节',
    });
    expect(PARTNER_PROFILE_ACTIONS).toEqual([
      { key: 'students', label: '学员档案' },
      { key: 'operations', label: '经营统计' },
      { key: 'warnings', label: '课时预警' },
      { key: 'attendance', label: '出勤统计' },
      { key: 'teachers', label: '教师信息' },
      { key: 'earnings', label: '合作收益' },
      { key: 'group-campaigns', label: '活动中心' },
    ]);
    expect(resolvePartnerProfileAction('earnings')).toEqual({
      kind: 'navigate',
      url: '/pages/partner/earnings/index',
    });
    expect(resolvePartnerProfileAction('operations')).toEqual({
      kind: 'navigate',
      url: '/pages/partner/operations/index',
    });
    expect(resolvePartnerProfileAction('group-campaigns')).toEqual({
      kind: 'navigate',
      url: '/pages/partner/group-campaigns/index',
    });
    expect(JSON.stringify(PARTNER_PROFILE_ACTIONS)).not.toMatch(
      /提现|账单|校区设置|编辑|新增/,
    );
  });

  it('registers nine stateful, responsive and strictly read-only pages', () => {
    const root = path.resolve(__dirname, '..');
    const app = JSON.parse(
      fs.readFileSync(path.join(root, 'app.json'), 'utf8'),
    ) as { subPackages: Array<{ root: string; pages: string[] }> };
    const partnerPages =
      app.subPackages.find((item) => item.root === 'pages/partner')?.pages ?? [];
    const sharedStyles = fs.readFileSync(
      path.join(root, 'styles/partner-workspace.wxss'),
      'utf8',
    );
    for (const page of [
      'students',
      'student-detail',
      'operations',
      'warnings',
      'attendance',
      'teachers',
      'profile',
      'earnings',
    ]) {
      const pageDir = path.join(root, `pages/partner/${page}`);
      const pageSource = ['index.ts', 'index.wxml', 'index.wxss', 'index.json']
        .map((name) => fs.readFileSync(path.join(pageDir, name), 'utf8'))
        .join('\n');
      const source = `${pageSource}\n${sharedStyles}`;
      for (const state of ['loading', 'ready', 'empty', 'error', 'forbidden']) {
        expect(source).toContain(state);
      }
      expect(source).toContain('partner-page-shell');
      expect(source).toContain('showBack="{{true}}"');
      expect(source).toMatch(/max-width:\s*100%|overflow-wrap:\s*anywhere/);
      expect(source).not.toMatch(
        /立即续费|报名金额|完整手机号|家长身份|自营收益|提现|打款|账单|保存校区|课时调整|凯曼|教育赋能|Kaiman|Empowering Education/i,
      );
      expect(partnerPages).toContain(`${page}/index`);
    }
  });

  it('opens student detail from the student card and exposes period controls', () => {
    const root = path.resolve(__dirname, '..');
    const studentsMarkup = fs.readFileSync(
      path.join(root, 'pages/partner/students/index.wxml'),
      'utf8',
    );
    const studentDetailMarkup = fs.readFileSync(
      path.join(root, 'pages/partner/student-detail/index.wxml'),
      'utf8',
    );
    const operationsMarkup = fs.readFileSync(
      path.join(root, 'pages/partner/operations/index.wxml'),
      'utf8',
    );

    expect(studentsMarkup).toContain('bindtap="onStudentTap"');
    expect(studentsMarkup).toContain('data-id="{{item.id}}"');
    expect(studentDetailMarkup).toContain('近期上课');
    expect(studentDetailMarkup).toContain('近期课时流水');
    expect(operationsMarkup).toContain('periodOptions');
    expect(operationsMarkup).toContain('bindchange="onAnchorDateChange"');
  });

  it('exports complete account and profile artwork while excluding the logo', () => {
    const root = path.resolve(__dirname, '..');
    const assetDir = path.join(root, 'pages/partner/assets');
    for (const name of [
      'lesson-account-top-character.png',
      'lesson-account-lower-character.png',
      'lesson-account-mark.png',
      'lesson-account-mark-glyph.png',
      'profile-top-character.png',
      'profile-lower-character.png',
      'profile-mark.png',
      'profile-mark-glyph.png',
    ]) {
      const filePath = path.join(assetDir, name);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.statSync(filePath).size).toBeGreaterThan(512);
      expect(fs.statSync(filePath).size).toBeLessThanOrEqual(500 * 1024);
    }
    const script = fs.readFileSync(
      path.join(root, 'scripts/extract-partner-assets.py'),
      'utf8',
    );
    expect(script).toContain('图层 23');
    expect(script).toContain('图层 13');
    expect(script).toContain('图层 14');
    expect(script).toContain('图层 25');
    expect(script).not.toMatch(/select_layer\([^)]*["'](?:logo|图层 24|图层 18)["']/s);
    const profileLowerExport = script.slice(
      script.indexOf('select_layer(profile_layers, "图层 25"'),
      script.indexOf('profile_mark_source'),
    );
    expect(profileLowerExport).not.toContain('clip_bbox=PROFILE_BBOX');

    const profileLowerPng = fs.readFileSync(
      path.join(assetDir, 'profile-lower-character.png'),
    );
    expect(profileLowerPng.readUInt32BE(16)).toBe(500);
    expect(profileLowerPng.readUInt32BE(20)).toBe(615);
  });

  it('keeps the partner lesson account composition aligned with its PSD', () => {
    const root = path.resolve(__dirname, '..');
    const markup = fs.readFileSync(
      path.join(root, 'pages/partner/lesson-account/index.wxml'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.join(root, 'pages/partner/lesson-account/index.wxss'),
      'utf8',
    );

    expect(markup).toContain('/pages/partner/assets/lesson-account-top-character.png');
    expect(markup).toContain('/pages/partner/assets/lesson-account-lower-character.png');
    expect(markup).toContain('校区课时账户');
    expect(markup).toContain('全校区学员课时合计');
    expect(markup).not.toContain('数据来自课时账本实时汇总');
    expect(markup).toContain('class="account-ledger__aside"');
    expect(markup).toContain('{{item.balanceAfterLabel}}');
    expect(styles).toMatch(
      /\.account-ledger__aside\s*\{[^}]*align-items:\s*flex-end[^}]*justify-content:\s*space-between/s,
    );
    expect(styles).toMatch(
      /\.account-page::before\s*\{[^}]*background:\s*#ffffff/s,
    );
    expect(styles).toMatch(
      /\.account-hero\s*\{[^}]*width:\s*653rpx[^}]*min-height:\s*360rpx[^}]*overflow:\s*visible[^}]*border-radius:\s*32rpx/s,
    );
    expect(styles).toMatch(
      /\.account-hero__character\s*\{[^}]*right:\s*-18rpx[^}]*bottom:\s*0[^}]*width:\s*434rpx/s,
    );
    expect(styles).toMatch(
      /\.account-balances\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*gap:\s*92rpx[^}]*width:\s*653rpx/s,
    );
    expect(styles).toMatch(
      /\.account-balances::after\s*\{[^}]*content:\s*'\+'/s,
    );
    expect(styles).toMatch(
      /\.account-balance\s*\{[^}]*border-radius:\s*32rpx[^}]*background:\s*#ffd75e/s,
    );
    expect(styles).toMatch(
      /\.account-ledger\s*\{[^}]*border-radius:\s*32rpx[^}]*background:\s*rgba\(246,\s*212,\s*104,\s*0\.86\)/s,
    );
  });

  it('explains that warning rules remain manager-configured and read-only', () => {
    const root = path.resolve(__dirname, '..');
    const markup = fs.readFileSync(
      path.join(root, 'pages/partner/warnings/index.wxml'),
      'utf8',
    );
    expect(markup).toContain('预警标准由校区管理员设置');
    expect(markup).not.toMatch(/设置阈值|调整阈值|保存阈值/);
  });

  it('keeps partner profile details after the PSD identity and menu composition', () => {
    const root = path.resolve(__dirname, '..');
    const markup = fs.readFileSync(
      path.join(root, 'pages/partner/profile/index.wxml'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.join(root, 'pages/partner/profile/index.wxss'),
      'utf8',
    );

    expect(markup.indexOf('class="profile-actions-stage"')).toBeGreaterThan(
      markup.indexOf('class="profile-hero"'),
    );
    expect(markup.indexOf('class="profile-details"')).toBeGreaterThan(
      markup.indexOf('class="profile-actions-stage"'),
    );
    expect(styles).toMatch(
      /\.profile-card\s*\{[^}]*border-radius:\s*32rpx[^}]*background:\s*#fe8419/s,
    );
    expect(styles).toMatch(
      /\.profile-actions-stage\s*\{[^}]*margin-top:\s*54rpx/s,
    );
    expect(styles).toMatch(
      /\.profile-actions\s*\{[^}]*width:\s*653rpx[^}]*border-radius:\s*32rpx[^}]*background:\s*rgba\(255,\s*215,\s*94,\s*0\.84\)/s,
    );
    expect(styles).toMatch(
      /\.profile-actions-stage__character\s*\{[^}]*top:\s*110rpx[^}]*left:\s*-32rpx[^}]*width:\s*620rpx/s,
    );
  });
});
