import { createPartnerStudentsService } from '../pages/partner/runtime/partner-students-runtime';
import { PARTNER_STUDENTS_FIXTURE } from '../mock/fixtures/partner.fixture';
import type { PartnerHttpRequest } from '../data/api-partner-data-source';

const env = {
  dataDriver: 'mock' as const, mockScenario: 'normal' as const,
  apiBaseUrl: '', accessToken: '',
};
const subjectId = '00000000-0000-4000-8000-000000000001';

describe('private partner student subject transport', () => {
  it('filters explicit mock associations before pagination without changing balances', async () => {
    const service = createPartnerStudentsService(env);
    const selected = await service.loadStudents({ page: 1, pageSize: 1, subjectId });
    expect(selected).toMatchObject({
      status: 'success',
      data: {
        data: [PARTNER_STUDENTS_FIXTURE[0]],
        meta: { total: 1, totalPages: 1 },
      },
    });
    await expect(service.loadStudents({
      page: 2, pageSize: 1, subjectId,
    })).resolves.toMatchObject({
      status: 'empty', data: { data: [], meta: { total: 1 } },
    });
    await expect(service.loadStudents({
      page: 1, pageSize: 20, subjectId: 'UNCLASSIFIED',
    })).resolves.toMatchObject({
      status: 'success', data: { data: [PARTNER_STUDENTS_FIXTURE[1]] },
    });
  });

  it('AND-combines mock subject, pending name and whole-student balance bands', async () => {
    const service = createPartnerStudentsService(env);
    await expect(service.loadStudents({
      page: 1, pageSize: 20, subjectId, query: ' 林 ', balanceBand: 'LTE_FIVE',
    })).resolves.toMatchObject({ data: { data: [PARTNER_STUDENTS_FIXTURE[0]] } });
    for (const query of [
      { subjectId, query: '陈' },
      { subjectId, balanceBand: 'GT_FIVE' as const },
      { subjectId: '00000000-0000-4000-8000-000000000002' },
    ]) {
      await expect(service.loadStudents({
        page: 1, pageSize: 20, ...query,
      })).resolves.toMatchObject({ status: 'empty', data: { data: [], meta: { total: 0 } } });
    }
  });

  it('keeps unfiltered, empty and failure scenarios and reuses the existing subject directory', async () => {
    const normal = createPartnerStudentsService(env);
    await expect(normal.loadStudents({ page: 1, pageSize: 20 }))
      .resolves.toMatchObject({ data: { data: PARTNER_STUDENTS_FIXTURE } });
    await expect(normal.loadSubjects()).resolves.toMatchObject({
      status: 'success', data: [{ id: subjectId, name: '硬笔书法' }],
    });
    const empty = createPartnerStudentsService({ ...env, mockScenario: 'empty' });
    await expect(empty.loadStudents({ page: 1, pageSize: 20, subjectId }))
      .resolves.toMatchObject({ status: 'empty', data: { data: [], meta: { total: 0 } } });
    const failed = createPartnerStudentsService({ ...env, mockScenario: 'error' });
    await expect(failed.loadStudents({ page: 1, pageSize: 20, subjectId }))
      .resolves.toMatchObject({ status: 'error' });
    await expect(failed.loadSubjects()).resolves.toMatchObject({ status: 'error' });
  });

  it('passes the complete filter to the real API adapter using current credentials', async () => {
    const calls: Parameters<PartnerHttpRequest>[0][] = [];
    const service = createPartnerStudentsService({
      ...env, dataDriver: 'api', apiBaseUrl: 'https://example.test/api',
      accessToken: 'synthetic-student-subject-owner',
    }, (options) => {
      calls.push(options);
      options.success({ statusCode: 200, data: {
        data: PARTNER_STUDENTS_FIXTURE,
        meta: { page: 2, pageSize: 20, total: 22, totalPages: 2 },
      } });
    });
    const state = await service.loadStudents({
      page: 2, pageSize: 20, subjectId, query: '林', balanceBand: 'LTE_FIVE',
    });
    expect(state.status).toBe('success');
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/api/partners/me/students');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      page: '2', pageSize: '20', subjectId, query: '林', balanceBand: 'LTE_FIVE',
    });
    expect(url.searchParams.has('campusId')).toBe(false);
    expect(calls[0].header.Authorization).toBe('Bearer synthetic-student-subject-owner');
  });

  it.each([401, 403])('preserves API %s from either data or subject reads', async (statusCode) => {
    const service = createPartnerStudentsService({
      ...env, dataDriver: 'api', apiBaseUrl: 'https://example.test/api',
      accessToken: 'synthetic-student-subject-owner',
    }, (options) => options.success({ statusCode, data: { code: 'FORBIDDEN' } }));
    await expect(service.loadStudents({ page: 1, pageSize: 20, subjectId }))
      .resolves.toMatchObject({ status: 'error', statusCode });
    await expect(service.loadSubjects()).resolves.toMatchObject({ status: 'error', statusCode });
  });
});
