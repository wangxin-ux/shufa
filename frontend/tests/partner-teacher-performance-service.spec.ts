import * as fs from 'fs';
import * as path from 'path';

const file = path.resolve(__dirname, '../pages/partner/runtime/partner-teacher-performance.service.ts');
const teacherId = '00000000-0000-4000-8000-000000000001';
const evaluation = (patch = {}) => ({
  id: '00000000-0000-4000-8000-000000000002', teacherId, periodMonth: '2026-09', version: 1,
  teachingRating: 1, communicationRating: 7, attendanceRating: 10, overallRating: 4,
  guidance: '合成指导', authorName: '合成评价人', canEdit: true,
  createdAt: '2026-10-16T02:00:00.000Z', updatedAt: '2026-10-16T02:00:00.000Z', ...patch,
});
const performance = (patch = {}) => ({
  teacherId, periodMonth: '2026-09', timezone: 'Asia/Shanghai', asOf: '2026-10-16T02:00:00.000Z',
  scheduledLessonCount: 4, completedLessonCount: 3, completionRateBasisPoints: 7500, evaluation: null, ...patch,
});
const body = { periodMonth: '2026-09', expectedVersion: 0, teachingRating: 1,
  communicationRating: 7, attendanceRating: 10, overallRating: 4, guidance: '合成指导' };

describe('role-private teacher evaluation client', () => {
  let Service: any, client: any, send: jest.Mock, token: string, environment: boolean;
  beforeEach(() => {
    expect(fs.existsSync(file)).toBe(true);
    Service = require(file).PartnerTeacherPerformanceClient;
    token = 'synthetic-token'; environment = true;
    send = jest.fn(options => options.success({ statusCode: 200, data: { data: performance(), requestId: 'synthetic' } }));
    client = new Service({ dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:1234', accessToken: () => token,
      request: send, isCurrent: () => environment });
  });
  it('reads the specified teacher month over the current authenticated transport', async () => {
    expect(await client.performance(teacherId, '2026-09')).toEqual(performance());
    expect(send.mock.calls[0][0]).toMatchObject({ method: 'GET',
      url: `http://127.0.0.1:1234/partners/me/teachers/${teacherId}/performance?month=2026-09`,
      header: { Authorization: 'Bearer synthetic-token' } });
  });
  it('sends a complete PUT and accepts the original version retry response', async () => {
    send.mockImplementation(o => o.success({ statusCode: 200, data: { data: evaluation(), requestId: 'synthetic' } }));
    expect((await client.save(teacherId, body)).version).toBe(1);
    expect(send.mock.calls[0][0]).toMatchObject({ method: 'PUT', data: body });
    expect((await client.save(teacherId, { ...body, expectedVersion: 1 })).version).toBe(1);
  });
  it('validates month, four independent half-star integers and scalar count before sending', async () => {
    for (const patch of [{ overallRating: null }, { teachingRating: 0 }, { communicationRating: 3.5 },
      { attendanceRating: 11 }, { guidance: '\ud800' }, { guidance: '\0' },
      { guidance: '字'.repeat(1001) }, { periodMonth: '2026-13' }])
      await expect(client.save(teacherId, { ...body, ...patch })).rejects.toMatchObject({ statusCode: 400 });
    expect(send).not.toHaveBeenCalled();
    send.mockImplementation(o => o.success({ statusCode: 200, data: { data: evaluation({ guidance: '😀'.repeat(1000) }), requestId: 'x' } }));
    await expect(client.save(teacherId, { ...body, guidance: '😀'.repeat(1000) })).resolves.toBeDefined();
  });
  it('rejects wrong teacher/month, fabricated ratios, extra private fields and malformed ratings', async () => {
    for (const patch of [{ teacherId: 'other' }, { periodMonth: '2026-08' }, { completedLessonCount: 5 },
      { completionRateBasisPoints: 9999 }, { evaluation: evaluation({ overallRating: 11 }) },
      { evaluation: evaluation({ authorUserId: teacherId }) }]) {
      send.mockImplementation(o => o.success({ statusCode: 200, data: { data: performance(patch), requestId: 'x' } }));
      await expect(client.performance(teacherId, '2026-09')).rejects.toMatchObject({ statusCode: 502 });
    }
  });
  it('rejects a save receipt for different content or an unexpected version', async () => {
    for (const patch of [{ guidance: '其他内容' }, { version: 3 }, { canEdit: false }, { overallRating: 9 }]) {
      send.mockImplementation(o => o.success({ statusCode: 200, data: { data: evaluation(patch), requestId: 'x' } }));
      await expect(client.save(teacherId, body)).rejects.toMatchObject({ statusCode: 502 });
    }
  });
  it('validates history pagination and descending unique versions', async () => {
    const { version, teachingRating, communicationRating, attendanceRating, overallRating, guidance, authorName } = evaluation();
    const row = { version, teachingRating, communicationRating, attendanceRating, overallRating, guidance, authorName, savedAt: '2026-10-16T02:00:00.000Z' };
    send.mockImplementation(o => o.success({ statusCode: 200, data: {
      data: [row], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 }, requestId: 'x',
    } }));
    expect((await client.history(teacherId, '2026-09', 1)).data).toEqual([row]);
    send.mockImplementation(o => o.success({ statusCode: 200, data: {
      data: [row, row], meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 }, requestId: 'x',
    } }));
    await expect(client.history(teacherId, '2026-09', 1)).rejects.toMatchObject({ statusCode: 502 });
  });
  it('refuses missing credentials, changed environments and stale replies', async () => {
    token = '';
    await expect(client.performance(teacherId, '2026-09')).rejects.toMatchObject({ statusCode: 401 });
    expect(send).not.toHaveBeenCalled();
    token = 'synthetic-token';
    let pending: any;
    send.mockImplementation(o => { pending = o; });
    const result = client.performance(teacherId, '2026-09');
    environment = false;
    pending.success({ statusCode: 200, data: { data: performance(), requestId: 'x' } });
    await expect(result).rejects.toMatchObject({ statusCode: 401 });
  });
  it('has bounded timeouts and ignores duplicate callbacks', async () => {
    jest.useFakeTimers();
    send.mockImplementation(() => undefined);
    const pending = client.performance(teacherId, '2026-09');
    const caught = expect(pending).rejects.toMatchObject({ statusCode: 0 });
    jest.advanceTimersByTime(15000);
    await caught;
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
  it('retains mock evaluations across component recreation with one revision per save', async () => {
    const options = { dataDriver: 'mock', accessToken: () => 'mock-owner' };
    const first = new Service(options);
    await first.save('teacher-lin', body);
    await first.save('teacher-lin', body);
    const second = new Service(options);
    expect((await second.performance('teacher-lin', '2026-09')).evaluation.version).toBe(1);
    expect((await second.history('teacher-lin', '2026-09', 1)).meta.total).toBe(1);
  });
});
