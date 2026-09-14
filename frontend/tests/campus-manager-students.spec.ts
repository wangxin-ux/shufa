import * as fs from 'fs';
import * as path from 'path';
import {
  ApiCampusManagerDataSource,
  CampusManagerHttpRequest,
} from '../data/api-campus-manager-data-source';
import {
  buildCampusManagerStudentItems,
  buildCampusManagerStudentQuery,
  CampusManagerStudentSearchDebouncer,
  mergeCampusManagerStudentItems,
} from '../services/campus-manager-students.presenter';
import {
  CampusManagerStudent,
  CampusManagerStudentDetail,
} from '../types/campus-manager';

const student = (
  overrides: Partial<CampusManagerStudent> = {},
): CampusManagerStudent => ({
  id: 'student-1',
  campusId: 'campus-east',
  displayName: '姓名很长但必须完整可读的学员同学',
  birthDate: '2018-05-16',
  classNames: ['创意基础A班', '周末综合材料班'],
  ...overrides,
});

describe('campus manager students', () => {
  afterEach(() => jest.useRealTimers());

  it('debounces trimmed name search and omits an empty query', () => {
    jest.useFakeTimers();
    const callback = jest.fn();
    const debouncer = new CampusManagerStudentSearchDebouncer(callback, 300);

    debouncer.schedule(' 陈 ');
    jest.advanceTimersByTime(200);
    debouncer.schedule(' 陈晨 ');
    jest.advanceTimersByTime(299);
    expect(callback).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledWith('陈晨');
    expect(buildCampusManagerStudentQuery('   ', 1, 20)).toEqual({
      page: 1,
      pageSize: 20,
    });
    expect(buildCampusManagerStudentQuery(' 陈晨 ', 2, 20)).toEqual({
      page: 2,
      pageSize: 20,
      query: '陈晨',
    });
  });

  it('keeps long names and uses stable Chinese labels', () => {
    expect(
      buildCampusManagerStudentItems([
        student(),
        student({
          id: 'student-2',
          displayName: '安然',
          birthDate: null,
          classNames: [],
        }),
      ]),
    ).toEqual([
      {
        id: 'student-1',
        displayName: '姓名很长但必须完整可读的学员同学',
        birthDateLabel: '2018年5月16日',
        classLabel: '创意基础A班、周末综合材料班',
        statusLabel: '在读',
      },
      {
        id: 'student-2',
        displayName: '安然',
        birthDateLabel: '出生日期未填写',
        classLabel: '暂未分班',
        statusLabel: '在读',
      },
    ]);
  });

  it('replaces page one and appends later pages without duplicates', () => {
    const first = buildCampusManagerStudentItems([student()]);
    const next = buildCampusManagerStudentItems([
      student(),
      student({ id: 'student-2', displayName: '安然' }),
    ]);

    expect(
      mergeCampusManagerStudentItems(first, next, 2).map(({ id }) => id),
    ).toEqual(['student-1', 'student-2']);
    expect(mergeCampusManagerStudentItems(first, next, 1)).toEqual(next);
  });

  it('builds a Chinese student detail summary from scoped lesson facts', () => {
    const presenter = require('../services/campus-manager-students.presenter') as Record<
      string,
      unknown
    >;
    const buildDetail = presenter.buildCampusManagerStudentDetail;
    expect(typeof buildDetail).toBe('function');
    if (typeof buildDetail !== 'function') {
      return;
    }
    const detail: CampusManagerStudentDetail = {
      ...student(),
      mainBalanceUnits: 1050,
      giftBalanceUnits: 200,
      recentAttendanceCount: 8,
      recentConsumedUnits: 825,
    };

    expect(buildDetail(detail)).toEqual({
      id: 'student-1',
      displayName: '姓名很长但必须完整可读的学员同学',
      birthDateLabel: '2018年5月16日',
      classLabel: '创意基础A班、周末综合材料班',
      statusLabel: '在读',
      mainBalanceLabel: '10.5',
      giftBalanceLabel: '2',
      totalBalanceLabel: '12.5',
      attendanceCountLabel: '8',
      consumedUnitsLabel: '8.25',
    });
  });

  it('encodes the scoped list query and student detail path', async () => {
    const requests: Parameters<CampusManagerHttpRequest>[0][] = [];
    const request: CampusManagerHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data:
          requests.length === 1
            ? {
                data: [],
                meta: { page: 2, pageSize: 10, total: 0, totalPages: 0 },
                requestId: 'students-1',
              }
            : { data: student(), requestId: 'student-1' },
      });
    };
    const source = new ApiCampusManagerDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: 'manager-token',
      request,
    });

    await source.listStudents({ page: 2, pageSize: 10, query: '陈 晨' });
    await source.getStudent('student/one');

    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      {
        method: 'GET',
        url:
          'https://example.test/api/campus-managers/me/students?page=2&pageSize=10&query=%E9%99%88%20%E6%99%A8',
      },
      {
        method: 'GET',
        url:
          'https://example.test/api/campus-managers/me/students/student%2Fone',
      },
    ]);
  });

  it('keeps list states, paging, retry and safe fields in the page', () => {
    const root = path.resolve(__dirname, '..');
    const pageDir = path.join(root, 'pages/campus-manager/students');
    const markup = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8');
    const logic = fs.readFileSync(path.join(pageDir, 'index.ts'), 'utf8');
    const styles = fs.readFileSync(path.join(pageDir, 'index.wxss'), 'utf8');
    const app = JSON.parse(
      fs.readFileSync(path.join(root, 'app.json'), 'utf8'),
    ) as { subPackages: Array<{ root: string; pages: string[] }> };
    const pages =
      app.subPackages.find((item) => item.root === 'pages/campus-manager')
        ?.pages ?? [];
    const source = `${markup}\n${logic}`;

    for (const state of ['loading', 'ready', 'empty', 'error', 'forbidden']) {
      expect(source).toContain(state);
    }
    expect(markup).toContain('搜索学员姓名');
    expect(markup).toContain('markTitle="人员"');
    expect(markup).toContain('人员管理');
    expect(markup).toContain('class="roster-tabs"');
    expect(markup).toContain('学员名册');
    expect(markup).toContain('教师名册');
    expect(markup).not.toContain('students-page__create');
    expect(markup).not.toContain('新增学员');
    expect(logic).toContain("wx.redirectTo({ url: '/pages/campus-manager/teachers/index' })");
    expect(logic).toMatch(/onLoad\(options[\s\S]*options\.quick === '1'/);
    expect(logic).toMatch(/onRetry\(\)[\s\S]*loadStudents\(true\)/);
    expect(logic).toContain('loadStudents(false)');
    expect(markup).toContain('bindtap="onStudentTap"');
    expect(logic).toContain('/pages/campus-manager/student-detail/index?id=');
    expect(styles).toContain('var(--campus-manager-touch-min)');
    expect(styles).toMatch(/\.roster-tab[\s\S]*align-items:\s*center[\s\S]*justify-content:\s*center/);
    expect(source).not.toMatch(/item\.(?:parentPhone|phone|mobile)|电话|课包|收费|删除|转校/i);
    expect(pages).toContain('students/index');
  });

  it('registers a stateful student detail page without sensitive or financial fields', () => {
    const root = path.resolve(__dirname, '..');
    const pageDir = path.join(root, 'pages/campus-manager/student-detail');
    expect(fs.existsSync(pageDir)).toBe(true);

    const markup = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8');
    const logic = fs.readFileSync(path.join(pageDir, 'index.ts'), 'utf8');
    const styles = fs.readFileSync(path.join(pageDir, 'index.wxss'), 'utf8');
    const app = JSON.parse(
      fs.readFileSync(path.join(root, 'app.json'), 'utf8'),
    ) as { subPackages: Array<{ root: string; pages: string[] }> };
    const pages =
      app.subPackages.find((item) => item.root === 'pages/campus-manager')
        ?.pages ?? [];
    const source = `${markup}\n${logic}`;

    for (const state of ['loading', 'ready', 'error', 'forbidden']) {
      expect(source).toContain(state);
    }
    expect(logic).toContain('campusManagerService.loadStudent');
    expect(markup).toContain('主课时');
    expect(markup).toContain('赠送课时');
    expect(markup).toContain('累计出勤记录');
    expect(markup).toContain('累计课耗');
    expect(markup).toContain('showBack="{{true}}"');
    expect(styles).toMatch(/\.detail-metrics\s*\{[^}]*grid-template-columns:/s);
    expect(source).not.toMatch(/phone|mobile|手机号|电话|报名金额|实付|学费|收益|提现/i);
    expect(pages).toContain('student-detail/index');
  });
});
