import { MockOperatorDataSource } from '../pages/operator/runtime/data/mock-operator-data-source';
import { OperatorService } from '../pages/operator/runtime/services/operator.service';

describe('campus manager Mock data source', () => {
  it('returns deterministic Chinese dashboard and profile facts', async () => {
    const source = new MockOperatorDataSource({ scenario: 'normal' });

    await expect(source.getDashboard()).resolves.toMatchObject({
      manager: { displayName: '周园长' },
      campus: { name: '启明东校区' },
      activeStudentCount: 106,
      todayLessonCount: 12,
      pendingLeaveCount: 1,
    });
    await expect(source.getProfile()).resolves.toEqual({
      displayName: '周园长',
      roleCode: 'OPERATOR',
      campusId: '10000000-0000-4000-8000-000000000001',
      campusName: '启明东校区',
    });
  });

  it('returns an honest empty home model', async () => {
    const service = new OperatorService(
      new MockOperatorDataSource({ scenario: 'empty' }),
    );

    await expect(service.loadDashboard()).resolves.toMatchObject({
      status: 'empty',
      data: {
        activeStudentCount: 0,
        todayLessonCount: 0,
        pendingLeaveCount: 0,
        latestPendingLeave: null,
      },
    });
  });

  it('surfaces a Chinese error instead of fake dashboard data', async () => {
    const service = new OperatorService(
      new MockOperatorDataSource({ scenario: 'error' }),
    );

    await expect(service.loadDashboard()).resolves.toEqual({
      status: 'error',
      message: '运营端数据加载失败，请稍后重试',
    });
  });
});
