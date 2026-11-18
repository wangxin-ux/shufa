import { createPartnerLessonService, PARTNER_LESSON_FILTERS } from '../pages/partner/runtime/partner-lesson-runtime';
import { PARTNER_LESSON_ACCOUNT_FIXTURE } from '../mock/fixtures/partner.fixture';
import type { PartnerHttpRequest } from '../data/api-partner-data-source';

describe('private partner lesson filter runtime', () => {
  const env = { dataDriver: 'mock' as const, mockScenario: 'normal' as const, apiBaseUrl: '', accessToken: '' };

  it.each(['GRANT', 'CONSUME', 'REVERSAL', 'ADJUSTMENT', 'REFUND', 'CORRECTION'] as const)('filters mock %s before paging, without changing balances', async (entryType) => {
    const service = createPartnerLessonService(env);
    const state = await service.loadLessonAccount({ page: 1, pageSize: 1, entryType });
    const expected = PARTNER_LESSON_ACCOUNT_FIXTURE.items.filter((item) => item.entryType === entryType);
    expect(state).toMatchObject({
      status: 'success',
      data: {
        totalBalanceUnits: PARTNER_LESSON_ACCOUNT_FIXTURE.totalBalanceUnits,
        items: expected.slice(0, 1), meta: { total: expected.length },
      },
    });
  });

  it('keeps all categories, empty and failed scenario semantics', async () => {
    expect(PARTNER_LESSON_FILTERS).toHaveLength(7);
    await expect(createPartnerLessonService(env).loadLessonAccount({ page: 1, pageSize: 20 }))
      .resolves.toMatchObject({ data: { items: PARTNER_LESSON_ACCOUNT_FIXTURE.items } });
    await expect(createPartnerLessonService({ ...env, mockScenario: 'empty' }).loadLessonAccount({ page: 1, pageSize: 20, entryType: 'GRANT' }))
      .resolves.toMatchObject({ status: 'empty', data: { totalBalanceUnits: 0, items: [], meta: { total: 0 } } });
    await expect(createPartnerLessonService({ ...env, mockScenario: 'error' }).loadLessonAccount({ page: 1, pageSize: 20 }))
      .resolves.toMatchObject({ status: 'error' });
  });

  it('passes a typed filter to the existing API adapter with the formal bearer', async () => {
    const calls: Parameters<PartnerHttpRequest>[0][] = [];
    const service = createPartnerLessonService({ ...env, dataDriver: 'api', apiBaseUrl: 'https://example.test/api', accessToken: 'synthetic-partner' }, (options: Parameters<PartnerHttpRequest>[0]) => {
      calls.push(options);
      options.success({ statusCode: 200, data: { data: PARTNER_LESSON_ACCOUNT_FIXTURE } });
    });
    await service.loadLessonAccount({ page: 2, pageSize: 20, entryType: 'REFUND' });
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('entryType')).toBe('REFUND');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.has('campusId')).toBe(false);
    expect(calls[0].header.Authorization).toBe('Bearer synthetic-partner');
  });

  it('retains API teaching context rather than substituting mock linkage', async () => {
    const teachingContext = {
      courseName: 'API课程', teacherName: 'API课次教师', lessonStartsAt: '2026-10-01T02:00:00Z',
    };
    const service = createPartnerLessonService({ ...env, dataDriver: 'api', apiBaseUrl: 'https://example.test/api', accessToken: 'synthetic-partner' }, (options) => {
      options.success({ statusCode: 200, data: { data: {
        ...PARTNER_LESSON_ACCOUNT_FIXTURE,
        items: [{ ...PARTNER_LESSON_ACCOUNT_FIXTURE.items[0], teachingContext }],
      } } });
    });
    await expect(service.loadLessonAccount({ page: 1, pageSize: 20, entryType: 'CONSUME' }))
      .resolves.toMatchObject({ data: { items: [{ teachingContext }] } });
  });

  it('keeps teaching mock data private and reports unlinked adjustments as null', async () => {
    const state = await createPartnerLessonService(env).loadLessonAccount({ page: 1, pageSize: 20 });
    expect(state).toMatchObject({ data: { items: [
      { teachingContext: { courseName: '硬笔书法', teacherName: '李老师', lessonStartsAt: '2026-08-31T06:00:00Z' } },
      { teachingContext: null },
    ] } });
    expect(PARTNER_LESSON_ACCOUNT_FIXTURE.items.every((item) => !('teachingContext' in item))).toBe(true);
  });

  it('filters explicit mock subject attribution and preserves unclassified historical rows', async () => {
    const service: any = createPartnerLessonService(env);
    const directory = await service.loadSubjects();
    expect(directory).toMatchObject({ status: 'success', data: [{ name: '硬笔书法' }] });
    const id = directory.data[0].id;
    const selected = await service.loadLessonAccount({ page: 1, pageSize: 20, subjectId: id });
    expect(selected.data.items).toHaveLength(1);
    expect(selected.data.items[0].subject).toEqual({ id, name: '硬笔书法' });
    const unknown = await service.loadLessonAccount({ page: 1, pageSize: 20, subjectId: 'UNCLASSIFIED' });
    expect(unknown.data.items).toHaveLength(1);
    expect(unknown.data.items[0].subject).toBeNull();
    expect(unknown.data.totalBalanceUnits).toBe(selected.data.totalBalanceUnits);
  });

  it('reads all compact subject pages instead of truncating at 100, including archived filters', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: `合成科目${index}`, isActive: index !== 100, version: 1,
    }));
    const service: any = createPartnerLessonService({
      ...env, dataDriver: 'api', apiBaseUrl: 'https://example.test/api', accessToken: 'synthetic-partner',
    }, (options) => {
      const page = Number(new URL(options.url).searchParams.get('page'));
      options.success({ statusCode: 200, data: {
        data: rows.slice((page - 1) * 100, page * 100),
        meta: { page, pageSize: 100, total: 101, totalPages: 2 },
      } });
    });
    expect((await service.loadSubjects()).data).toEqual(rows);
  });

  it('stops the remaining catalog pages when its page owner leaves', async () => {
    let current = true;
    const request: PartnerHttpRequest = jest.fn((options) => {
      current = false;
      options.success({ statusCode: 200, data: { data: [], meta: {
        page: 1, pageSize: 100, total: 101, totalPages: 2,
      } } });
    });
    const service = createPartnerLessonService({
      ...env, dataDriver: 'api', apiBaseUrl: 'https://example.test', accessToken: 'synthetic-partner',
    }, request);
    expect((await service.loadSubjects(() => current)).status).toBe('error');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
