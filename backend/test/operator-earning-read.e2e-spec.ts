import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { AuthenticatedUser } from '../src/common/auth/authenticated-user';
import { OperatorScopeService } from '../src/common/auth/operator-scope.service';
import { PermissionsGuard } from '../src/common/auth/permissions.guard';
import { AccessTokenGuard } from '../src/modules/auth/access-token.guard';
import { ROLE_PERMISSION_MATRIX } from '../src/modules/iam/role-permission.matrix';
import { readOperatorInternalEarningSummary } from '../src/modules/operator/operator-internal-earning-source';

jest.mock('../src/modules/operator/operator-internal-earning-source', () => ({
  readOperatorInternalEarningSummary: jest.fn(() =>
    Promise.resolve({
      estimatedTotalFen: null,
      pendingReviewFen: 1200,
      currency: 'CNY',
    }),
  ),
}));

const campusId = 'ec0ed5f4-1faa-4f2d-83c2-4a731d937947';
const actor: AuthenticatedUser = {
  userId: '8aa8e588-97a6-4d02-bd14-6421ce0acbe8',
  roles: [{ code: 'OPERATOR', campusId }],
};
const now = new Date('2026-10-28T17:00:00Z');
type Query = {
  page: number;
  pageSize: number;
  status?: string;
  entryType?: string;
};
type Summary = {
  estimatedTotalFen: number | null;
  pendingReviewFen: number | null;
  currency: string;
  serverTime: string;
  timezone: string;
};
interface Service {
  summary(user: AuthenticatedUser, time?: Date): Promise<Summary>;
  entries(
    user: AuthenticatedUser,
    query: Query,
    time?: Date,
  ): Promise<{
    data: Array<Record<string, unknown>>;
    meta: { page: number; pageSize: number; total: number; totalPages: number };
    serverTime: string;
    timezone: string;
  }>;
}

function host() {
  const current = {
    status: 'ACTIVE',
    roles: [{ roleCode: 'OPERATOR', campusId }],
  };
  const rows = [
    {
      id: '9480f230-ffb1-4298-a013-c8af1cc8011d',
      campusId,
      entryType: 'REVERSAL',
      status: 'REVERSED',
      amountFen: -1200,
      createdAt: now,
      earningBasis: {
        campusId,
        teachingRecordId: 'record',
        lessonSessionId: 'lesson',
        completedAt: now,
        teachingRecord: { id: 'record', campusId, lessonSessionId: 'lesson' },
        lessonSession: { id: 'lesson', campusId },
      },
      ruleSnapshot: { unitPriceFen: 999999 },
      reviewReason: 'private',
    },
  ];
  const tx = {
    user: { findUnique: jest.fn().mockResolvedValue(current) },
    campus: {
      findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Shanghai' }),
    },
    partnerEarningEntry: {
      count: jest.fn().mockResolvedValue(21),
      findMany: jest
        .fn<Promise<typeof rows>, [unknown]>()
        .mockResolvedValue(rows),
    },
  };
  const fresh = {
    user: { findUnique: jest.fn().mockResolvedValue(current) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  let calls = 0;
  const transaction = jest.fn<
    Promise<unknown>,
    [
      (client: unknown) => Promise<unknown>,
      { isolationLevel: Prisma.TransactionIsolationLevel; timeout: number },
    ]
  >((read) => read(++calls === 1 ? tx : fresh));
  const { OperatorEarningService } = jest.requireActual<{
    OperatorEarningService: new (...args: unknown[]) => Service;
  }>('../src/modules/operator/operator-earning.service');
  const service = Reflect.construct(OperatorEarningService, [
    { $transaction: transaction },
    new OperatorScopeService(),
  ]);
  const query: Query = { page: 2, pageSize: 20 };
  return { service, tx, fresh, transaction, rows, query };
}

describe('operator internal earning reads, offline provider substitutes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('guards both actual routes with the independent read permission', () => {
    const { OperatorEarningController } = jest.requireActual<{
      OperatorEarningController: new (...args: unknown[]) => object;
    }>('../src/modules/operator/operator-earning.controller');
    const reflector = new Reflector();
    expect(reflector.get(PATH_METADATA, OperatorEarningController)).toBe(
      'operators/me/earnings',
    );
    expect(reflector.get(GUARDS_METADATA, OperatorEarningController)).toEqual([
      AccessTokenGuard,
      PermissionsGuard,
    ]);
    expect(
      reflector.get('required-permissions', OperatorEarningController),
    ).toEqual(['OPERATOR_EARNING_READ']);
    for (const [method, route] of [
      ['summary', 'summary'],
      ['entries', '/'],
    ])
      expect(
        reflector.get(
          PATH_METADATA,
          (OperatorEarningController.prototype as Record<string, () => void>)[
            method
          ],
        ),
      ).toBe(route);
    expect(ROLE_PERMISSION_MATRIX.OPERATOR).toContain('OPERATOR_EARNING_READ');
    for (const role of [
      'PARTNER',
      'CAMPUS_MANAGER',
      'TEACHER',
      'SUPER_ADMIN',
    ] as const)
      expect(ROLE_PERMISSION_MATRIX[role]).not.toContain(
        'OPERATOR_EARNING_READ',
      );
    expect(
      ROLE_PERMISSION_MATRIX.OPERATOR.some((value) =>
        /EARNING_REVIEW|WITHDRAWAL|REFUND_PAY|RULE_MANAGE/.test(value),
      ),
    ).toBe(false);
  });

  it('keeps historical unknown and pending amounts with one campus snapshot', async () => {
    const { service, tx, fresh, transaction } = host();
    expect(await service.summary(actor, now)).toEqual({
      estimatedTotalFen: null,
      pendingReviewFen: 1200,
      currency: 'CNY',
      serverTime: now.toISOString(),
      timezone: 'Asia/Shanghai',
    });
    expect(readOperatorInternalEarningSummary).toHaveBeenCalledWith(
      tx,
      campusId,
    );
    expect(
      transaction.mock.calls.map((call) => call[1].isolationLevel),
    ).toEqual([
      Prisma.TransactionIsolationLevel.RepeatableRead,
      Prisma.TransactionIsolationLevel.ReadCommitted,
    ]);
    expect(fresh.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('returns exact signed journal projection with AND filters and stable ordering', async () => {
    const { service, tx, query } = host();
    query.status = 'REVERSED';
    query.entryType = 'REVERSAL';
    const result = await service.entries(actor, query, now);
    expect(result.data).toEqual([
      {
        id: '9480f230-ffb1-4298-a013-c8af1cc8011d',
        entryType: 'REVERSAL',
        status: 'REVERSED',
        amountFen: -1200,
        createdAt: now.toISOString(),
        completedAt: now.toISOString(),
      },
    ]);
    expect(result.meta).toEqual({
      page: 2,
      pageSize: 20,
      total: 21,
      totalPages: 2,
    });
    const args = tx.partnerEarningEntry.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      orderBy: unknown;
      skip: number;
      take: number;
    };
    expect(args.where).toEqual({
      campusId,
      status: 'REVERSED',
      entryType: 'REVERSAL',
    });
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect([args.skip, args.take]).toEqual([20, 20]);
    expect(tx.partnerEarningEntry.count).toHaveBeenCalledWith({
      where: args.where,
    });
    expect(readOperatorInternalEarningSummary).not.toHaveBeenCalled();
  });

  it('retains rejected originals as journal facts without changing the summary', async () => {
    const { service, rows, query } = host();
    rows[0].entryType = 'ACCRUAL';
    rows[0].status = 'REJECTED';
    rows[0].amountFen = 1200;
    expect((await service.entries(actor, query)).data[0]).toMatchObject({
      status: 'REJECTED',
      amountFen: 1200,
    });
  });

  it.each(
    (
      [
        [],
        [{ code: 'OPERATOR', campusId: null }],
        [{ code: 'PARTNER', campusId }],
        [
          { code: 'OPERATOR', campusId },
          { code: 'TEACHER', campusId },
        ],
      ] as AuthenticatedUser['roles'][]
    ).map((roles) => ({ roles })),
  )('rejects invalid caller scope before reads: %j', async ({ roles }) => {
    const { service, transaction } = host();
    await expect(service.summary({ ...actor, roles })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['summary', 'entries'] as const)(
    'refuses disabled persisted identity on %s',
    async (method) => {
      const { service, tx, query } = host();
      tx.user.findUnique.mockResolvedValue({ status: 'DISABLED', roles: [] });
      const call =
        method === 'summary'
          ? service.summary(actor)
          : service.entries(actor, query);
      await expect(call).rejects.toMatchObject({ statusCode: 401 });
      expect(tx.partnerEarningEntry.findMany).not.toHaveBeenCalled();
      expect(readOperatorInternalEarningSummary).not.toHaveBeenCalled();
    },
  );

  it.each(['summary', 'entries'] as const)(
    'rechecks revocation in fresh transaction on %s',
    async (method) => {
      const { service, fresh, query } = host();
      fresh.user.findUnique.mockResolvedValue({
        status: 'ACTIVE',
        roles: [{ roleCode: 'OPERATOR', campusId: 'other-campus' }],
      });
      const call =
        method === 'summary'
          ? service.summary(actor)
          : service.entries(actor, query);
      await expect(call).rejects.toMatchObject({ statusCode: 403 });
    },
  );

  it('rejects late account deactivation instead of returning a computed summary', async () => {
    const { service, fresh } = host();
    fresh.user.findUnique.mockResolvedValue(null);
    await expect(service.summary(actor)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it.each([
    { page: 0 },
    { page: 1.5 },
    { page: 2147483648 },
    { page: 2147483647, pageSize: 100 },
    { page: Infinity },
    { pageSize: 0 },
    { pageSize: 101 },
    { pageSize: NaN },
    { status: 'UNKNOWN' },
    { entryType: 'UNKNOWN' },
  ])('rejects invalid journal query before reading: %j', async (delta) => {
    const { service, query, transaction } = host();
    await expect(
      service.entries(actor, { ...query, ...delta }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['campusId', 'basis', 'teaching', 'lesson', 'relation'])(
    'refuses inconsistent historical campus links: %s',
    async (target) => {
      const { service, rows, query } = host();
      if (target === 'campusId') rows[0].campusId = 'foreign';
      if (target === 'basis') rows[0].earningBasis.campusId = 'foreign';
      if (target === 'teaching')
        rows[0].earningBasis.teachingRecord.campusId = 'foreign';
      if (target === 'lesson')
        rows[0].earningBasis.lessonSession.campusId = 'foreign';
      if (target === 'relation')
        rows[0].earningBasis.teachingRecord.lessonSessionId = 'different';
      await expect(service.entries(actor, query)).rejects.toMatchObject({
        statusCode: 500,
      });
    },
  );

  it.each([0, 1200, 1.5, Number.MIN_SAFE_INTEGER - 1, NaN])(
    'refuses invalid reversal amount %s without inventing zero',
    async (amount) => {
      const { service, rows, query } = host();
      rows[0].amountFen = amount;
      await expect(service.entries(actor, query)).rejects.toMatchObject({
        statusCode: 500,
      });
    },
  );

  it('refuses a reversal with an incompatible status', async () => {
    const { service, rows, query } = host();
    rows[0].status = 'AVAILABLE';
    await expect(service.entries(actor, query)).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it('requires an existing campus timezone on both reads', async () => {
    const { service, tx } = host();
    tx.campus.findUnique.mockResolvedValue(null);
    await expect(service.summary(actor)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('validates transformed DTOs, enums and forbidden scope input', () => {
    const { OperatorEarningQueryDto } = jest.requireActual<{
      OperatorEarningQueryDto: new () => object;
    }>('../src/modules/operator/dto/operator-earning.dto');
    expect(
      validateSync(
        plainToInstance(OperatorEarningQueryDto, {
          page: '2',
          pageSize: '100',
          status: 'REJECTED',
          entryType: 'ACCRUAL',
        }),
      ),
    ).toEqual([]);
    for (const input of [
      { page: 0 },
      { page: 1.1 },
      { page: 2147483648 },
      { pageSize: 101 },
      { status: 'OTHER' },
      { entryType: 'OTHER' },
      { campusId: 'foreign' },
    ])
      expect(
        validateSync(plainToInstance(OperatorEarningQueryDto, input), {
          whitelist: true,
          forbidNonWhitelisted: true,
        }).length,
      ).toBeGreaterThan(0);
  });
});
