import {
  ApiCampusManagerDataSource,
  CampusManagerHttpRequest,
} from '../data/api-campus-manager-data-source';

describe('campus manager API data source', () => {
  it('loads dashboard with the current local bearer token', async () => {
    const requests: Parameters<CampusManagerHttpRequest>[0][] = [];
    const request: CampusManagerHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data: {
          data: {
            manager: { displayName: '周园长' },
            campus: { id: 'campus-1', name: '启明东校区' },
            activeStudentCount: 106,
            todayLessonCount: 12,
            pendingLeaveCount: 2,
            latestPendingLeave: null,
            serverTime: '2026-08-30T08:00:00+08:00',
          },
          requestId: 'manager-dashboard-1',
        },
      });
    };
    const source = new ApiCampusManagerDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: () => 'manager-token',
      request,
    });

    await expect(source.getDashboard()).resolves.toMatchObject({
      manager: { displayName: '周园长' },
    });
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: 'https://example.test/api/campus-managers/me/dashboard',
      header: { Authorization: 'Bearer manager-token' },
    });
  });

  it.each([
    [403, 'FORBIDDEN', '当前账号无管理员端访问权限'],
    [500, 'INTERNAL_SERVER_ERROR', '服务器处理失败，请稍后重试'],
  ])('preserves HTTP %i and shows Chinese error text', async (statusCode, code, message) => {
    const request: CampusManagerHttpRequest = (options) => {
      options.success({
        statusCode,
        data: { code, message: 'Internal error', details: {}, requestId: 'error-1' },
      });
    };
    const source = new ApiCampusManagerDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'manager-token',
      request,
    });

    await expect(source.getProfile()).rejects.toMatchObject({
      statusCode,
      code,
      message,
    });
  });
});
