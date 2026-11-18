import { OperatorScopeService } from '../../common/auth/operator-scope.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { OperatorLessonSeriesService } from './operator-lesson-series.service';
import { expandOperatorSeries } from './operator-series-dates';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { OperatorCreateSeriesDto } from './dto/operator-lesson-series.dto';

const actor = {
  userId: 'operator',
  roles: [{ code: 'OPERATOR' as const, campusId: 'campus' }],
};
const pattern = {
  classGroupId: 'group',
  startDate: '2040-01-02',
  endDate: '2040-01-15',
  intervalWeeks: 1 as const,
  weekdays: [1, 3],
  startTime: '14:00',
  endTime: '15:00',
  kind: 'REGULAR' as const,
};

describe('strict JSON series input', () => {
  const valid = {
    ...pattern,
    classGroupId: '11111111-1111-4111-8111-111111111111',
    previewHash: 'a'.repeat(64),
  };
  it('accepts the documented numeric interval and exact preview hash', () => {
    expect(
      validateSync(plainToInstance(OperatorCreateSeriesDto, valid)),
    ).toHaveLength(0);
  });
  it.each([true, false, '1', 1.5])(
    'rejects a noninteger JSON interval %j',
    (intervalWeeks) => {
      const errors = validateSync(
        plainToInstance(OperatorCreateSeriesDto, { ...valid, intervalWeeks }),
      );
      expect(errors.some((error) => error.property === 'intervalWeeks')).toBe(
        true,
      );
    },
  );
  it('does not accept a confirmation without a server preview fingerprint', () => {
    const errors = validateSync(
      plainToInstance(OperatorCreateSeriesDto, {
        ...valid,
        previewHash: undefined,
      }),
    );
    expect(errors.some((error) => error.property === 'previewHash')).toBe(true);
  });
});

function setup() {
  const group = {
    id: 'group',
    campusId: 'campus',
    teacherId: 'teacher',
    defaultLessonUnits: 100,
    status: 'ACTIVE',
    updatedAt: new Date('2039-01-01Z'),
    teacher: {
      id: 'teacher',
      userId: 'teacher-user',
      campusId: 'campus',
      isActive: true,
      updatedAt: new Date('2039-01-01Z'),
      user: {
        status: 'ACTIVE',
        updatedAt: new Date('2039-01-01Z'),
        accountVersion: 1,
      },
    },
  };
  const lessons: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    classGroup: { findFirst: jest.fn().mockResolvedValue(group) },
    lessonSession: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve([])),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          const row = { ...data, id: `lesson-${lessons.length}`, version: 1 };
          lessons.push(row);
          return Promise.resolve(row);
        }),
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    lessonSeries: {
      create: jest.fn().mockResolvedValue({ id: 'series', version: 1 }),
      update: jest.fn().mockResolvedValue({ id: 'series', version: 2 }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const idempotency = {
    claim: jest.fn().mockResolvedValue({ replayed: false }),
    complete: jest.fn(),
  };
  const prisma = {
    $transaction: jest
      .fn()
      .mockImplementation((fn: (value: typeof tx) => unknown) => fn(tx)),
  };
  const service = new OperatorLessonSeriesService(
    prisma as unknown as PrismaService,
    new OperatorScopeService(),
    idempotency as unknown as IdempotencyService,
  );
  return { service, tx, group, lessons, prisma, idempotency };
}

describe('finite Shanghai series', () => {
  it('generates sorted Shanghai dates including multiple weekdays', () => {
    const dates = expandOperatorSeries(pattern);
    expect(dates.map((row) => row.date)).toEqual([
      '2040-01-02',
      '2040-01-04',
      '2040-01-09',
      '2040-01-11',
    ]);
    expect(dates[0].startsAt.toISOString()).toBe('2040-01-02T06:00:00.000Z');
  });
  it('anchors fortnightly weeks to Monday of the starting week', () => {
    expect(
      expandOperatorSeries({
        ...pattern,
        intervalWeeks: 2,
        endDate: '2040-01-30',
      }).map((row) => row.date),
    ).toEqual([
      '2040-01-02',
      '2040-01-04',
      '2040-01-16',
      '2040-01-18',
      '2040-01-30',
    ]);
  });
  it.each([
    { startDate: '2040-02-30' },
    { endDate: '2039-12-31' },
    { endDate: '2040-03-26' },
    { weekdays: [1, 1] },
    { weekdays: [] },
    { weekdays: [0] },
    { intervalWeeks: 3 },
    { endTime: '14:00' },
    { startTime: '25:00' },
    { weekdays: [1, 2, 3, 4, 5, 6, 7], endDate: '2040-03-25' },
  ])('rejects invalid or unbounded pattern %j', (change) => {
    expect(() => expandOperatorSeries({ ...pattern, ...change })).toThrow();
  });
  it('accepts exactly 84 days and exactly 50 lessons but not a 51st', () => {
    expect(
      expandOperatorSeries({
        ...pattern,
        startDate: '2040-01-02',
        endDate: '2040-03-25',
      }),
    ).toHaveLength(24);
    expect(
      expandOperatorSeries({
        ...pattern,
        endDate: '2040-02-20',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
      }),
    ).toHaveLength(50);
    expect(() =>
      expandOperatorSeries({
        ...pattern,
        endDate: '2040-02-21',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
      }),
    ).toThrow();
  });
});

describe('preview, confirmation and all-or-nothing service', () => {
  it('previews without writes and creates ordinary linked lessons after confirmation', async () => {
    const { service, tx, lessons, idempotency } = setup();
    const preview = await service.preview(actor, pattern);
    expect(tx.lessonSession.create).not.toHaveBeenCalled();
    expect(preview.sessions).toHaveLength(4);
    const result = await service.create(
      actor,
      { ...pattern, previewHash: preview.previewHash },
      'key',
    );
    expect(result).toMatchObject({ seriesId: 'series', version: 1 });
    expect(lessons).toHaveLength(4);
    expect(
      lessons.every(
        (row) =>
          row.seriesId === 'series' &&
          row.lessonUnits === 100 &&
          row.status === 'SCHEDULED',
      ),
    ).toBe(true);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(5);
    expect(idempotency.complete).toHaveBeenCalledTimes(1);
  });
  it('rejects an unconfirmed or changed class configuration before creating anything', async () => {
    const { service, tx, group } = setup();
    const preview = await service.preview(actor, pattern);
    group.defaultLessonUnits = 200;
    await expect(
      service.create(
        actor,
        { ...pattern, previewHash: preview.previewHash },
        'key',
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.lessonSeries.create).not.toHaveBeenCalled();
  });
  it('returns conflict dates and refuses the entire create, including a newly appeared conflict', async () => {
    const { service, tx } = setup();
    const preview = await service.preview(actor, pattern);
    tx.lessonSession.findMany.mockResolvedValue([
      {
        id: 'conflict',
        classGroupId: 'other',
        teacherId: 'teacher',
        startsAt: new Date('2040-01-02T06:30Z'),
        endsAt: new Date('2040-01-02T07:30Z'),
      },
    ]);
    await expect(
      service.create(
        actor,
        { ...pattern, previewHash: preview.previewHash },
        'key',
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { conflictDates: ['2040-01-02'] },
    });
    expect(tx.lessonSeries.create).not.toHaveBeenCalled();
  });
  it('keeps touching interval boundaries free and ignores no dates silently', async () => {
    const { service, tx } = setup();
    tx.lessonSession.findMany.mockResolvedValue([
      {
        id: 'boundary',
        startsAt: new Date('2040-01-02T07:00Z'),
        endsAt: new Date('2040-01-02T08:00Z'),
      },
    ]);
    const preview = await service.preview(actor, pattern);
    expect(preview.conflictDates).toEqual([]);
    expect(preview.sessions).toHaveLength(4);
  });
  it('does not turn a past generated date into a shorter series', async () => {
    const { service, tx } = setup();
    await expect(
      service.preview(actor, {
        ...pattern,
        startDate: '2020-01-01',
        endDate: '2020-01-14',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(tx.lessonSeries.create).not.toHaveBeenCalled();
  });
  it('replays the original successful receipt before rechecking old dates or configuration', async () => {
    const { service, tx, idempotency } = setup();
    idempotency.claim.mockResolvedValue({
      replayed: true,
      responseBody: { seriesId: 'old' },
    });
    await expect(
      service.create(
        actor,
        { ...pattern, startDate: '2020-01-01', previewHash: 'old' },
        'same-key',
      ),
    ).resolves.toEqual({ seriesId: 'old' });
    expect(tx.classGroup.findFirst).not.toHaveBeenCalled();
  });
  it.each([
    { userId: 'hq', roles: [{ code: 'OPERATOR' as const, campusId: null }] },
    {
      userId: 'mixed',
      roles: [
        { code: 'OPERATOR' as const, campusId: 'campus' },
        { code: 'TEACHER' as const, campusId: 'campus' },
      ],
    },
  ])('rejects nonordinary scope before opening a transaction', async (user) => {
    const { service, prisma } = setup();
    await expect(service.preview(user, pattern)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rejects unavailable classes or inactive teachers instead of creating a partial series', async () => {
    const { service, tx } = setup();
    tx.classGroup.findFirst.mockResolvedValue(null);
    await expect(service.preview(actor, pattern)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(tx.lessonSession.create).not.toHaveBeenCalled();
  });
  it('propagates a middle insert failure and does not complete the idempotency receipt', async () => {
    const { service, tx, idempotency } = setup();
    const preview = await service.preview(actor, pattern);
    tx.lessonSession.create
      .mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...data, id: 'first', version: 1 }),
      )
      .mockRejectedValueOnce(new Error('insert failed'));
    await expect(
      service.create(
        actor,
        { ...pattern, previewHash: preview.previewHash },
        'key',
      ),
    ).rejects.toThrow('insert failed');
    expect(idempotency.complete).not.toHaveBeenCalled();
  });
});

describe('precise future cancellation', () => {
  function cancellation() {
    const fixture = setup();
    const rows = [
      {
        id: 'a',
        campusId: 'campus',
        seriesId: 'series',
        startsAt: new Date('2040-01-02T06:00Z'),
        endsAt: new Date('2040-01-02T07:00Z'),
        status: 'SCHEDULED',
        version: 1,
      },
      {
        id: 'b',
        campusId: 'campus',
        seriesId: 'series',
        startsAt: new Date('2040-01-04T06:00Z'),
        endsAt: new Date('2040-01-04T07:00Z'),
        status: 'SCHEDULED',
        version: 2,
      },
      {
        id: 'c',
        campusId: 'campus',
        seriesId: 'series',
        startsAt: new Date('2040-01-09T06:00Z'),
        endsAt: new Date('2040-01-09T07:00Z'),
        status: 'COMPLETED',
        version: 3,
      },
    ];
    fixture.tx.lessonSession.findFirst.mockResolvedValue(rows[0]);
    fixture.tx.lessonSession.findMany.mockResolvedValue(rows);
    return { ...fixture, rows };
  }
  it('previews this-and-following actual future scheduled rows only', async () => {
    const { service, tx } = cancellation();
    const preview = await service.previewCancellation(actor, 'a', {
      mode: 'FOLLOWING',
    });
    expect(preview.sessions.map((row) => row.id)).toEqual(['a', 'b']);
    expect(tx.lessonSession.updateMany).not.toHaveBeenCalled();
    expect(preview.sessions[1].version).toBe(2);
  });
  it('cancels exactly the confirmed rows and audits each plus the series', async () => {
    const { service, tx, idempotency } = cancellation();
    const preview = await service.previewCancellation(actor, 'a', {
      mode: 'FOLLOWING',
    });
    const result = await service.cancelSelection(
      actor,
      'a',
      { mode: 'FOLLOWING', previewHash: preview.previewHash },
      'cancel-key',
    );
    expect(result).toMatchObject({ sessions: [{ id: 'a' }, { id: 'b' }] });
    expect(tx.lessonSession.updateMany).toHaveBeenCalledTimes(2);
    const secondUpdate = (
      tx.lessonSession.updateMany.mock.calls as unknown as Array<[unknown]>
    )[1][0];
    expect(secondUpdate).toMatchObject({ where: { version: 2 } });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(3);
    expect(idempotency.complete).toHaveBeenCalledTimes(1);
  });
  it('this mode never cancels a later member of the same series', async () => {
    const { service, tx } = cancellation();
    const preview = await service.previewCancellation(actor, 'a', {
      mode: 'THIS',
    });
    await service.cancelSelection(
      actor,
      'a',
      { mode: 'THIS', previewHash: preview.previewHash },
      'cancel-key',
    );
    expect(tx.lessonSession.updateMany).toHaveBeenCalledTimes(1);
  });
  it('requires a new preview if an affected version or schedule changes', async () => {
    const { service, tx, rows } = cancellation();
    const preview = await service.previewCancellation(actor, 'a', {
      mode: 'FOLLOWING',
    });
    rows[1].version += 1;
    await expect(
      service.cancelSelection(
        actor,
        'a',
        { mode: 'FOLLOWING', previewHash: preview.previewHash },
        'key',
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.lessonSession.updateMany).not.toHaveBeenCalled();
  });
  it('rechecks the clock after waiting for row locks', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2040-01-02T05:59:59Z'));
    try {
      const { service, tx } = cancellation();
      const preview = await service.previewCancellation(actor, 'a', {
        mode: 'FOLLOWING',
      });
      tx.$queryRaw.mockImplementation(() => {
        jest.setSystemTime(new Date('2040-01-02T06:00:01Z'));
        return Promise.resolve([]);
      });
      await expect(
        service.cancelSelection(
          actor,
          'a',
          { mode: 'FOLLOWING', previewHash: preview.previewHash },
          'key',
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(tx.lessonSession.updateMany).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
  it('does not complete a partial cancellation if one conditional update fails', async () => {
    const { service, tx, idempotency } = cancellation();
    const preview = await service.previewCancellation(actor, 'a', {
      mode: 'FOLLOWING',
    });
    tx.lessonSession.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await expect(
      service.cancelSelection(
        actor,
        'a',
        { mode: 'FOLLOWING', previewHash: preview.previewHash },
        'key',
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(idempotency.complete).not.toHaveBeenCalled();
  });
});
