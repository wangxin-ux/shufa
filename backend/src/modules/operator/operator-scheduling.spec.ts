import { OperatorScopeService } from '../../common/auth/operator-scope.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { OperatorSchedulingService } from './operator-scheduling.service';

const actor = {
  userId: 'operator',
  roles: [{ code: 'OPERATOR' as const, campusId: 'campus' }],
};
const future = {
  startsAt: '2040-01-02T06:00:00Z',
  endsAt: '2040-01-02T07:00:00Z',
  kind: 'REGULAR' as const,
};

function setup(replayed = false) {
  const row = {
    id: 'lesson',
    campusId: 'campus',
    classGroupId: 'group',
    teacherId: 'teacher',
    startsAt: new Date('2020-01-01T06:00:00Z'),
    endsAt: new Date('2020-01-01T07:00:00Z'),
    status: 'SCHEDULED',
    version: 1,
    kind: 'REGULAR',
    lessonUnits: 100,
    classGroup: { name: 'group', courseName: 'course' },
    teacher: { user: { displayName: 'teacher' } },
  };
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: row.id }]),
    lessonSession: {
      findFirst: jest.fn().mockResolvedValue(row),
      updateMany,
      findUniqueOrThrow: jest.fn().mockResolvedValue(row),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const original = { id: 'original-result', status: 'SCHEDULED' };
  const service = new OperatorSchedulingService(
    {
      $transaction: (action: (transaction: typeof tx) => unknown) => action(tx),
    } as unknown as PrismaService,
    new OperatorScopeService(),
    {
      claim: jest
        .fn()
        .mockResolvedValue(
          replayed
            ? { replayed: true, responseBody: original }
            : { replayed: false },
        ),
      complete: jest.fn().mockResolvedValue(undefined),
    } as unknown as IdempotencyService,
  );
  return { service, updateMany, original, tx, row };
}

it('refuses editing a lesson whose original start has passed even if its state is still scheduled', async () => {
  const { service, updateMany } = setup();
  await expect(
    service.update(actor, 'lesson', { ...future, version: 1 }, 'key'),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(updateMany).not.toHaveBeenCalled();
});

it('refuses cancelling a scheduled lesson after its original start', async () => {
  const { service, updateMany } = setup();
  await expect(
    service.cancel(actor, 'lesson', { version: 1 }, 'key'),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(updateMany).not.toHaveBeenCalled();
});

it('replays a successful create after its requested start instead of revalidating it as a new write', async () => {
  const { service, original } = setup(true);
  await expect(
    service.create(
      actor,
      {
        classGroupId: 'group',
        startsAt: '2020-01-01T06:00:00Z',
        endsAt: '2020-01-01T07:00:00Z',
        kind: 'REGULAR',
      },
      'same-key',
    ),
  ).resolves.toEqual(original);
});

it('replays a successful update after its requested start', async () => {
  const { service, original } = setup(true);
  await expect(
    service.update(
      actor,
      'lesson',
      {
        version: 1,
        startsAt: '2020-01-01T06:00:00Z',
        endsAt: '2020-01-01T07:00:00Z',
        kind: 'REGULAR',
      },
      'same-key',
    ),
  ).resolves.toEqual(original);
});

it.each(['update', 'cancel'] as const)(
  'refuses %s when the lesson starts while waiting for its row lock',
  async (operation) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-27T06:00:00Z'));
    try {
      const { service, updateMany, tx, row } = setup();
      row.startsAt = new Date('2026-10-27T06:00:01Z');
      Object.assign(tx, {
        $queryRaw: jest.fn().mockImplementation(() => {
          jest.setSystemTime(new Date('2026-10-27T06:00:02Z'));
          return Promise.resolve([{ id: row.id }]);
        }),
      });
      const result =
        operation === 'update'
          ? service.update(actor, 'lesson', { ...future, version: 1 }, 'key')
          : service.cancel(actor, 'lesson', { version: 1 }, 'key');
      await expect(result).rejects.toMatchObject({ statusCode: 409 });
      expect(updateMany).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  },
);
