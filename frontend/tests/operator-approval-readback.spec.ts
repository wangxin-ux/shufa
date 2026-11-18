import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OperatorHttpRequestOptions } from '../pages/operator/runtime/data/api-operator-data-source';
import { ApiParentDataSource } from '../data/api-parent-data-source';
import { ApiTeacherDataSource } from '../data/api-teacher-data-source';
import { NORMAL_TEACHER_FIXTURE } from '../mock/fixtures/teacher.fixture';
import { ParentService } from '../services/parent.service';
import { TeacherService } from '../services/teacher.service';
import { capture, fixture, pendingRows, tap } from './operator-page-host';

type TransportOptions = Omit<OperatorHttpRequestOptions, 'method'> & {
  method: string;
};

function transport(options: TransportOptions) {
  const url = new URL(options.url);
  if (options.method === 'GET' && options.data) {
    for (const [key, value] of Object.entries(options.data)) url.searchParams.set(key, String(value));
  }
  const request = httpRequest(url, {
    method: options.method, headers: { ...options.header, 'Content-Type': 'application/json' },
  }, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => {
      try { options.success({ statusCode: response.statusCode ?? 0, data: JSON.parse(body) }); }
      catch (error) { options.fail(error); }
    });
  });
  request.on('error', options.fail);
  request.end(options.method === 'GET' ? undefined : JSON.stringify(options.data));
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Synthetic HTTP host did not settle');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

// Contract/transport evidence only: this host has no database or backend transaction engine.
async function syntheticHost() {
  const records = structuredClone(pendingRows);
  const target = records[0];
  const writes: Array<{ path: string; key: string | undefined; body: unknown }> = [];
  const unexpected: string[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const role = path.startsWith('/operators/') ? 'synthetic-owner-a'
      : path.startsWith('/parents/') ? 'synthetic-parent' : 'synthetic-teacher';
    const send = (data: unknown, status = 200) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(data));
    };
    if (request.headers.authorization !== `Bearer ${role}`) {
      send({ code: 'UNAUTHORIZED' }, 401); return;
    }
    const pending = () => records.filter((record) => record.status === 'PENDING');
    if (request.method === 'GET' && path === '/operators/me/dashboard') {
      const latest = pending()[0];
      send({ data: { ...fixture.dashboard, pendingLeaveCount: pending().length,
        latestPendingLeave: latest ? { id: latest.id, studentName: latest.studentName,
          courseName: latest.courseName, startsAt: latest.startsAt } : null } }); return;
    }
    if (request.method === 'GET' && path === '/operators/me/leave-requests') {
      const data = records.filter((record) => url.searchParams.get('reviewedOnly') === 'true'
        ? record.status !== 'PENDING' : record.status === url.searchParams.get('status'));
      send({ data, meta: { page: 1, pageSize: 20, total: data.length, totalPages: data.length ? 1 : 0 } });
      return;
    }
    if (request.method === 'POST' && [
      `/operators/me/leave-requests/${target.id}/approve`,
      `/operators/me/leave-requests/${target.id}/reject`,
    ].includes(path)) {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      const key = request.headers['idempotency-key'] as string | undefined;
      writes.push({ path, key, body });
      if (!key || body.version !== target.version || target.status !== 'PENDING') {
        send({ code: 'LEAVE_STATUS_CONFLICT' }, 409); return;
      }
      target.status = path.endsWith('/approve') ? 'APPROVED' : 'REJECTED';
      target.version += 1;
      target.reviewReason = body.reviewReason ?? null;
      target.reviewerName = fixture.profile.displayName;
      target.reviewedAt = '2026-10-24T04:00:00.000Z';
      send({ data: target }); return;
    }
    if (request.method === 'GET' && path === '/parents/me/leave') {
      send({ data: { students: [], lessons: [], cutoffHours: 24,
        records: records.map((record) => ({ ...record, lessonStartsAt: record.startsAt })) } }); return;
    }
    if (request.method === 'GET' && path === `/teachers/me/lesson-sessions/${target.lessonSessionId}`) {
      const baseline = Object.values(NORMAL_TEACHER_FIXTURE.lessonDetails)
        .find((detail) => detail.status === 'SCHEDULED')!;
      send({ data: { ...baseline, id: target.lessonSessionId, startsAt: target.startsAt,
        courseName: target.courseName, students: baseline.students.map((student) => ({
          ...student,
          attendanceStatus: student.id === target.studentId && target.status === 'APPROVED' ? 'LEAVE' : null,
          expectedConsumeUnits: 0,
        })) } }); return;
    }
    unexpected.push(`${request.method} ${path}`);
    send({ code: 'UNEXPECTED_TEST_ROUTE' }, 500);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    target, writes, unexpected,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

it.each(['approve', 'reject'] as const)(
  '%s travels through actual Pages and HTTP adapters into parent/teacher readback and refreshed home count',
  async (decision) => {
    const host = await syntheticHost();
    const env = capture(['home', 'leave-requests'], 'api', transport);
    env.change({ apiBaseUrl: host.baseUrl });
    try {
      const parent = new ParentService(new ApiParentDataSource({
        baseUrl: host.baseUrl, accessToken: 'synthetic-parent', request: transport,
      }));
      const teacher = new TeacherService(new ApiTeacherDataSource({
        baseUrl: host.baseUrl, accessToken: 'synthetic-teacher', request: transport,
      }));
      const initial = await parent.loadLeavePage();
      expect(initial).toMatchObject({ status: 'success', data: { records: [
        expect.objectContaining({ id: host.target.id, status: 'pending' }), expect.anything(),
      ] } });
      const home = env.instantiate('home');
      home.onLoad(); home.onShow(); await home.pendingRequest;
      expect(home.data.pendingCount).toBe('2');
      home.onLatestLeaveTap();
      expect(env.platform.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
        url: `/pages/operator/leave-requests/index?selectedLeaveId=${host.target.id}`,
      }));
      home.onHide();
      const approval = env.instantiate('leave-requests');
      approval.onLoad({ selectedLeaveId: host.target.id }); approval.onShow(); await approval.pendingRequest;
      expect(approval.data.selectedItem.id).toBe(host.target.id);
      if (decision === 'approve') {
        approval.onApproveTap(tap(host.target.id));
        env.platform.showModal.mock.calls[0][0].success({ confirm: true });
        await until(() => host.writes.length === 1 && !approval.pendingRequest &&
          !approval.data.submitting && !approval.data.items.some((item: any) => item.id === host.target.id));
      } else {
        approval.onRejectTap(tap(host.target.id));
        approval.onRejectReasonInput({ detail: { value: '  请核对课次后重新申请  ' } });
        await approval.onRejectSubmit();
      }
      expect(host.writes).toEqual([{
        path: `/operators/me/leave-requests/${host.target.id}/${decision}`,
        key: expect.stringMatching(/^campus-leave-/),
        body: { version: 1, ...(decision === 'reject' ? { reviewReason: '请核对课次后重新申请' } : {}) },
      }]);
      const readback = await parent.loadLeavePage();
      expect(readback).toMatchObject({ status: 'success', data: { records: [
        expect.objectContaining({ id: host.target.id, status: decision === 'approve' ? 'approved' : 'rejected',
          reviewerName: fixture.profile.displayName, reviewedAt: '2026-10-24T04:00:00.000Z',
          reviewReason: decision === 'reject' ? '请核对课次后重新申请' : null }), expect.anything(),
      ] } });
      const lesson = await teacher.loadLessonSession(host.target.lessonSessionId);
      expect(lesson).toMatchObject({ status: 'success', data: {
        status: 'SCHEDULED', students: expect.arrayContaining([
          expect.objectContaining({ id: host.target.studentId,
            attendanceStatus: decision === 'approve' ? 'LEAVE' : null, expectedConsumeUnits: 0 }),
        ]),
      } });
      approval.onTabTap(tap('history')); await approval.pendingRequest;
      expect(approval.data).toMatchObject({ activeTab: 'history', total: 1, selectedItem: null });
      expect(approval.data.items).toEqual([expect.objectContaining({
        id: host.target.id, status: host.target.status, canReview: false,
      })]);
      expect(env.calls[env.calls.length - 1].url).toContain('reviewedOnly=true');
      approval.onTabTap(tap('pending')); await approval.pendingRequest;
      expect(approval.data.items.map((item: { id: string }) => item.id)).toEqual([pendingRows[1].id]);
      approval.onHide();
      home.onShow(); await home.pendingRequest;
      expect(home.data.pendingCount).toBe('1');
      expect(home.data.latestLeaveId).toBe(pendingRows[1].id);
      expect(host.unexpected).toEqual([]);
      expect(env.calls.filter((call) => call.method !== 'GET')).toHaveLength(1);
    } finally {
      env.close();
      await host.close();
    }
  },
);
