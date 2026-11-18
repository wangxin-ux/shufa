import { ApiOperatorDataSource, OperatorHttpRequestOptions } from '../pages/operator/runtime/data/api-operator-data-source';
import { MockOperatorDataSource } from '../pages/operator/runtime/data/mock-operator-data-source';
import { OperatorService } from '../pages/operator/runtime/services/operator.service';
import { OPERATOR_TEACHER_ARCHIVES } from '../pages/operator/runtime/mock/fixtures/operator-teacher-archives.fixture';
import { buildOperatorTeacherPerformance, buildOperatorTeacherHistory } from '../pages/operator/runtime/services/operator-teacher-archives.presenter';
import { teacherArchives, teacherPerformance, teacherRevisions, archivePage } from './operator-teacher-archives.fixture';
import { capture, flush } from './operator-page-host';
import { resolveOperatorHomeAction } from '../pages/operator/runtime/services/operator-home.presenter';
import { resolveOperatorProfileAction } from '../pages/operator/runtime/services/operator-profile.presenter';
import * as fs from 'node:fs';
import * as path from 'node:path';

function api() {
  const calls: OperatorHttpRequestOptions[] = [];
  const source = new ApiOperatorDataSource({
    baseUrl: 'https://operator.example.test', accessToken: 'synthetic-test-token',
    request: (options) => { calls.push(options); },
  });
  return { calls, source };
}

it('uses only exact OPERATOR GET routes, month and encoded query parameters without a write key', async () => {
  const { calls, source } = api();
  const teacher = teacherArchives[0];
  const list = source.listTeacherArchives({ page: 2, pageSize: 20, query: '李&王' });
  const performance = source.getTeacherPerformance(teacher.id);
  const history = source.getTeacherEvaluationHistory(teacher.id, { month: '2026-10', page: 2, pageSize: 20 });
  expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
    '/operators/me/teacher-archives',
    `/operators/me/teacher-archives/${teacher.id}/performance`,
    `/operators/me/teacher-archives/${teacher.id}/evaluation-history`,
  ]);
  expect(new URL(calls[0].url).searchParams.get('query')).toBe('李&王');
  expect(new URL(calls[1].url).search).toBe('');
  expect(new URL(calls[2].url).search).toBe('?month=2026-10&page=2&pageSize=20');
  expect(calls.every((call) => call.method === 'GET' && call.data === undefined && !call.header['Idempotency-Key'])).toBe(true);
  calls[0].success({ statusCode: 200, data: archivePage([teacher], 2, 21) });
  calls[1].success({ statusCode: 200, data: { data: teacherPerformance() } });
  calls[2].success({ statusCode: 200, data: archivePage(teacherRevisions().slice(20), 2, 21) });
  await expect(list).resolves.toMatchObject({ data: [teacher] });
  await expect(performance).resolves.toMatchObject({ periodMonth: '2026-10', evaluation: { canEdit: false } });
  await expect(history).resolves.toMatchObject({ data: [{ version: 1, guidance: '第1版指导语' }] });
});

it('projects only approved teacher, evaluation and revision fields even with unexpected private payload data', async () => {
  const { calls, source } = api();
  const hidden = { phone: 'synthetic-private-phone', salary: 9999, attachments: [], authorUserId: 'synthetic-private-author' };
  const list = source.listTeacherArchives({ page: 1, pageSize: 20 });
  const monthly = source.getTeacherPerformance(teacherArchives[0].id);
  const history = source.getTeacherEvaluationHistory(teacherArchives[0].id, { month: '2026-10', page: 1, pageSize: 20 });
  const performance = teacherPerformance();
  calls[0].success({ statusCode: 200, data: archivePage([{
    ...teacherArchives[0], ...hidden, classes: [{ ...teacherArchives[0].classes[0], ...hidden }],
  }]) });
  calls[1].success({ statusCode: 200, data: { data: {
    ...performance, ...hidden, evaluation: { ...performance.evaluation!, ...hidden },
  } } });
  calls[2].success({ statusCode: 200, data: archivePage([{ ...teacherRevisions()[0], ...hidden }]) });
  expect(JSON.stringify(await Promise.all([list, monthly, history]))).not.toMatch(/private|salary|attachments|authorUserId/);
});

it.each(['teacher', 'month', 'evaluation-month', 'editing'])('rejects mismatched %s performance instead of presenting it', async (kind) => {
  const { calls, source } = api();
  const item = structuredClone(teacherPerformance());
  if (kind === 'teacher') item.teacherId = teacherArchives[1].id;
  if (kind === 'month') item.periodMonth = '2026-09';
  if (kind === 'evaluation-month') item.evaluation!.periodMonth = '2026-09';
  if (kind === 'editing') (item.evaluation as any).canEdit = true;
  const result = new OperatorService(source).loadTeacherPerformance(teacherArchives[0].id, '2026-10');
  calls[0].success({ statusCode: 200, data: { data: item } });
  await expect(result).resolves.toMatchObject({ status: 'error', code: 'INVALID_TEACHER_ARCHIVE_RESPONSE' });
});

it('preserves four independent half-star values, authorship and immutable revision versions', () => {
  const item = teacherPerformance();
  const model = buildOperatorTeacherPerformance(item);
  expect(model.evaluation!.ratings.map((rating) => rating.valueLabel)).toEqual(['0.5星', '1.5星', '4星', '5星']);
  expect(model.evaluation!.ratings[0].stars.map((star) => star.fill)).toEqual(['half', 'empty', 'empty', 'empty', 'empty']);
  const longGuidance = '继续关注课堂互动和每位学员的成长。'.repeat(50).slice(0, 1000);
  const history = buildOperatorTeacherHistory([{ ...teacherRevisions()[20], guidance: longGuidance }]);
  expect(history[0]).toMatchObject({ version: 1, guidance: longGuidance, authorName: '原作者王校长', periodMonth: '2026-10' });
  expect(JSON.stringify(history)).not.toMatch(/canEdit|teacherId|authorUserId/);
  expect(buildOperatorTeacherPerformance({
    ...item, scheduledLessonCount: 0, completedLessonCount: 0, completionRateBasisPoints: null, evaluation: null,
  })).toMatchObject({ scheduledLabel: '0', completedLabel: '0', completionLabel: '无计划', evaluation: null });
});

it('provides deterministic mock teacher search, full pagination, half stars, no-plan and original revision text', async () => {
  const source = new MockOperatorDataSource();
  const first = await source.listTeacherArchives({ page: 1, pageSize: 20 });
  const last = await source.listTeacherArchives({ page: 2, pageSize: 20 });
  expect([...first.data, ...last.data]).toHaveLength(21);
  expect(new Set([...first.data, ...last.data].map((teacher) => teacher.id)).size).toBe(21);
  expect((await source.listTeacherArchives({ page: 1, pageSize: 20, query: '李老师' })).data).toHaveLength(2);
  const empty = new MockOperatorDataSource({ scenario: 'empty' });
  expect((await empty.listTeacherArchives({ page: 1, pageSize: 20 })).data).toEqual([]);
  expect((await source.getTeacherPerformance(OPERATOR_TEACHER_ARCHIVES[1].id)).completionRateBasisPoints).toBeNull();
  const history = await source.getTeacherEvaluationHistory(OPERATOR_TEACHER_ARCHIVES[0].id, { month: '2026-09', page: 2, pageSize: 20 });
  expect(history.data[0]).toMatchObject({ version: 1, periodMonth: '2026-09', authorName: '王校长' });
  expect(Object.keys(history.meta).sort()).toEqual(['page', 'pageSize', 'total', 'totalPages']);
  await expect(source.getTeacherPerformance('synthetic-unknown')).rejects.toMatchObject({ statusCode: 404 });
});

it('opens teacher archives from both existing navigation surfaces and preserves personnel management', async () => {
  const target = '/pages/operator/teacher-archives/index';
  expect(resolveOperatorHomeAction('teacher-archives')).toEqual({ kind: 'navigate', url: target });
  expect(resolveOperatorProfileAction('teacher-archives')).toEqual({ kind: 'navigate', url: target });
  expect(resolveOperatorHomeAction('students')).toEqual({ kind: 'navigate', url: '/pages/operator/students/index' });
  for (const route of ['home', 'profile'] as const) {
    const env = capture([route], 'mock');
    try {
      const page = env.instantiate(); page.onLoad(); page.onShow(); await flush();
      page.onActionTap({ currentTarget: { dataset: { key: 'teacher-archives' } } });
      expect(env.platform.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: target }));
    } finally { env.close(); }
  }
});

it('keeps the template read-only, error-retryable and bounded, using existing role assets', () => {
  const root = path.resolve(__dirname, '../pages/operator/teacher-archives');
  const markup = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'index.wxss'), 'utf8');
  expect(markup).toContain('fields="month"');
  expect(markup).toContain("performanceState === 'error' || performanceError");
  expect(markup).toContain('onHistoryRetry');
  expect(styles).toMatch(/rating-star__fill--half\s*\{[^}]*clip-path:\s*inset\(0 50% 0 0\)/s);
  expect(markup).not.toMatch(/bindtap="(?:onSubmit|onSave|onEvaluate|onRate)|手机号|薪资|提现|人力|合作方身份/);
});
