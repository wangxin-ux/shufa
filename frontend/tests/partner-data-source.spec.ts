import { MockPartnerDataSource } from '../data/mock-partner-data-source';
import { PartnerService } from '../services/partner.service';

describe('partner mock data source and service', () => {
  it('returns deterministic Chinese campus facts', async () => {
    const source = new MockPartnerDataSource();
    await expect(source.getDashboard()).resolves.toMatchObject({
      partner: { displayName: '朱元璋' },
      campus: { name: '启明东校区' },
      highlight: expect.objectContaining({ studentName: '林一诺' }),
    });
    await expect(
      source.listStudents({ page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({ displayName: '林一诺' }),
      ]),
    });
  });

  it('returns honest empty and Chinese failure states', async () => {
    await expect(
      new PartnerService(
        new MockPartnerDataSource({ scenario: 'empty' }),
      ).loadDashboard(),
    ).resolves.toMatchObject({ status: 'empty' });
    await expect(
      new PartnerService(
        new MockPartnerDataSource({ scenario: 'error' }),
      ).loadDashboard(),
    ).resolves.toEqual({
      status: 'error',
      message: '合作方端数据加载失败，请稍后重试',
    });
  });

  it('paginates all six read-only detail collections', async () => {
    const source = new MockPartnerDataSource();
    await expect(
      source.listWarnings({ page: 1, pageSize: 1 }),
    ).resolves.toMatchObject({ meta: { page: 1, pageSize: 1, total: 1 } });
    await expect(
      source.getAttendance({ page: 1, pageSize: 1 }),
    ).resolves.toMatchObject({ meta: { page: 1, pageSize: 1, total: 2 } });
    await expect(
      source.listTeachers({ page: 1, pageSize: 1 }),
    ).resolves.toMatchObject({ meta: { page: 1, pageSize: 1, total: 2 } });
    await expect(
      source.getLessonAccount({ page: 1, pageSize: 1 }),
    ).resolves.toMatchObject({ meta: { page: 1, pageSize: 1, total: 2 } });
  });

  it('loads a scoped student detail and honest empty operations state', async () => {
    const source = new MockPartnerDataSource();
    await expect(source.getStudent('partner-student-1')).resolves.toMatchObject({
      displayName: '林一诺',
      classes: [
        expect.objectContaining({
          courseName: '硬笔书法',
          teacherName: '王老师',
        }),
      ],
      attendance: { presentCount: 1, recordedCount: 1 },
    });
    await expect(source.getStudent('missing-student')).rejects.toMatchObject({
      statusCode: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(
      new PartnerService(
        new MockPartnerDataSource({ scenario: 'empty' }),
      ).loadOperationsSummary({
        period: 'DAY',
        anchorDate: '2026-09-01',
      }),
    ).resolves.toMatchObject({ status: 'empty' });
  });
});
