import { ApiOperatorDataSource } from '../pages/operator/runtime/data/api-operator-data-source';
import { MockOperatorDataSource } from '../pages/operator/runtime/data/mock-operator-data-source';
import { OperatorService } from '../pages/operator/runtime/services/operator.service';
import { archive, growth } from './operator-student-archive.fixture';

it('reads the approved archive and growth data.items with envelope meta, using only operator GETs', async () => {
  const calls: any[] = [];
  let token = 'synthetic-a';
  const source = new ApiOperatorDataSource({
    baseUrl: 'https://operator.example.test/api/', accessToken: () => token,
    request(options) {
      calls.push(options);
      options.success({ statusCode: 200, data: calls.length === 1
        ? { data: archive, requestId: 'synthetic-archive' }
        : { data: { items: [growth] }, meta: { page: 2, pageSize: 5, total: 7, totalPages: 2 },
          requestId: 'synthetic-growth' } });
    },
  }) as any;
  expect(typeof source.getStudentArchive).toBe('function');
  await expect(source.getStudentArchive('student/one')).resolves.toEqual(archive);
  token = 'synthetic-b';
  await expect(source.getStudentGrowth('student/one', { page: 2, pageSize: 5 })).resolves.toEqual({
    data: [growth], meta: { page: 2, pageSize: 5, total: 7, totalPages: 2 },
  });
  expect(calls.map(({ url, method, header }) => ({ url, method, header }))).toEqual([
    { url: 'https://operator.example.test/api/operators/me/students/student%2Fone/archive',
      method: 'GET', header: { Authorization: 'Bearer synthetic-a' } },
    { url: 'https://operator.example.test/api/operators/me/students/student%2Fone/archive/growth?page=2&pageSize=5',
      method: 'GET', header: { Authorization: 'Bearer synthetic-b' } },
  ]);
});

it('preserves archive errors and empty growth through the real service', async () => {
  const source = new ApiOperatorDataSource({
    baseUrl: 'https://operator.example.test', accessToken: 'synthetic-a',
    request(options) {
      options.success(options.url.includes('/growth')
        ? { statusCode: 200, data: { data: { items: [] },
          meta: { page: 1, pageSize: 5, total: 0, totalPages: 0 }, requestId: 'synthetic-empty' } }
        : { statusCode: 403, data: { code: 'FORBIDDEN' } });
    },
  });
  const service = new OperatorService(source) as any;
  expect(typeof service.loadStudentArchive).toBe('function');
  await expect(service.loadStudentArchive(archive.id)).resolves.toMatchObject({ status: 'error', statusCode: 403 });
  await expect(service.loadStudentGrowth(archive.id, { page: 1, pageSize: 5 })).resolves.toMatchObject({
    status: 'empty', data: { data: [], meta: { total: 0 } },
  });
});

it('keeps null and zero facts, backend warning and explicit age without revealing full birth date', () => {
  const presenter = require('../pages/operator/runtime/services/operator-students.presenter');
  expect(typeof presenter.buildOperatorStudentArchive).toBe('function');
  const model = presenter.buildOperatorStudentArchive({
    ...archive, ageYears: 0,
    enrollmentSummary: { ...archive.enrollmentSummary, receivedAmountFen: null, initialMainUnits: 0 },
  });
  expect(model).toMatchObject({
    ageLabel: '0岁', receivedAmountLabel: '待核对', refundedAmountLabel: '¥0.00',
    initialMainLabel: '0', initialGiftLabel: '待核对',
    mainBalanceLabel: '11', giftBalanceLabel: '2', totalBalanceLabel: '13',
    warningLabel: '课时预警 · 阈值 15 节', attendanceRateLabel: '75%',
  });
  expect(JSON.stringify(model)).not.toMatch(/birthDate|2018|phone|address|accessUrl/);
  expect(presenter.buildOperatorStudentArchive({
    ...archive, ageYears: null, attendance: { ...archive.attendance, attendanceRateBasisPoints: null },
  })).toMatchObject({ ageLabel: '年龄未填写', attendanceRateLabel: '暂无数据' });
});

it('keeps four teacher ratings, legacy performance and parent review authors and validity distinct', () => {
  const presenter = require('../pages/operator/runtime/services/operator-students.presenter');
  expect(typeof presenter.buildOperatorStudentGrowth).toBe('function');
  const model = presenter.buildOperatorStudentGrowth([growth])[0];
  expect(model).toMatchObject({
    feedbackAuthorLabel: '反馈李老师', reviewAuthorLabel: '陈家长',
    legacyRatingLabel: '4星', feedbackStateLabel: '有效反馈', reviewStateLabel: '有效评价',
  });
  expect(model.teacherRatings.map((item: any) => item.value)).toEqual(['0星', '3.5星', '未评分', '4.5星']);
  const reversed = presenter.buildOperatorStudentGrowth([{
    ...growth, lessonStatus: 'REVERSED', feedbackValid: false,
    review: { ...growth.review, valid: false }, feedbackAuthorName: null, reviewAuthorName: null,
  }])[0];
  expect(reversed).toMatchObject({
    lessonStatusLabel: '已撤销', feedbackStateLabel: '反馈已失效', reviewStateLabel: '评价已失效',
    feedbackAuthorLabel: '作者未记录', reviewAuthorLabel: '作者未记录',
  });
});

it('supports deterministic mock archive/growth and refuses unknown or empty-scenario students', async () => {
  const source = new MockOperatorDataSource() as any;
  expect(typeof source.getStudentArchive).toBe('function');
  const id = (await source.listStudents({ page: 1, pageSize: 20 })).data[0].id;
  const result = await source.getStudentArchive(id);
  expect(result).toMatchObject({ id, enrollmentSummary: expect.any(Object), attendance: expect.any(Object) });
  expect(result).not.toHaveProperty('birthDate');
  expect((await source.getStudentGrowth(id, { page: 100, pageSize: 5 })).data).toEqual([]);
  await expect(source.getStudentArchive('foreign-id')).rejects.toMatchObject({ statusCode: 404 });
  const empty = new MockOperatorDataSource({ scenario: 'empty' }) as any;
  await expect(empty.getStudentGrowth(id, { page: 1, pageSize: 5 })).rejects.toMatchObject({ statusCode: 404 });
});
