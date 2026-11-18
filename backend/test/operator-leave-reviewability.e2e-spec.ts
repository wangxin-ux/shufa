import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import type { Prisma } from '@prisma/client';
import { OperatorScopeService } from '../src/common/auth/operator-scope.service';
import { OperatorLeaveService } from '../src/modules/operator/operator-leave.service';
import { OperatorReadService } from '../src/modules/operator/operator-read.service';

const campusId = '20000000-0000-4000-8000-000000000001';
const otherCampusId = '20000000-0000-4000-8000-000000000002';
const actor = { userId: '10000000-0000-4000-8000-000000000001',
  roles: [{ code: 'OPERATOR' as const, campusId }] };
const id = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function row(n: number, status = 'PENDING') {
  return {
    id: id(n), campusId, studentId: id(100 + n), lessonSessionId: id(200 + n),
    reason: `Synthetic reason ${n}`, status, reviewedAt: null, reviewReason: null,
    version: 1, createdAt: new Date(`2040-10-${String(n).padStart(2, '0')}T01:00:00Z`),
    student: { displayName: `Synthetic student ${n}` },
    lessonSession: { startsAt: new Date('2040-11-01T01:00:00Z'),
      classGroup: { courseName: `Synthetic course ${n}` } },
    reviewer: null,
  };
}

// This provider supplies independent query results; it does not execute PostgreSQL.
function host() {
  const rows = [row(1), row(2), row(3), row(4), row(5, 'APPROVED'), row(6)];
  const eligible = new Set([id(1), id(2)]);
  const raw = jest.fn((query: Prisma.Sql): Promise<Array<{
    id: string; studentName?: string; courseName?: string; startsAt?: Date; total?: bigint;
  }>> => {
    if (query.sql.includes('COUNT(*) OVER')) {
      const latest = rows.filter(item => eligible.has(item.id))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return Promise.resolve(latest ? [{
        id: latest.id, studentName: latest.student.displayName,
        courseName: latest.lessonSession.classGroup.courseName,
        startsAt: latest.lessonSession.startsAt, total: BigInt(eligible.size),
      }] : []);
    }
    return Promise.resolve([...eligible].map(value => ({ id: value })));
  });
  const matching = (where: { campusId: string; status?: string | { in: string[] } }) =>
    rows.filter(item => item.campusId === where.campusId && (!where.status ||
      (typeof where.status === 'string' ? item.status === where.status : where.status.in.includes(item.status))));
  const requests = {
    count: jest.fn((args: { where: Parameters<typeof matching>[0] }) => Promise.resolve(matching(args.where).length)),
    findMany: jest.fn((args: { where: Parameters<typeof matching>[0]; skip: number; take: number }) =>
      Promise.resolve(matching(args.where).slice(args.skip, args.skip + args.take))),
    findFirst: jest.fn(() => Promise.resolve(rows[rows.length - 1])),
    updateMany: jest.fn(),
  };
  const tx = { parentLeaveRequest: requests, $queryRaw: raw };
  const prisma = {
    ...tx,
    user: { findFirst: jest.fn().mockResolvedValue({ displayName: 'Synthetic operator' }) },
    campus: { findUnique: jest.fn().mockResolvedValue({ id: campusId, name: 'Synthetic campus', timezone: 'Asia/Shanghai' }) },
    student: { count: jest.fn().mockResolvedValue(20) },
    lessonSession: { count: jest.fn().mockResolvedValue(3) },
    $transaction: jest.fn((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const service = new OperatorLeaveService(
    prisma as unknown as ConstructorParameters<typeof OperatorLeaveService>[0],
    new OperatorScopeService(), {} as ConstructorParameters<typeof OperatorLeaveService>[2],
  );
  const dashboard = new OperatorReadService(
    prisma as unknown as ConstructorParameters<typeof OperatorReadService>[0],
    new OperatorScopeService(),
  );
  return { rows, eligible, prisma, requests, raw, service, dashboard };
}

describe('operator leave actionability actual read services (offline)', () => {
  it('keeps pending history and total while marking only current relationships reviewable', async () => {
    const h = host();
    const before = structuredClone(h.rows);
    const result = await h.service.list(actor, { page: 1, pageSize: 100, status: 'PENDING' });
    expect(result.data.map(item => ({ id: item.id, canReview: (item as { canReview?: boolean }).canReview })))
      .toEqual(h.rows.filter(item => item.status === 'PENDING')
        .map(item => ({ id: item.id, canReview: h.eligible.has(item.id) })));
    expect(result.meta.total).toBe(5);
    expect(h.rows).toEqual(before);
    expect(h.requests.updateMany).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
  });

  it('does not make a reviewed row actionable even if a stale provider includes its ID', async () => {
    const h = host();
    h.eligible.add(id(5));
    const result = await h.service.list(actor, { page: 1, pageSize: 100, reviewedOnly: true });
    expect(result.data.find(item => item.id === id(5))).toMatchObject({ canReview: false });
  });

  it('uses one bounded ID query inside the page snapshot rather than a query per request', async () => {
    const h = host();
    await h.service.list(actor, { page: 1, pageSize: 100 });
    expect(h.raw).toHaveBeenCalledTimes(1);
    const query = h.raw.mock.calls[0][0];
    expect(query.values).toContain(campusId);
    for (const item of h.rows) expect(query.values).toContain(item.id);
    expect(query.sql).not.toContain(campusId);
    expect(query.sql).not.toContain(id(1));
  });

  it('does not issue an eligibility query for an empty page', async () => {
    const h = host();
    h.rows.splice(0);
    const result = await h.service.list(actor, { page: 1, pageSize: 100 });
    expect(result.data).toEqual([]);
    expect(h.raw).not.toHaveBeenCalled();
  });

  it('dashboard count/latest use the same actionable result and skip newer unavailable history', async () => {
    const h = host();
    const result = await h.dashboard.getDashboard(actor);
    expect(result.pendingLeaveCount).toBe(2);
    expect(result.latestPendingLeave).toEqual({
      id: id(2), studentName: 'Synthetic student 2', courseName: 'Synthetic course 2',
      startsAt: '2040-11-01T01:00:00.000Z',
    });
    expect(h.raw).toHaveBeenCalledTimes(1);
    expect(h.requests.count).not.toHaveBeenCalled();
    expect(h.requests.findFirst).not.toHaveBeenCalled();
  });

  it('keeps historical pending records but reports no tasks when all relationships are unavailable', async () => {
    const h = host();
    h.eligible.clear();
    const result = await h.dashboard.getDashboard(actor);
    expect(result.pendingLeaveCount).toBe(0);
    expect(result.latestPendingLeave).toBeNull();
    expect(h.rows.filter(item => item.status === 'PENDING')).toHaveLength(5);
  });

  it('rejects an unsafe SQL count instead of rounding it', async () => {
    const h = host();
    h.raw.mockResolvedValueOnce([{ ...h.rows[0], studentName: 'Synthetic', courseName: 'Synthetic',
      startsAt: new Date(), total: BigInt(Number.MAX_SAFE_INTEGER) + 1n }]);
    await expect(h.dashboard.getDashboard(actor)).rejects.toMatchObject({ statusCode: 500 });
  });

  it.each([
    { userId: actor.userId, roles: [{ code: 'OPERATOR' as const, campusId: null }] },
    { userId: actor.userId, roles: [...actor.roles, { code: 'OPERATOR' as const, campusId: otherCampusId }] },
  ])('rejects invalid scopes before reading requests', async user => {
    const h = host();
    await expect(h.service.list(user, { page: 1, pageSize: 20 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(h.dashboard.getDashboard(user)).rejects.toMatchObject({ statusCode: 403 });
    expect(h.raw).not.toHaveBeenCalled();
    expect(h.requests.findMany).not.toHaveBeenCalled();
  });

  it('does not add a new lesson-time/status gate to the existing membership-only approval rule', async () => {
    const h = host();
    await h.service.list(actor, { page: 1, pageSize: 20 });
    expect(h.raw).toHaveBeenCalledTimes(1);
    const query = h.raw.mock.calls[0][0];
    expect(query.sql).not.toMatch(/l\."(?:startsAt|status)"\s*(?:>|=|IN)/);
  });
});

describe('operator leave capability contract', () => {
  it('documents boolean capability and legacy replay omission without changing leave status', () => {
    const document = load(readFileSync(resolve(__dirname, '../../contracts/operator.openapi.yaml'), 'utf8')) as {
      components: { schemas: Record<string, { properties: Record<string, { type?: string; description?: string }> }> };
    };
    expect(document.components.schemas.OperatorLeaveRequestView.properties.canReview).toMatchObject({ type: 'boolean' });
    expect(document.components.schemas.OperatorLeaveRequestView.properties.canReview.description)
      .toMatch(/legacy.*replay/i);
    expect(document.components.schemas.OperatorDashboardView.properties.pendingLeaveCount.description)
      .toMatch(/reviewable/i);
  });
});
