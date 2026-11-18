import { loadActiveRoster, type LockedLessonSession } from '../src/modules/attendance/lesson-mutation.helper';
import { summarizeTeacherLessonRoster, type TeacherRosterSummaryRow } from '../src/modules/scheduling/teacher-roster-summary';
import { OperatorLessonMembersService } from '../src/modules/operator/operator-lesson-members.service';
import { OperatorScopeService } from '../src/common/auth/operator-scope.service';
import { ParentPortalService } from '../src/modules/parent-portal/parent-portal.service';
import { OperatorLeaveService } from '../src/modules/operator/operator-leave.service';
import { OperatorLessonMembersController } from '../src/modules/operator/operator-lesson-members.controller';
import { OperatorAddLessonMemberDto, OperatorRemoveLessonMemberDto } from '../src/modules/operator/dto/operator-lesson-members.dto';
import { ValidationPipe } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

const campusId = '20000000-0000-4000-8000-000000000001';
const studentId = '50000000-0000-4000-8000-000000000001';
const temporaryId = '50000000-0000-4000-8000-000000000002';
const lesson: LockedLessonSession = {
  id: '40000000-0000-4000-8000-000000000001',
  campusId, teacherId: '30000000-0000-4000-8000-000000000001',
  classGroupId: '60000000-0000-4000-8000-000000000001',
  startsAt: new Date('2040-10-30T01:00:00Z'),
  endsAt: new Date('2040-10-30T02:00:00Z'),
  status: 'SCHEDULED', kind: 'REGULAR', lessonUnits: 100, version: 1, completedAt: null,
};
function member(id: string) {
  return { studentId: id, student: { id, displayName: id, coursePackages: [] } };
}
function roster(regular = [member(studentId)], temporary = [member(temporaryId)]) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: lesson.classGroupId }]),
    classMember: { findMany: jest.fn().mockResolvedValue(regular) },
    lessonTemporaryMember: { findMany: jest.fn().mockResolvedValue(temporary) },
  };
}
function tx(value: ReturnType<typeof roster>) {
  return value as unknown as Parameters<typeof loadActiveRoster>[0];
}
function summary(status = 'SCHEDULED') {
  return {
    ...lesson, status,
    campus: { lessonWarningThresholdUnits: 500 },
    classGroup: { members: [member(studentId)] },
    temporaryMembers: [{ ...member(temporaryId), id: 'episode-0' }],
    attendanceRecords: [],
    parentLeaveRequests: [{ studentId: temporaryId, temporaryMemberId: 'episode-0' }],
  } as unknown as TeacherRosterSummaryRow;
}
describe('temporary members use the actual current roster (offline)', () => {
  it('includes a temporary student in the actual attendance roster', async () => {
    expect(await loadActiveRoster(tx(roster()), lesson)).toEqual([
      { studentId, displayName: studentId },
      { studentId: temporaryId, displayName: temporaryId },
    ]);
  });
  it('deduplicates a student who is now also a regular member', async () => {
    const host = roster([member(studentId)], [member(studentId), member(temporaryId)]);
    expect(await loadActiveRoster(tx(host), lesson)).toHaveLength(2);
  });
  it('selects active same-campus temporary relations without a first-page limit', async () => {
    const host = roster();
    await loadActiveRoster(tx(host), lesson);
    expect(host.lessonTemporaryMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        campusId, lessonSessionId: lesson.id, removedAt: null,
        student: { campusId, isActive: true },
      },
    }));
  });
  it('counts leave/low balance for temporary members in the same summary', () => {
    expect(summarizeTeacherLessonRoster(summary(), new Date())).toMatchObject({
      expectedCount: 2, leaveCount: 1, warningCount: 2, source: 'CURRENT',
    });
  });
  it.each(['COMPLETED', 'REVERSED'])('does not fill %s history with temporary current relations', (status) => {
    expect(summarizeTeacherLessonRoster(summary(status), new Date()).expectedCount).toBe(0);
  });
});

const actor = { userId: '10000000-0000-4000-8000-000000000001',
  roles: [{ code: 'OPERATOR' as const, campusId }] };
interface Episode {
  id: string; campusId: string; lessonSessionId: string; studentId: string;
  joinedAt: Date; removedAt: Date | null; addedByUserId: string; removedByUserId: string | null;
}
interface Filter {
  id?: string; campusId?: string; status?: string | { in: string[] };
  OR?: Array<{
    classGroup?: { members: { some: { studentId: string } } };
    temporaryMembers?: { some: { studentId: string } };
  }>;
  classGroup?: { members: { some: { studentId: string } } };
  temporaryMembers?: { some: { id?: string; studentId: string } };
  AND?: Filter[];
}
function operations() {
  const state = {
    lesson: { ...lesson },
    regular: [studentId],
    episodes: [] as Episode[],
    active: true,
    studentCampusId: campusId,
    packages: [{
      id: '70000000-0000-4000-8000-000000000001', mainBalanceUnits: 120,
      giftBalanceUnits: 80, mainReservedUnits: 0, giftReservedUnits: 0,
      isActive: true, validFrom: new Date('2000-01-01'), expiresAt: null as Date | null,
    }],
    audits: [] as unknown[],
    leaves: [{ id: 'leave', campusId, temporaryMemberId: 'episode-0', studentId: temporaryId, lessonSessionId: lesson.id, status: 'PENDING', version: 1 }],
    savedDrafts: [{ studentId: temporaryId, status: 'LEAVE' }],
  };
  const events: string[] = [];
  const responses = new Map<string, unknown>();
  const hasStudent = () => state.active && state.studentCampusId === campusId;
  const activeEpisodes = () => state.episodes.filter(row => row.removedAt === null);
  const makeMember = (id: string) => ({ studentId: id, student: { displayName: id } });
  const tx = {
    $queryRaw: jest.fn((parts: TemplateStringsArray) => {
      const sql = parts.join('');
      events.push(sql);
      if (sql.includes('FROM "CoursePackage"')) return Promise.resolve(state.packages);
      if (sql.includes('FROM "LessonSession"')) return Promise.resolve([{ ...state.lesson }]);
      if (sql.includes('FROM "ParentLeaveRequest"')) return Promise.resolve(state.leaves);
      return Promise.resolve([{ id: temporaryId }]);
    }),
    lessonSession: {
      findFirst: jest.fn((args: { where: Filter }) => {
        const where = args.where;
        if ((where.id && where.id !== lesson.id) || (where.campusId && where.campusId !== campusId))
          return Promise.resolve(null);
        if (where.status && (typeof where.status === 'string'
          ? state.lesson.status !== where.status : !where.status.in.includes(state.lesson.status)))
          return Promise.resolve(null);
        if (where.temporaryMembers && !activeEpisodes().some(row =>
          row.studentId === where.temporaryMembers!.some.studentId &&
          row.id === where.temporaryMembers!.some.id)) return Promise.resolve(null);
        if (where.classGroup && !state.regular.includes(where.classGroup.members.some.studentId))
          return Promise.resolve(null);
        if (where.AND?.some(clause => clause.classGroup &&
          !state.regular.includes(clause.classGroup.members.some.studentId))) return Promise.resolve(null);
        if (where.OR && !where.OR.some(clause => {
          const id = clause.classGroup?.members.some.studentId ?? clause.temporaryMembers?.some.studentId;
          if (!id || !hasStudent()) return false;
          return clause.classGroup ? state.regular.includes(id)
            : activeEpisodes().some(row => row.studentId === id);
        })) return Promise.resolve(null);
        return Promise.resolve({
          ...state.lesson, campus: { name: 'Synthetic campus' },
          classGroup: { courseName: 'Synthetic course' },
          teacher: { user: { displayName: 'Synthetic teacher' } },
        });
      }),
      updateMany: jest.fn((args: { where: { version: number; startsAt: { gt: Date } } }) => {
        if (args.where.version !== state.lesson.version || state.lesson.startsAt <= args.where.startsAt.gt)
          return Promise.resolve({ count: 0 });
        state.lesson.version++;
        return Promise.resolve({ count: 1 });
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    student: { findFirst: jest.fn(() => Promise.resolve(hasStudent() ? { id: temporaryId } : null)) },
    classMember: {
      findFirst: jest.fn((args: { where: { studentId: string } }) =>
        Promise.resolve(state.regular.includes(args.where.studentId) ? { id: 'regular' } : null)),
      findMany: jest.fn(() => Promise.resolve(state.regular.map(makeMember))),
    },
    lessonTemporaryMember: {
      findFirst: jest.fn((args: { where: { studentId: string } }) =>
        Promise.resolve(activeEpisodes().find(row => row.studentId === args.where.studentId) ?? null)),
      findMany: jest.fn(() => Promise.resolve(hasStudent()
        ? activeEpisodes().map(row => makeMember(row.studentId)) : [])),
      create: jest.fn((args: { data: Omit<Episode, 'id' | 'removedAt' | 'removedByUserId'> }) => {
        const row = { ...args.data, id: `episode-${state.episodes.length}`, removedAt: null, removedByUserId: null };
        state.episodes.push(row);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn((args: { where: { id: string }; data: { removedAt: Date; removedByUserId: string } }) => {
        const row = state.episodes.find(row => row.id === args.where.id && row.removedAt === null);
        if (row) Object.assign(row, args.data);
        return Promise.resolve({ count: row ? 1 : 0 });
      }),
    },
    auditLog: { create: jest.fn((args: unknown) => { state.audits.push(args); return Promise.resolve({}); }) },
    attendanceRecord: { findMany: jest.fn().mockResolvedValue([
      { ...makeMember(temporaryId), status: 'PRESENT' },
    ]), count: jest.fn().mockResolvedValue(0) },
    parentLeaveRequest: {
      findFirst: jest.fn(() => Promise.resolve(state.leaves[0] ?? null)),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'new-leave', studentId: temporaryId,
        lessonSessionId: lesson.id, reason: 'Synthetic', status: 'PENDING' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'leave', studentId: temporaryId, lessonSessionId: lesson.id,
        reason: 'Synthetic', status: 'APPROVED', reviewedAt: new Date(), reviewReason: null,
        version: 2, createdAt: new Date(), student: { displayName: 'Synthetic student' },
        lessonSession: { startsAt: lesson.startsAt, classGroup: { courseName: 'Synthetic course' } },
        reviewer: { displayName: 'Synthetic operator' },
      }),
    },
    campus: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Synthetic campus', contactPhone: null }) },
  };
  const prisma = { ...tx, $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => {
    const before = structuredClone(state);
    try { return await callback(tx); } catch (error) { Object.assign(state, before); throw error; }
  } };
  const idempotency = {
    claim: jest.fn((_tx: unknown, args: { key: string }) => Promise.resolve(responses.has(args.key)
      ? { replayed: true, responseBody: responses.get(args.key) } : { replayed: false })),
    complete: jest.fn((_tx: unknown, args: { key: string; responseBody: unknown }) => {
      responses.set(args.key, args.responseBody); return Promise.resolve();
    }),
  };
  const service = new OperatorLessonMembersService(
    prisma as unknown as ConstructorParameters<typeof OperatorLessonMembersService>[0],
    new OperatorScopeService(),
    idempotency as unknown as ConstructorParameters<typeof OperatorLessonMembersService>[2],
  );
  const parent = new ParentPortalService(
    prisma as unknown as ConstructorParameters<typeof ParentPortalService>[0],
    { resolveStudent: jest.fn().mockResolvedValue({ id: temporaryId }) } as unknown as ConstructorParameters<typeof ParentPortalService>[1],
    idempotency as unknown as ConstructorParameters<typeof ParentPortalService>[2],
    {} as ConstructorParameters<typeof ParentPortalService>[3],
  );
  const reviewer = new OperatorLeaveService(
    prisma as unknown as ConstructorParameters<typeof OperatorLeaveService>[0], new OperatorScopeService(),
    idempotency as unknown as ConstructorParameters<typeof OperatorLeaveService>[2],
  );
  const add = (version = state.lesson.version, key = `add-${version}`) =>
    service.add(actor, lesson.id, { studentId: temporaryId, version }, key);
  const remove = (version = state.lesson.version, key = `remove-${version}`) =>
    service.remove(actor, lesson.id, temporaryId, { version }, key);
  return { state, tx, events, service, parent, reviewer, idempotency, add, remove };
}
describe('operator temporary membership actual service/validation (offline)', () => {
  it('adds one episode, bumps version and leaves packages, reservations and drafts intact', async () => {
    const host = operations();
    const packages = structuredClone(host.state.packages);
    const result = await host.add();
    expect(result).toMatchObject({ lessonVersion: 2, members: [
      { studentId, source: 'CLASS', canRemove: false },
      { studentId: temporaryId, source: 'TEMPORARY', canRemove: true },
    ] });
    expect(host.state.episodes).toHaveLength(1);
    expect(host.state.packages).toEqual(packages);
    expect(host.state.savedDrafts).toHaveLength(1);
    expect(host.events.findIndex(sql => sql.includes('FROM "LessonSession"')))
      .toBeLessThan(host.events.findIndex(sql => sql.includes('FROM "ClassGroup"')));
    expect(host.events.findIndex(sql => sql.includes('FROM "Student"')))
      .toBeLessThan(host.events.findIndex(sql => sql.includes('FROM "CoursePackage"')));
  });
  it('does not create another episode for duplicate or already regular membership', async () => {
    const host = operations();
    await host.add();
    await host.add(2, 'another-key');
    expect(host.state.lesson.version).toBe(2);
    expect(host.state.episodes).toHaveLength(1);
    host.state.regular.push(temporaryId);
    await host.add(2, 'regular');
    expect(host.state.episodes).toHaveLength(1);
    await expect(host.remove()).rejects.toMatchObject({ statusCode: 409 });
  });
  it('removes without deleting episodes/leaves/drafts and re-adds a new episode', async () => {
    const host = operations();
    await host.add();
    const leaves = structuredClone(host.state.leaves);
    await host.remove();
    expect(host.state.episodes[0].removedAt).toBeInstanceOf(Date);
    expect(host.state.leaves).toEqual(leaves);
    expect(host.state.savedDrafts).toHaveLength(1);
    await host.remove(3, 'already-removed');
    expect(host.state.lesson.version).toBe(3);
    await host.add(3, 're-add');
    expect(host.state.episodes).toHaveLength(2);
    expect(host.state.episodes[0].removedAt).not.toBeNull();
    expect(host.state.episodes[1].removedAt).toBeNull();
  });
  it.each(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'REVERSED', 'CANCELLED'] as const)(
    'rejects nonfuture/noneditable %s before a membership write', async status => {
      const host = operations();
      host.state.lesson.status = status;
      if (status === 'SCHEDULED') host.state.lesson.startsAt = new Date('2000-01-01');
      await expect(host.add()).rejects.toMatchObject({ statusCode: 409 });
      expect(host.tx.lessonTemporaryMember.create).not.toHaveBeenCalled();
    },
  );
  it.each(['inactive', 'other-campus', 'reserved', 'expired', 'future-package', 'missing-package'] as const)(
    'rejects %s without changing the roster', async kind => {
      const host = operations();
      if (kind === 'inactive') host.state.active = false;
      if (kind === 'other-campus') host.state.studentCampusId = 'another-campus';
      if (kind === 'reserved') {
        host.state.packages[0].mainReservedUnits = 120;
        host.state.packages[0].giftReservedUnits = 80;
      }
      if (kind === 'expired') host.state.packages[0].expiresAt = new Date('2000-01-02');
      if (kind === 'future-package') host.state.packages[0].validFrom = new Date('2099-01-01');
      if (kind === 'missing-package') host.state.packages = [];
      await expect(host.add()).rejects.toMatchObject({ statusCode: kind === 'inactive' || kind === 'other-campus' ? 403 : 409 });
      expect(host.state.episodes).toHaveLength(0);
      expect(host.state.lesson.version).toBe(1);
    },
  );
  it('rejects stale version and a start reached during package locking', async () => {
    const host = operations();
    await expect(host.add(9)).rejects.toMatchObject({ code: 'LESSON_VERSION_CONFLICT' });
    jest.useFakeTimers().setSystemTime(new Date('2040-10-30T00:59:59Z'));
    try {
      host.tx.$queryRaw.mockImplementation(parts => {
        const sql = parts.join('');
        if (sql.includes('FROM "CoursePackage"')) {
          jest.setSystemTime(new Date('2040-10-30T01:00:01Z'));
          return Promise.resolve(host.state.packages);
        }
        return Promise.resolve([{ id: lesson.id }]);
      });
      await expect(host.add()).rejects.toMatchObject({ statusCode: 409 });
      expect(host.state.episodes).toHaveLength(0);
    } finally { jest.useRealTimers(); }
  });
  it('returns a replay after start and does not recheck balance or mutate again', async () => {
    const host = operations();
    const result = await host.add(1, 'same-key');
    host.state.lesson.startsAt = new Date('2000-01-01');
    host.state.packages = [];
    expect(await host.add(1, 'same-key')).toEqual(result);
    expect(host.state.episodes).toHaveLength(1);
  });
  it('rolls back a membership/version in the memory provider if audit fails (not SQL proof)', async () => {
    const host = operations();
    host.tx.auditLog.create.mockRejectedValueOnce(new Error('Synthetic audit failure'));
    await expect(host.add()).rejects.toThrow('Synthetic audit failure');
    expect(host.state.episodes).toHaveLength(0);
    expect(host.state.lesson.version).toBe(1);
    expect(host.idempotency.complete).not.toHaveBeenCalled();
  });
  it('does not expose current members as final history or permit a total/mixed operator', async () => {
    const host = operations();
    await host.add();
    host.state.lesson.status = 'COMPLETED';
    expect(await host.service.list(actor, lesson.id)).toMatchObject({
      members: [{ studentId: temporaryId, source: 'HISTORICAL', canRemove: false }],
    });
    await expect(host.service.list({ ...actor, roles: [{ code: 'OPERATOR', campusId: null }] }, lesson.id))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(host.service.list({ ...actor, roles: [...actor.roles, { code: 'OPERATOR', campusId }] }, lesson.id))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(host.service.list(actor, 'other-lesson')).rejects.toMatchObject({ statusCode: 404 });
  });
  it('validates the actual add/remove DTOs and controller permissions', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    await expect(pipe.transform({ version: 1, studentId: temporaryId },
      { type: 'body', metatype: OperatorAddLessonMemberDto })).resolves.toBeInstanceOf(OperatorAddLessonMemberDto);
    for (const body of [{ version: 0 }, { version: 1, studentId: temporaryId }, { version: 2147483648 }])
      await expect(pipe.transform(body, { type: 'body', metatype: OperatorRemoveLessonMemberDto })).rejects.toThrow();
    const controller = OperatorLessonMembersController.prototype;
    for (const [name, permission] of [
      ['add', 'OPERATOR_SCHEDULE_UPDATE'], ['remove', 'OPERATOR_SCHEDULE_UPDATE'],
      ['list', 'OPERATOR_SCHEDULE_READ'],
    ])
      expect(Reflect.getMetadata('required-permissions',
        Object.getOwnPropertyDescriptor(controller, name)!.value as object)).toEqual([permission]);
  });
  it('connects both paths from the main contract and retains migration history constraints', () => {
    const main = load(readFileSync(resolve(__dirname, '../../contracts/openapi.yaml'), 'utf8')) as {
      paths: Record<string, { $ref: string }>;
    };
    expect(main.paths['/operators/me/lesson-sessions/{lessonSessionId}/members'].$ref).toContain('operator-lesson-members.openapi.yaml');
    const migration = readFileSync(resolve(__dirname,
      '../prisma/migrations/202610290002_lesson_temporary_members/migration.sql'), 'utf8');
    expect(migration).toContain('WHERE "removedAt" IS NULL');
    expect(migration).not.toMatch(/DELETE FROM|UPDATE "Student"|REFERENCES "Student" \("id", "campusId"\)/);
  });
});
describe('temporary relation parent leave and operator review (actual services, offline)', () => {
  const parentScope = { userId: '10000000-0000-4000-8000-000000000002', campusId };
  it('shows the temporary lesson in the actual parent home and hides it after removal', async () => {
    const host = operations();
    await host.add();
    const candidate = {
      ...lesson, campus: { name: 'Synthetic campus' },
      classGroup: { courseName: 'Synthetic course' },
      teacher: { user: { displayName: 'Synthetic teacher' } },
    };
    const findMany = jest.fn((args: { where: { AND: [unknown, Filter] } }) => {
      const relation = args.where.AND[1];
      const current = host.state.episodes.some(row => row.removedAt === null);
      const allowed = relation.OR?.some(clause =>
        clause.temporaryMembers?.some.studentId === temporaryId && current);
      return Promise.resolve(allowed ? [candidate] : []);
    });
    const home = new ParentPortalService(
      { ...host.tx, lessonSession: { ...host.tx.lessonSession, findMany },
        coursePackage: { findMany: jest.fn().mockResolvedValue([]) },
        teacherProfile: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as ConstructorParameters<typeof ParentPortalService>[0],
      { resolveStudent: jest.fn().mockResolvedValue({ id: temporaryId }) } as unknown as ConstructorParameters<typeof ParentPortalService>[1],
      {} as ConstructorParameters<typeof ParentPortalService>[2],
      {} as ConstructorParameters<typeof ParentPortalService>[3],
    );
    expect(await home.getHome(parentScope)).toMatchObject({
      nextLesson: { id: lesson.id }, reminders: [{ id: lesson.id }],
    });
    await host.remove();
    expect(await home.getHome(parentScope)).toMatchObject({ nextLesson: null, reminders: [] });
  });
  it('allows a bound temporary student to submit leave, locking lesson before student', async () => {
    const host = operations();
    await host.add();
    host.events.length = 0;
    expect(await host.parent.submitLeave(parentScope,
      { studentId: temporaryId, lessonSessionId: lesson.id, reason: 'Synthetic leave' }, 'parent-leave'))
      .toMatchObject({ status: 'PENDING', studentId: temporaryId });
    expect(host.events[0]).toContain('FROM "LessonSession"');
    expect(host.events.find(sql => sql.includes('FROM "Student"'))).toContain('FOR UPDATE OF s FOR SHARE OF b');
    expect(await host.reviewer.approve(actor, 'leave', { version: 1 }, 'approve'))
      .toMatchObject({ status: 'APPROVED' });
  });
  it.each(['approve', 'reject'] as const)('blocks new %s and new parent leave after removal, preserving the old leave', async action => {
    const host = operations();
    await host.add(); await host.remove();
    await expect(host.reviewer[action](actor, 'leave',
      { version: 1, reviewReason: 'Synthetic reason' }, 'review'))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(host.tx.parentLeaveRequest.updateMany).not.toHaveBeenCalled();
    await expect(host.parent.submitLeave(parentScope,
      { studentId: temporaryId, lessonSessionId: lesson.id, reason: 'Synthetic leave' }, 'parent-leave'))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(host.tx.parentLeaveRequest.create).not.toHaveBeenCalled();
    expect(host.state.leaves).toHaveLength(1);
  });
  it('does not let a re-add authorize approval of an old membership episode', async () => {
    const host = operations();
    await host.add(); await host.remove(); await host.add(3, 're-add');
    await expect(host.reviewer.approve(actor, 'leave', { version: 1 }, 'old-episode'))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(host.tx.parentLeaveRequest.updateMany).not.toHaveBeenCalled();
  });
});
