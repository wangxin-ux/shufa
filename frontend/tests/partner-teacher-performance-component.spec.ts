import * as fs from 'fs';
import * as path from 'path';

const file = path.resolve(__dirname, '../pages/partner/components/teacher-performance/index.ts');
const performance = jest.fn(), save = jest.fn(), history = jest.fn();
let owner = 'owner-a';
jest.mock('../pages/partner/runtime/partner-teacher-performance.service', () => ({
  createPartnerTeacherPerformanceClient: () => ({ getSessionKey: () => owner, performance, save, history }),
}), { virtual: true });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const result = (patch = {}) => ({
  teacherId: 'teacher-a', periodMonth: '2026-09', timezone: 'Asia/Shanghai',
  asOf: '2026-10-16T02:00:00.000Z', scheduledLessonCount: 4, completedLessonCount: 3,
  completionRateBasisPoints: 7500, evaluation: null, ...patch,
});
const evaluation = (patch = {}) => ({
  id: 'evaluation-a', teacherId: 'teacher-a', periodMonth: '2026-09', version: 1,
  teachingRating: 1, communicationRating: 7, attendanceRating: 10, overallRating: 4,
  guidance: '合成指导', authorName: '合成评价人', canEdit: true,
  createdAt: '2026-10-16T02:00:00.000Z', updatedAt: '2026-10-16T02:00:00.000Z', ...patch,
});
describe('native teacher evaluation component', () => {
  let component: any, definition: any;
  const open = async () => { definition.lifetimes.attached.call(component); await flush(); };
  const rate = (field: string, score: number) => component.onRate({ currentTarget: { dataset: { field, score } } });
  const fill = () => {
    rate('teachingRating', 1); rate('communicationRating', 7); rate('attendanceRating', 10); rate('overallRating', 4);
    component.onGuidanceInput({ detail: { value: '合成指导' } });
  };
  beforeEach(() => {
    owner = 'owner-a';
    performance.mockReset().mockImplementation(async (_id, month) => result({ periodMonth: month }));
    save.mockReset().mockResolvedValue(evaluation());
    history.mockReset().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    (global as any).wx = { showModal: jest.fn(o => o.success({ confirm: true })) };
    (global as any).Component = (config: any) => {
      definition = config;
      component = { ...config.methods, data: { ...structuredClone(config.data), teacherId: 'teacher-a', blocked: false },
        triggerEvent: jest.fn(), setData(patch: object) { Object.assign(this.data, patch); } };
    };
    expect(fs.existsSync(file)).toBe(true);
    jest.isolateModules(() => require(file));
    component.data.month = '2026-09';
  });
  afterEach(() => {
    definition?.lifetimes.detached.call(component);
    definition = undefined;
    delete (global as any).Component; delete (global as any).wx;
  });
  it('loads only the expanded teacher and shows backend lesson counts and an empty evaluation', async () => {
    await open();
    expect(performance).toHaveBeenCalledWith('teacher-a', '2026-09');
    expect(component.data).toMatchObject({ state: 'ready', scheduledLabel: '4', completedLabel: '3', rateLabel: '75%', canEdit: true });
    expect(component.data.ratings.every((r: any) => r.score === null)).toBe(true);
  });
  it('requires all four independent ratings, preserves input, and explicitly saves a complete body', async () => {
    await open();
    rate('teachingRating', 1); await component.onSave();
    expect(save).not.toHaveBeenCalled();
    fill(); await component.onSave(); await flush();
    expect(save).toHaveBeenCalledWith('teacher-a', {
      periodMonth: '2026-09', expectedVersion: 0, teachingRating: 1,
      communicationRating: 7, attendanceRating: 10, overallRating: 4, guidance: '合成指导',
    });
    expect(component.data).toMatchObject({ dirty: false, saving: false, authorName: '合成评价人' });
    expect(component.data.ratings[0].stars.map((s: any) => s.fill)).toEqual([50, 0, 0, 0, 0]);
  });
  it('freezes an unknown save and retries exactly the original body', async () => {
    await open(); fill();
    save.mockRejectedValueOnce({ statusCode: 0 });
    await component.onSave();
    expect(component.data.saveUnknown).toBe(true);
    rate('overallRating', 9);
    component.onGuidanceInput({ detail: { value: '不得进入重试' } });
    await component.onSave();
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    expect(component.data.saveUnknown).toBe(false);
  });
  it('shows a version conflict until explicit reload and never silently overwrites it', async () => {
    await open(); fill(); save.mockRejectedValueOnce({ statusCode: 409 });
    await component.onSave();
    expect(component.data.conflict).toBe(true);
    await component.onSave(); expect(save).toHaveBeenCalledTimes(1);
    performance.mockResolvedValueOnce(result({ evaluation: evaluation({ version: 2 }) }));
    await component.onReload(); await flush();
    expect(component.data).toMatchObject({ conflict: false, dirty: false });
  });
  it('keeps normal validation failure drafts editable, counts Unicode scalars and rejects overlength', async () => {
    await open(); fill(); save.mockRejectedValueOnce({ statusCode: 400 });
    await component.onSave();
    expect(component.data).toMatchObject({ guidance: '合成指导', dirty: true, saveUnknown: false });
    component.onGuidanceInput({ detail: { value: '😀'.repeat(1001) } });
    expect(component.data.guidanceCount).toBe(1001);
    await component.onSave();
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('clears the component and tells its parent when any endpoint denies access', async () => {
    await open(); fill(); save.mockRejectedValueOnce({ statusCode: 403 });
    await component.onSave();
    expect(component.data).toMatchObject({ state: 'forbidden', guidance: '', authorName: '' });
    expect(component.triggerEvent).toHaveBeenCalledWith('forbidden', expect.any(Object));
    rate('overallRating', 9); await component.onSave();
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('does not apply late responses or send queued writes after hide or account change', async () => {
    await open(); fill();
    const queued = component.onSave();
    definition.pageLifetimes.hide.call(component);
    await queued;
    expect(save).not.toHaveBeenCalled();
    expect(component.data.guidance).toBe('');
    definition.pageLifetimes.show.call(component); await flush();
    fill(); owner = 'owner-b'; await component.onSave();
    expect(component.data.state).toBe('forbidden');
    expect(save).not.toHaveBeenCalled();
  });
  it('is read only for another author and shows no plan without inventing 100 percent', async () => {
    performance.mockResolvedValueOnce(result({
      scheduledLessonCount: 0, completedLessonCount: 0, completionRateBasisPoints: null,
      evaluation: evaluation({ canEdit: false }),
    }));
    await open(); fill(); await component.onSave();
    expect(component.data.rateLabel).toBe('无计划');
    expect(save).not.toHaveBeenCalled();
    expect(component.data.guidance).toBe('合成指导');
  });
  it('ignores an already sent save success after hide and reads durable values when shown again', async () => {
    await open(); fill();
    let resolveSave!: (value: unknown) => void;
    save.mockReturnValueOnce(new Promise(resolve => { resolveSave = resolve; }));
    const pending = component.onSave(); await flush();
    expect(save).toHaveBeenCalledTimes(1);
    definition.pageLifetimes.hide.call(component);
    resolveSave(evaluation()); await pending;
    expect(component.data).toMatchObject({ guidance: '', authorName: '', saving: false });
    performance.mockResolvedValueOnce(result({ evaluation: evaluation() }));
    definition.pageLifetimes.show.call(component); await flush();
    expect(component.data.guidance).toBe('合成指导');
  });
  it('ignores an old save denial after the same owner returns and a fresh read succeeds', async () => {
    await open(); fill();
    let rejectSave!: (value: unknown) => void;
    save.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectSave = reject; }));
    const pending = component.onSave(); await flush();
    definition.pageLifetimes.hide.call(component);
    definition.pageLifetimes.show.call(component); await flush();
    rejectSave({ statusCode: 403 }); await pending;
    expect(component.data.state).toBe('ready');
    expect(component.triggerEvent).not.toHaveBeenCalled();
  });
  it('loads version history on demand and retries the failed page without duplicating rows', async () => {
    await open();
    expect(history).not.toHaveBeenCalled();
    history.mockResolvedValueOnce({ data: [{ ...evaluation(), version: 2, savedAt: evaluation().updatedAt }],
      meta: { page: 1, pageSize: 20, total: 21, totalPages: 2 } });
    await component.onHistoryToggle(); await flush();
    expect(component.data.historyRows[0]).toMatchObject({ version: 2, overallLabel: '2 星' });
    history.mockRejectedValueOnce({ statusCode: 500 });
    await component.onHistoryMore(); await flush();
    expect(component.data.historyRows).toHaveLength(1);
    history.mockResolvedValueOnce({ data: [{ ...evaluation(), version: 1, savedAt: evaluation().updatedAt }],
      meta: { page: 2, pageSize: 20, total: 21, totalPages: 2 } });
    await component.onHistoryRetry(); await flush();
    expect(history.mock.calls.map(c => c[2])).toEqual([1, 2, 2]);
    expect(component.data.historyRows.map((r: any) => r.version)).toEqual([2, 1]);
  });
  it('confirms discarding a dirty draft before changing months', async () => {
    await open(); fill();
    (wx.showModal as jest.Mock).mockImplementationOnce(o => o.success({ confirm: false }));
    component.onMonthChange({ detail: { value: '2026-08' } }); await flush();
    expect(component.data.month).toBe('2026-09');
    component.onMonthChange({ detail: { value: '2026-08' } }); await flush();
    expect(component.data.month).toBe('2026-08');
    expect(component.data.guidance).toBe('');
  });
});
