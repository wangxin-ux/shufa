import * as fs from 'fs';
import * as path from 'path';
import {
  ApiOperatorDataSource,
  OperatorHttpRequest,
} from '../pages/operator/runtime/data/api-operator-data-source';
import {
  buildOperatorStudentItems,
  buildOperatorStudentQuery,
  OperatorStudentSearchDebouncer,
  mergeOperatorStudentItems,
} from '../pages/operator/runtime/services/operator-students.presenter';
import {
  OperatorStudent,
  OperatorStudentDetail,
} from '../pages/operator/runtime/types/operator';

const student = (
  overrides: Partial<OperatorStudent> = {},
): OperatorStudent => ({
  id: 'student-1',
  campusId: 'campus-east',
  displayName: '姓名很长但必须完整可读的学员同学',
  ageYears: 8,
  classNames: ['创意基础A班', '周末综合材料班'],
  ...overrides,
});

describe('campus manager students', () => {
  afterEach(() => jest.useRealTimers());

  it('debounces trimmed name search and omits an empty query', () => {
    jest.useFakeTimers();
    const callback = jest.fn();
    const debouncer = new OperatorStudentSearchDebouncer(callback, 300);

    debouncer.schedule(' 陈 ');
    jest.advanceTimersByTime(200);
    debouncer.schedule(' 陈晨 ');
    jest.advanceTimersByTime(299);
    expect(callback).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledWith('陈晨');
    expect(buildOperatorStudentQuery('   ', 1, 20)).toEqual({
      page: 1,
      pageSize: 20,
    });
    expect(buildOperatorStudentQuery(' 陈晨 ', 2, 20)).toEqual({
      page: 2,
      pageSize: 20,
      query: '陈晨',
    });
  });

  it('keeps long names and uses stable Chinese labels', () => {
    expect(
      buildOperatorStudentItems([
        student(),
        student({
          id: 'student-2',
          displayName: '安然',
          ageYears: null,
          classNames: [],
        }),
      ]),
    ).toEqual([
      {
        id: 'student-1',
        displayName: '姓名很长但必须完整可读的学员同学',
        ageLabel: '8岁',
        classLabel: '创意基础A班、周末综合材料班',
        statusLabel: '在读',
      },
      {
        id: 'student-2',
        displayName: '安然',
        ageLabel: '年龄未填写',
        classLabel: '暂未分班',
        statusLabel: '在读',
      },
    ]);
  });

  it('replaces page one and appends later pages without duplicates', () => {
    const first = buildOperatorStudentItems([student()]);
    const next = buildOperatorStudentItems([
      student(),
      student({ id: 'student-2', displayName: '安然' }),
    ]);

    expect(
      mergeOperatorStudentItems(first, next, 2).map(({ id }) => id),
    ).toEqual(['student-1', 'student-2']);
    expect(mergeOperatorStudentItems(first, next, 1)).toEqual(next);
  });

  it('builds a Chinese student detail summary from scoped lesson facts', () => {
    const presenter = require('../pages/operator/runtime/services/operator-students.presenter') as Record<
      string,
      unknown
    >;
    const buildDetail = presenter.buildOperatorStudentDetail;
    expect(typeof buildDetail).toBe('function');
    if (typeof buildDetail !== 'function') {
      return;
    }
    const detail: OperatorStudentDetail = {
      ...student(),
      mainBalanceUnits: 1050,
      giftBalanceUnits: 200,
      recentAttendanceCount: 8,
      recentConsumedUnits: 825,
    };

    expect(buildDetail(detail)).toEqual({
      id: 'student-1',
      displayName: '姓名很长但必须完整可读的学员同学',
      ageLabel: '8岁',
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
    const requests: Parameters<OperatorHttpRequest>[0][] = [];
    const request: OperatorHttpRequest = (options) => {
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
    const source = new ApiOperatorDataSource({
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
          'https://example.test/api/operators/me/students?page=2&pageSize=10&query=%E9%99%88%20%E6%99%A8',
      },
      {
        method: 'GET',
        url:
          'https://example.test/api/operators/me/students/student%2Fone',
      },
    ]);
  });

  it('keeps list states, paging, retry and safe fields in the page', () => {
    const root = path.resolve(__dirname, '..');
    const pageDir = path.join(root, 'pages/operator/students');
    const markup = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8');
    const logic = fs.readFileSync(path.join(pageDir, 'index.ts'), 'utf8');
    const styles = fs.readFileSync(path.join(pageDir, 'index.wxss'), 'utf8');
    const app = JSON.parse(
      fs.readFileSync(path.join(root, 'app.json'), 'utf8'),
    ) as { subPackages: Array<{ root: string; pages: string[] }> };
    const pages =
      app.subPackages.find((item) => item.root === 'pages/operator')
        ?.pages ?? [];
    const source = `${markup}\n${logic}`;

    for (const state of ['loading', 'ready', 'empty', 'error', 'forbidden']) {
      expect(source).toContain(state);
    }
    expect(markup).toContain('搜索学员姓名');
    expect(markup).toContain('markTitle="档案"');
    expect(markup).toContain('人员管理');
    expect(markup).toContain('class="roster-tabs"');
    expect(markup).toContain('学员名册');
    expect(markup).toContain('教师名册');
    expect(markup).not.toContain('students-page__create');
    expect(markup).not.toContain('新增学员');
    expect(logic).toContain("wx.redirectTo({ url: '/pages/operator/teachers/index' })");
    expect(logic).toMatch(/onLoad\(options[\s\S]*options\.quick === '1'/);
    expect(logic).toMatch(/onRetry\(\)[\s\S]*loadStudents\(true\)/);
    expect(logic).toContain('loadStudents(false)');
    expect(markup).toContain('bindtap="onStudentTap"');
    expect(logic).toContain('/pages/operator/student-detail/index?id=');
    expect(styles).toContain('var(--operator-touch-min)');
    expect(styles).toMatch(/\.roster-tab[\s\S]*align-items:\s*center[\s\S]*justify-content:\s*center/);
    expect(source).not.toMatch(/item\.(?:parentPhone|phone|mobile)|电话|课包|收费|删除|转校/i);
    expect(pages).toContain('students/index');
  });

  it('registers a read-only archive with approved facts and local protected images', () => {
    const root = path.resolve(__dirname, '..');
    const pageDir = path.join(root, 'pages/operator/student-detail');
    expect(fs.existsSync(pageDir)).toBe(true);

    const markup = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8');
    const logic = fs.readFileSync(path.join(pageDir, 'index.ts'), 'utf8');
    const styles = fs.readFileSync(path.join(pageDir, 'index.wxss'), 'utf8');
    const app = JSON.parse(
      fs.readFileSync(path.join(root, 'app.json'), 'utf8'),
    ) as { subPackages: Array<{ root: string; pages: string[] }> };
    const pages =
      app.subPackages.find((item) => item.root === 'pages/operator')
        ?.pages ?? [];
    const source = `${markup}\n${logic}`;

    for (const state of ['loading', 'ready', 'error', 'forbidden']) {
      expect(source).toContain(state);
    }
    expect(logic).toContain('OperatorPageContext');
    expect(markup).toContain('主课时');
    expect(markup).toContain('赠送课时');
    expect(markup).toContain('有效出勤');
    expect(markup).toContain('报名实收');
    expect(markup).toContain('实际退款');
    expect(markup).toContain('原始购买');
    expect(markup).toContain('成长档案');
    expect(markup).toContain('教师反馈');
    expect(markup).toContain('家长评价');
    expect(markup).toContain('showBack="{{true}}"');
    expect(styles).toMatch(/\.detail-metrics\s*\{[^}]*grid-template-columns:/s);
    expect(source).not.toMatch(/\bphone\b|\bmobile\b|手机号|电话|收益|提现|birthDate/i);
    expect(markup).not.toContain('accessUrl');
    expect(markup).toMatch(/src="{{photo\.localPath}}"/);
    expect(markup).toMatch(/src="{{picture\.localPath}}"/);
    expect(pages).toContain('student-detail/index');
  });
});
