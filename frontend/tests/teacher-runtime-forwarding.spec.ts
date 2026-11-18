import type { TeacherService } from '../services/teacher.service';
import { captureTeacherPage } from './teacher-page-test-support';

function environment() {
  const host = captureTeacherPage('feedback', { preload: false });
  let service!: TeacherService;
  jest.isolateModules(() => {
    service = require('../services/teacher-runtime').teacherService as TeacherService;
  });
  return { host, service };
}

it('forwards history parameters and resolves the current account on each legacy call', async () => {
  const { host, service } = environment();
  try {
    const first = service.loadStudent('student-a', { feedbackPage: 2, feedbackPageSize: 5 });
    expect(host.calls[0].url).toContain('/students/student-a?feedbackPage=2&feedbackPageSize=5');
    expect(host.calls[0].header.Authorization).toBe('Bearer synthetic-teacher-a');
    host.reply(0, { message: 'Denied' }, 403);
    await first;
    host.change({ accessToken: 'synthetic-teacher-b', apiBaseUrl: 'https://changed.synthetic.invalid' });
    const next = service.loadStudent('student-b', { feedbackPage: 3 });
    expect(host.calls[1].url).toContain('https://changed.synthetic.invalid/teachers/me/students/student-b?feedbackPage=3');
    expect(host.calls[1].header.Authorization).toBe('Bearer synthetic-teacher-b');
    host.reply(1, { message: 'Denied' }, 403);
    await next;
  } finally {
    host.close();
  }
});

it('preserves all withdrawal arguments without executing a mutation', async () => {
  const { host, service } = environment();
  try {
    const create = service.createWithdrawal(12345, 'create-key');
    expect(host.calls[0]).toMatchObject({
      method: 'POST', data: { amountFen: 12345 },
      header: { 'Idempotency-Key': 'create-key' },
    });
    host.reply(0, { message: 'Denied' }, 403);
    await create;
    const cancel = service.cancelWithdrawal('withdrawal-a', 7, 'cancel-key');
    expect(host.calls[1]).toMatchObject({
      method: 'POST', data: { expectedVersion: 7 },
      header: { 'Idempotency-Key': 'cancel-key' },
    });
    expect(host.calls[1].url).toContain('/withdrawals/withdrawal-a/cancel');
    host.reply(1, { message: 'Denied' }, 403);
    await cancel;
  } finally {
    host.close();
  }
});

it('stops legacy reads after logout without reusing the previous source', async () => {
  const { host, service } = environment();
  try {
    host.values.set('education.session.logged-out', true);
    expect(await service.loadStudent('student-a')).toMatchObject({
      status: 'error', statusCode: 401,
    });
    expect(host.calls).toHaveLength(0);
  } finally {
    host.close();
  }
});
