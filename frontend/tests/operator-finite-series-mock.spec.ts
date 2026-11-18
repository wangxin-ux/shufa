import { MockOperatorDataSource } from '../pages/operator/runtime/data/mock-operator-data-source';
import { pattern } from './operator-finite-series.fixture';

it('uses finite mock previews, creates ordinary linked lessons atomically and cancels the actual future set', async () => {
  const source: any = new MockOperatorDataSource();
  expect(typeof source.previewLessonSeries).toBe('function');
  const options = await source.getSchedulingOptions();
  const input = pattern({ classGroupId: options.classes[0].classGroupId });
  const before = await source.listLessonSessions({ page: 1, pageSize: 100 });
  const preview = await source.previewLessonSeries(input);
  const result = await source.createLessonSeries({ ...input, previewHash: preview.previewHash }, 'series-mock');
  expect(result.sessions).toHaveLength(preview.sessions.length);
  expect(await source.createLessonSeries({ ...input, previewHash: preview.previewHash }, 'series-mock')).toEqual(result);
  const conflicts = await source.previewLessonSeries(input); expect(conflicts.conflictDates).toHaveLength(preview.sessions.length);
  const after = await source.listLessonSessions({ page: 1, pageSize: 100 });
  expect(after.meta.total - before.meta.total).toBe(result.sessions.length);
  expect(after.data.filter((row: any) => row.seriesId === result.seriesId)).toHaveLength(result.sessions.length);
  const selection = await source.previewLessonCancellation(result.sessions[0].id, 'FOLLOWING');
  const cancelled = await source.cancelLessonSelection(result.sessions[0].id,
    { mode: 'FOLLOWING', previewHash: selection.previewHash }, selection, 'cancel-mock');
  expect(cancelled.sessions.every((row: any) => row.status === 'CANCELLED')).toBe(true);
  expect(await source.cancelLessonSelection(result.sessions[0].id,
    { mode: 'FOLLOWING', previewHash: selection.previewHash }, selection, 'cancel-mock')).toEqual(cancelled);
});
it('keeps simultaneous synthetic same-key creates to one result and rejects another conflicting command', async () => {
  const source: any = new MockOperatorDataSource();
  const options = await source.getSchedulingOptions();
  const input = pattern({ classGroupId: options.classes[0].classGroupId });
  const plan = await source.previewLessonSeries(input);
  const command = { ...input, previewHash: plan.previewHash };
  const [a, b] = await Promise.all([source.createLessonSeries(command, 'concurrent'),
    source.createLessonSeries(command, 'concurrent')]);
  expect(a).toEqual(b);
  await expect(source.createLessonSeries(command, 'different')).rejects.toMatchObject({ statusCode: 409 });
});
