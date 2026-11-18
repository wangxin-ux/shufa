import type { Prisma } from '@prisma/client';
import {
  assertOperatorScheduleAvailable,
  lockOperatorScheduleResources,
} from './operator-scheduling-conflicts';
import { OperatorSchedulingService } from './operator-scheduling.service';
import { OperatorScopeService } from '../../common/auth/operator-scope.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service';

it('locks the same teacher and class deterministically without a global campus lock', async () => {
  const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
  await lockOperatorScheduleResources(
    tx as unknown as Prisma.TransactionClient,
    'teacher',
    'class',
  );
  expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  const calls = tx.$queryRaw.mock.calls as unknown as unknown[][];
  expect(calls.map((call) => call.slice(1))).toEqual([
    ['operator-schedule:class:class'],
    ['operator-schedule:teacher:teacher'],
  ]);
});

it('checks all noncancelled sessions for either resource, excluding the edited session', async () => {
  const tx = { lessonSession: { findMany: jest.fn().mockResolvedValue([]) } };
  await assertOperatorScheduleAvailable(
    tx as unknown as Prisma.TransactionClient,
    {
      campusId: 'campus',
      teacherId: 'teacher',
      classGroupId: 'class',
      startsAt: new Date('2040-01-02T06:00Z'),
      endsAt: new Date('2040-01-02T07:00Z'),
      excludeId: 'editing',
    },
  );
  const query = (
    tx.lessonSession.findMany.mock.calls as unknown as Array<[unknown]>
  )[0][0];
  expect(query).toMatchObject({
    where: {
      campusId: 'campus',
      status: { not: 'CANCELLED' },
      id: { not: 'editing' },
      OR: [{ teacherId: 'teacher' }, { classGroupId: 'class' }],
      startsAt: { lt: new Date('2040-01-02T07:00Z') },
      endsAt: { gt: new Date('2040-01-02T06:00Z') },
    },
  });
});

it('returns Shanghai conflict dates without disclosing another lesson or its students', async () => {
  const tx = {
    lessonSession: {
      findMany: jest.fn().mockResolvedValue([{ id: 'private' }]),
    },
  };
  await expect(
    assertOperatorScheduleAvailable(tx as unknown as Prisma.TransactionClient, {
      campusId: 'campus',
      teacherId: 'teacher',
      classGroupId: 'class',
      startsAt: new Date('2040-01-02T06:00Z'),
      endsAt: new Date('2040-01-02T07:00Z'),
    }),
  ).rejects.toMatchObject({
    statusCode: 409,
    details: { conflictDates: ['2040-01-02'] },
  });
});

it.each(['create', 'update'] as const)(
  'the actual ordinary %s refuses a conflicting series lesson',
  async (operation) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      classGroup: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'class',
          teacherId: 'teacher',
          defaultLessonUnits: 100,
          teacher: { userId: 'teacher-user' },
        }),
      },
      lessonSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'lesson',
          teacherId: 'teacher',
          classGroupId: 'class',
          version: 1,
          status: 'SCHEDULED',
          startsAt: new Date('2040-01-02T06:00Z'),
        }),
        findMany: jest.fn().mockResolvedValue([{ id: 'series-lesson' }]),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const service = new OperatorSchedulingService(
      {
        $transaction: (fn: (value: typeof tx) => unknown) => fn(tx),
      } as unknown as PrismaService,
      new OperatorScopeService(),
      {
        claim: jest.fn().mockResolvedValue({ replayed: false }),
      } as unknown as IdempotencyService,
    );
    const user = {
      userId: 'operator',
      roles: [{ code: 'OPERATOR' as const, campusId: 'campus' }],
    };
    const body = {
      classGroupId: 'class',
      version: 1,
      kind: 'REGULAR' as const,
      startsAt: '2040-01-02T06:00Z',
      endsAt: '2040-01-02T07:00Z',
    };
    const result =
      operation === 'create'
        ? service.create(user, body, 'key')
        : service.update(user, 'lesson', body, 'key');
    await expect(result).rejects.toMatchObject({
      statusCode: 409,
      details: { conflictDates: ['2040-01-02'] },
    });
    expect(tx.lessonSession.create).not.toHaveBeenCalled();
    expect(tx.lessonSession.updateMany).not.toHaveBeenCalled();
  },
);

it.each(['after-state-read', 'while-waiting-for-user'] as const)(
  'the actual single create protects teacher availability %s',
  async (interleaving) => {
    const locks: string[] = [];
    let active = true;
    let deactivationAttempted = false;
    const group = {
      id: 'class',
      teacherId: 'teacher',
      defaultLessonUnits: 100,
      teacher: { userId: 'teacher-user' },
    };
    const tx = {
      $queryRaw: jest.fn().mockImplementation((parts: TemplateStringsArray) => {
        const sql = parts.join('?');
        if (sql.includes('FROM "User"') && sql.includes('FOR SHARE')) {
          if (interleaving === 'while-waiting-for-user') active = false;
          locks.push('User');
        }
        if (sql.includes('FROM "TeacherProfile"')) locks.push('TeacherProfile');
        if (sql.includes('FROM "ClassGroup"')) locks.push('ClassGroup');
        return Promise.resolve([]);
      }),
      classGroup: {
        findFirst: jest
          .fn()
          .mockImplementation(() => Promise.resolve(active ? group : null)),
      },
      lessonSession: {
        findMany: jest.fn().mockImplementation(() => {
          if (interleaving === 'after-state-read') {
            deactivationAttempted = true;
            if (!locks.includes('User') || !locks.includes('TeacherProfile'))
              active = false;
          }
          return Promise.resolve([]);
        }),
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({
              ...data,
              id: 'created',
              seriesId: null,
              classGroup: { name: 'Class', courseName: 'Course' },
              teacher: { user: { displayName: 'Teacher' } },
            }),
          ),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new OperatorSchedulingService(
      {
        $transaction: (fn: (value: typeof tx) => unknown) => fn(tx),
      } as unknown as PrismaService,
      new OperatorScopeService(),
      {
        claim: jest.fn().mockResolvedValue({ replayed: false }),
        complete: jest.fn(),
      } as unknown as IdempotencyService,
    );
    const user = {
      userId: 'operator',
      roles: [{ code: 'OPERATOR' as const, campusId: 'campus' }],
    };
    const command = service.create(
      user,
      {
        classGroupId: 'class',
        kind: 'REGULAR',
        startsAt: '2040-01-02T06:00Z',
        endsAt: '2040-01-02T07:00Z',
      },
      'key',
    );
    if (interleaving === 'after-state-read') {
      await command;
      expect(deactivationAttempted).toBe(true);
      expect(active).toBe(true);
      expect(locks).toEqual(['User', 'TeacherProfile', 'ClassGroup']);
    } else {
      await expect(command).rejects.toMatchObject({ statusCode: 409 });
      expect(tx.lessonSession.create).not.toHaveBeenCalled();
    }
  },
);
