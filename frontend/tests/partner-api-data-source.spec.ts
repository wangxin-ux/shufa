import {
  ApiPartnerDataSource,
  PartnerHttpRequest,
} from '../data/api-partner-data-source';

describe('partner API data source', () => {
  it('loads the dashboard with the current bearer token', async () => {
    const requests: Parameters<PartnerHttpRequest>[0][] = [];
    const source = new ApiPartnerDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: () => 'partner-token',
      request: (options) => {
        requests.push(options);
        options.success({
          statusCode: 200,
          data: {
            data: {
              partner: { displayName: '朱元璋' },
              campus: {
                id: 'campus-east',
                code: 'EAST',
                name: '启明东校区',
                timezone: 'Asia/Shanghai',
                lessonWarningThresholdUnits: 500,
              },
              activeStudentCount: 106,
              activeClassCount: 12,
              activeTeacherCount: 8,
              remainingMainUnits: 3700,
              remainingGiftUnits: 1200,
              monthConsumedUnits: 7200,
              attendanceRateBasisPoints: 9600,
              highlight: null,
              serverTime: '2026-08-31T08:00:00+08:00',
            },
            requestId: 'partner-dashboard-1',
          },
        });
      },
    });

    await expect(source.getDashboard()).resolves.toMatchObject({
      partner: { displayName: '朱元璋' },
      campus: { name: '启明东校区' },
    });
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: 'https://example.test/api/partners/me/dashboard',
      header: { Authorization: 'Bearer partner-token' },
    });
  });

  it('encodes search pagination and decodes the page envelope', async () => {
    const requests: Parameters<PartnerHttpRequest>[0][] = [];
    const source = new ApiPartnerDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'partner-token',
      request: (options) => {
        requests.push(options);
        options.success({
          statusCode: 200,
          data: {
            data: [],
            meta: { page: 2, pageSize: 10, total: 0, totalPages: 0 },
            requestId: 'partner-students-1',
          },
        });
      },
    });

    await expect(
      source.listStudents({ page: 2, pageSize: 10, query: '陈 晨' }),
    ).resolves.toEqual({
      data: [],
      meta: { page: 2, pageSize: 10, total: 0, totalPages: 0 },
    });
    expect(requests[0].url).toBe(
      'https://example.test/partners/me/students?page=2&pageSize=10&query=%E9%99%88%20%E6%99%A8',
    );
  });

  it('loads a scoped student detail and period operations without campus parameters', async () => {
    const requests: Parameters<PartnerHttpRequest>[0][] = [];
    const source = new ApiPartnerDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'partner-token',
      request: (options) => {
        requests.push(options);
        options.success({ statusCode: 200, data: { data: {} } });
      },
    });

    await source.getStudent('student / 1');
    await source.getOperationsSummary({
      period: 'QUARTER',
      anchorDate: '2026-09-01',
    });

    expect(requests.map(({ url }) => url)).toEqual([
      'https://example.test/partners/me/students/student%20%2F%201',
      'https://example.test/partners/me/operations-summary?period=QUARTER&anchorDate=2026-09-01',
    ]);
    expect(requests.every(({ url }) => !url.includes('campusId'))).toBe(true);
  });

  it('maps forbidden and internal responses to Chinese messages', async () => {
    const forbidden = new ApiPartnerDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'partner-token',
      request: (options) =>
        options.success({
          statusCode: 403,
          data: { code: 'FORBIDDEN', message: 'Forbidden' },
        }),
    });
    await expect(forbidden.getProfile()).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: '当前账号无合作方端访问权限',
    });

    const internal = new ApiPartnerDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'partner-token',
      request: (options) =>
        options.success({
          statusCode: 500,
          data: { code: 'INTERNAL_SERVER_ERROR', message: 'internal error' },
        }),
    });
    await expect(internal.getDashboard()).rejects.toMatchObject({
      message: '服务器处理失败，请稍后重试',
    });
  });
});
