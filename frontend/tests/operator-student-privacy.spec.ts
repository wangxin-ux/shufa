import { ApiOperatorDataSource } from '../pages/operator/runtime/data/api-operator-data-source';
import { MockOperatorDataSource } from '../pages/operator/runtime/data/mock-operator-data-source';

it('projects the approved age in list and basic detail and drops an unexpected full birthday', async () => {
  const raw = {
    id: 'synthetic-student', displayName: '陈晨', campusId: 'synthetic-campus', classNames: [],
    ageYears: 0, birthDate: '2026-01-01', phone: 'forbidden',
    mainBalanceUnits: 0, giftBalanceUnits: 0, recentAttendanceCount: 0, recentConsumedUnits: 0,
  };
  const source = new ApiOperatorDataSource({
    baseUrl: 'https://operator.example.test', accessToken: 'synthetic-token',
    request: (options) => options.success({ statusCode: 200, data: {
      data: options.url.includes('?') ? [raw] : raw,
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    } }),
  });
  const list = await source.listStudents({ page: 1, pageSize: 20 });
  const detail = await source.getStudent(raw.id);
  expect(list.data[0]).toMatchObject({ ageYears: 0 });
  expect(detail).toMatchObject({ ageYears: 0 });
  expect(JSON.stringify([list, detail])).not.toMatch(/birthDate|2026-01-01|phone|forbidden/);
});

it('keeps birthday only in the creation input and returns age in the mock read models', async () => {
  const source = new MockOperatorDataSource();
  const created = await source.createStudent({
    displayName: '测试新学员', birthDate: '2018-05-16', classGroupId: null,
  }, 'synthetic-create-age');
  const list = await source.listStudents({ page: 1, pageSize: 20 });
  const detail = await source.getStudent(created.id);
  expect(created).toMatchObject({ ageYears: 8 });
  expect(detail).toMatchObject({ ageYears: 8 });
  expect(JSON.stringify([created, list, detail])).not.toContain('birthDate');
});
