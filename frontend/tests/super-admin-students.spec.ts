import * as fs from 'fs';
import * as path from 'path';
import {
  ApiSuperAdminDataSource,
  SuperAdminHttpRequest,
} from '../data/api-super-admin-data-source';

const root = path.resolve(__dirname, '..');

describe('super admin students and packages', () => {
  it('requests the global student page and encoded detail route', async () => {
    const requests: Parameters<SuperAdminHttpRequest>[0][] = [];
    const source = new ApiSuperAdminDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: 'super-token',
      request: (options) => {
        requests.push(options);
        options.success(
          options.url.includes('/student%2Fone')
            ? {
                statusCode: 200,
                data: { data: { id: 'student/one' }, requestId: 'detail-1' },
              }
            : {
                statusCode: 200,
                data: {
                  data: [],
                  meta: { page: 2, pageSize: 10, total: 0, totalPages: 0 },
                },
              },
        );
      },
    }) as unknown as {
      listStudents(query: {
        page: number;
        pageSize: number;
        campusId?: string;
        query?: string;
      }): Promise<unknown>;
      getStudent(id: string): Promise<unknown>;
      updateCoursePackageValidity(
        id: string,
        input: {
          validFrom: string;
          expiresAt: string | null;
          expectedVersion: number;
          reason: string;
        },
        idempotencyKey: string,
      ): Promise<unknown>;
    };

    await source.listStudents({
      page: 2,
      pageSize: 10,
      campusId: 'campus-1',
      query: '陈 晨',
    });
    await source.getStudent('student/one');
    await source.updateCoursePackageValidity(
      'package/one',
      {
        validFrom: '2026-09-01T00:00:00+08:00',
        expiresAt: '2027-08-31T23:59:59.999+08:00',
        expectedVersion: 2,
        reason: '按合同更新有效期',
      },
      'validity-key-1',
    );

    expect(requests.map(({ url }) => url)).toEqual([
      'https://example.test/api/management/students?page=2&pageSize=10&campusId=campus-1&query=%E9%99%88%20%E6%99%A8',
      'https://example.test/api/management/students/student%2Fone',
      'https://example.test/api/management/course-packages/package%2Fone/validity',
    ]);
    expect(requests[2]).toMatchObject({
      method: 'PATCH',
      header: {
        Authorization: 'Bearer super-token',
        'Idempotency-Key': 'validity-key-1',
      },
      data: expect.objectContaining({ expectedVersion: 2 }),
    });
  });

  it('formats backend totals, package states, and the existing adjustment route', () => {
    const presenterPath = path.join(
      root,
      'services/super-admin-students.presenter.ts',
    );
    expect(fs.existsSync(presenterPath)).toBe(true);
    if (!fs.existsSync(presenterPath)) return;
    const presenter = require(presenterPath) as {
      buildSuperAdminStudentItems(input: unknown[]): Array<Record<string, unknown>>;
      buildSuperAdminStudentDetail(input: unknown): Record<string, unknown>;
      resolveSuperAdminStudentsViewState(itemCount: number): 'empty' | 'ready';
      decodeSuperAdminRouteParam(value: string | undefined): string;
      buildSuperAdminStudentAdjustmentUrl(
        packageId: string,
        studentName: string,
        bucket: 'MAIN' | 'GIFT',
      ): string;
    };
    const student = {
      id: 'student-1',
      campusId: 'campus-1',
      campusName: '启明东校区',
      displayName: '陈晨',
      birthDate: '2017-04-12',
      classNames: ['创意基础A班'],
      mainBalanceUnits: 1025,
      giftBalanceUnits: 100,
      totalBalanceUnits: 1125,
      warningThresholdUnits: 500,
      lowBalance: false,
      coursePackages: [
        {
          id: 'package-1',
          name: '创意美术课包',
          mainBalanceUnits: 1025,
          giftBalanceUnits: 100,
          totalBalanceUnits: 1125,
          validFrom: '2026-08-01T00:00:00+08:00',
          expiresAt: '2027-07-31T23:59:59+08:00',
          status: 'ACTIVE',
          version: 3,
        },
      ],
    };

    expect(presenter.buildSuperAdminStudentItems([student])[0]).toMatchObject({
      displayName: '陈晨',
      campusLabel: '启明东校区',
      classLabel: '创意基础A班',
      totalBalanceLabel: '11.25',
      warningLabel: '课时正常',
    });
    expect(presenter.buildSuperAdminStudentDetail(student)).toMatchObject({
      birthDateLabel: '2017年4月12日',
      mainBalanceLabel: '10.25',
      giftBalanceLabel: '1',
      packages: [
        expect.objectContaining({
          statusLabel: '生效中',
          validityLabel: '2026年8月1日 - 2027年7月31日',
          validFromInput: '2026-08-01',
          expiresAtInput: '2027-07-31',
          version: 3,
        }),
      ],
    });
    expect(
      presenter.buildSuperAdminStudentAdjustmentUrl(
        'package/1',
        '陈 晨',
        'GIFT',
      ),
    ).toBe(
      '/pages/super-admin/lesson-adjust/index?packageId=package%2F1&studentName=%E9%99%88%20%E6%99%A8&bucket=GIFT',
    );
    expect(presenter.resolveSuperAdminStudentsViewState(1)).toBe('ready');
    expect(presenter.resolveSuperAdminStudentsViewState(0)).toBe('empty');
    expect(
      presenter.decodeSuperAdminRouteParam('%E9%99%88%20%E6%99%A8'),
    ).toBe('陈 晨');
    expect(presenter.decodeSuperAdminRouteParam('%E9%99')).toBe('%E9%99');
    expect(presenter.decodeSuperAdminRouteParam(undefined)).toBe('');
  });

  it('registers list/detail pages and keeps every command state visible', () => {
    for (const page of ['students', 'student-detail']) {
      const pageDir = path.join(root, 'pages/super-admin', page);
      for (const extension of ['ts', 'json', 'wxml', 'wxss']) {
        expect(fs.existsSync(path.join(pageDir, `index.${extension}`))).toBe(
          true,
        );
      }
    }
    const app = JSON.parse(
      fs.readFileSync(path.join(root, 'app.json'), 'utf8'),
    ) as { subPackages: Array<{ root: string; pages: string[] }> };
    const pages =
      app.subPackages.find(({ root }) => root === 'pages/super-admin')?.pages ??
      [];
    expect(pages).toEqual(
      expect.arrayContaining(['students/index', 'student-detail/index']),
    );

    const list = fs.readFileSync(
      path.join(root, 'pages/super-admin/students/index.wxml'),
      'utf8',
    );
    const detail = fs.readFileSync(
      path.join(root, 'pages/super-admin/student-detail/index.wxml'),
      'utf8',
    );
    const source = `${list}\n${detail}`;
    for (const state of ['loading', 'ready', 'empty', 'error', 'forbidden']) {
      expect(source).toContain(state);
    }
    expect(list).toContain('学员与课包');
    expect(list).toContain('bindtap="onStudentTap"');
    const listScript = fs.readFileSync(
      path.join(root, 'pages/super-admin/students/index.ts'),
      'utf8',
    );
    expect(listScript).toContain('resolveSuperAdminStudentsViewState');
    expect(listScript).not.toMatch(/viewState:\s*state\.status\s*[,}]/);
    expect(detail).toContain('课包明细');
    expect(detail).toContain('bindtap="onAdjustTap"');
    expect(detail).toContain('设置有效期');
    expect(detail).toContain('bindtap="onValidityTap"');
    expect(detail).toContain('bindtap="onValiditySubmit"');
    expect(source).not.toMatch(/停课|报名金额|收费|删除|真实支付/);
  });
});
