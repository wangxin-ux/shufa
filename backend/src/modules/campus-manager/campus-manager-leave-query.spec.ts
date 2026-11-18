import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CampusManagerScopeService } from '../../common/auth/campus-manager-scope.service';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CampusManagerLeaveService } from './campus-manager-leave.service';
import { CampusManagerLeaveRequestsQueryDto } from './dto/campus-manager-leave.dto';

function query(input: Record<string, unknown> = {}) {
  return plainToInstance(CampusManagerLeaveRequestsQueryDto, input);
}

describe('campus manager leave history query', () => {
  const user: AuthenticatedUser = {
    userId: 'synthetic-manager',
    roles: [{ code: 'CAMPUS_MANAGER', campusId: 'synthetic-campus' }],
  };

  function setup() {
    const reviewedAt = new Date('2026-10-24T02:00:00Z');
    const record = {
      id: 'synthetic-leave',
      studentId: 'synthetic-student',
      lessonSessionId: 'synthetic-lesson',
      student: { displayName: 'Synthetic student' },
      lessonSession: {
        startsAt: new Date('2026-10-25T02:00:00Z'),
        classGroup: { courseName: 'Synthetic course' },
      },
      reason: 'Synthetic leave',
      status: 'APPROVED',
      reviewedAt,
      reviewReason: null,
      reviewer: { displayName: 'Synthetic manager' },
      version: 2,
      createdAt: new Date('2026-10-23T02:00:00Z'),
    };
    const outsideCount = jest.fn().mockResolvedValue(99);
    const outsideFind = jest.fn().mockResolvedValue([record]);
    const count = jest.fn().mockResolvedValue(41);
    const findMany = jest.fn().mockResolvedValue([record]);
    const tx = { parentLeaveRequest: { count, findMany } };
    const transaction = jest.fn(
      (read: (transaction: typeof tx) => Promise<unknown>) => read(tx),
    );
    const service = new CampusManagerLeaveService(
      {
        $transaction: transaction,
        parentLeaveRequest: {
          count: outsideCount,
          findMany: outsideFind,
        },
      } as unknown as PrismaService,
      new CampusManagerScopeService(),
      {} as IdempotencyService,
    );
    return {
      service,
      transaction,
      count,
      findMany,
      outsideCount,
      outsideFind,
    };
  }

  it.each([
    ['true', true],
    ['false', false],
    [true, true],
    [false, false],
  ])('parses reviewedOnly=%j explicitly', (value, expected) => {
    const dto = query({ reviewedOnly: value });
    expect(validateSync(dto)).toEqual([]);
    expect(dto).toMatchObject({ reviewedOnly: expected });
  });

  it.each(['', 'TRUE', '1', 1, ['true'], { value: true }])(
    'rejects invalid reviewedOnly=%j',
    (reviewedOnly) => {
      expect(
        validateSync(query({ reviewedOnly })).some(
          ({ property }) => property === 'reviewedOnly',
        ),
      ).toBe(true);
    },
  );

  it('keeps the existing query defaults and single-status filter', () => {
    const dto = query({ status: 'PENDING' });
    expect(validateSync(dto)).toEqual([]);
    expect(dto).toMatchObject({ page: 1, pageSize: 20, status: 'PENDING' });
  });

  it('reads mixed reviewed statuses with stable ordering and one snapshot', async () => {
    const env = setup();
    const result = await env.service.list(
      user,
      query({ page: '2', pageSize: '20', reviewedOnly: 'true' }),
    );
    const where = {
      campusId: 'synthetic-campus',
      status: { in: ['APPROVED', 'REJECTED'] },
    };
    expect(env.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(env.count).toHaveBeenCalledWith({ where });
    expect(env.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        orderBy: [
          { reviewedAt: { sort: 'desc', nulls: 'last' } },
          { id: 'desc' },
        ],
        skip: 20,
        take: 20,
      }),
    );
    expect(env.outsideCount).not.toHaveBeenCalled();
    expect(env.outsideFind).not.toHaveBeenCalled();
    expect(result.meta).toEqual({
      page: 2,
      pageSize: 20,
      total: 41,
      totalPages: 3,
    });
    expect(result.data[0]).toMatchObject({
      status: 'APPROVED',
      reviewedAt: '2026-10-24T02:00:00.000Z',
      studentName: 'Synthetic student',
    });
  });

  it.each([{}, { status: 'PENDING' }, { reviewedOnly: 'false' }])(
    'preserves created-time ordering for legacy query %j',
    async (input) => {
      const env = setup();
      await env.service.list(user, query(input));
      expect(env.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            campusId: 'synthetic-campus',
            ...('status' in input ? { status: input.status } : {}),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );
    },
  );

  it.each(['true', 'false'])(
    'rejects reviewedOnly=%s together with status before querying',
    async (reviewedOnly) => {
      const env = setup();
      await expect(
        env.service.list(user, query({ reviewedOnly, status: 'PENDING' })),
      ).rejects.toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
      expect(env.transaction).not.toHaveBeenCalled();
      expect(env.outsideCount).not.toHaveBeenCalled();
      expect(env.outsideFind).not.toHaveBeenCalled();
    },
  );

  it('rejects a different role before querying', async () => {
    const env = setup();
    await expect(
      env.service.list(
        {
          ...user,
          roles: [{ code: 'TEACHER', campusId: 'synthetic-campus' }],
        },
        query({ reviewedOnly: 'true' }),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(env.transaction).not.toHaveBeenCalled();
    expect(env.outsideCount).not.toHaveBeenCalled();
  });
});
