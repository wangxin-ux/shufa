import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { AuthenticatedUser } from '../src/common/auth/authenticated-user';
import { OperatorScopeService } from '../src/common/auth/operator-scope.service';
import { ROLE_PERMISSION_MATRIX } from '../src/modules/iam/role-permission.matrix';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../src/modules/auth/access-token.guard';
import { PermissionsGuard } from '../src/common/auth/permissions.guard';

jest.mock('../src/modules/partner/partner-enrollment-summary', () => ({
  readCampusEnrollmentSummary: jest.fn(() =>
    Promise.resolve({
      receivedAmountFen: 12000,
      refundedAmountFen: 2000,
      initialMainUnits: 1000,
      initialGiftUnits: null,
      pendingIssuanceCount: 1,
    }),
  ),
}));

const campusId = 'ec0ed5f4-1faa-4f2d-83c2-4a731d937947';
const studentId = '530c99bb-23e9-48ca-bf2a-21d82a802f5d';
const subjectId = '91318488-932d-48d5-a447-6128146b698e';
const actor: AuthenticatedUser = {
  userId: '8aa8e588-97a6-4d02-bd14-6421ce0acbe8',
  roles: [{ code: 'OPERATOR', campusId }],
};
const now = new Date('2026-10-28T14:00:00.000Z');
type Query = {
  page: number;
  pageSize: number;
  entryType?: 'CONSUME';
  subjectId?: string;
  query?: string;
};
type Result = {
  mainBalanceUnits: number;
  availableTotalUnits: number;
  lessonActivityTotals: Array<{
    entryType: string;
    mainDeltaUnits: number | null;
    giftDeltaUnits: number | null;
    totalDeltaUnits: number | null;
  }>;
  enrollmentSummary: Record<string, number | null>;
  items: Array<Record<string, unknown>>;
  meta: { page: number; total: number; totalPages: number };
};
interface Service {
  lessonAccount(
    user: AuthenticatedUser,
    query: Query,
    time?: Date,
  ): Promise<Result>;
  subjects(
    user: AuthenticatedUser,
    query: Query,
  ): Promise<{
    data: Array<Record<string, unknown>>;
    meta: { page: number; total: number; totalPages: number };
  }>;
}

function host() {
  const current = {
    status: 'ACTIVE',
    roles: [{ roleCode: 'OPERATOR', campusId }],
  };
  const packages = [
    {
      mainBalanceUnits: 500,
      giftBalanceUnits: 200,
      mainReservedUnits: 100,
      giftReservedUnits: 50,
    },
  ];
  const rows = [
    {
      id: '06501f4e-7a6c-4848-ae7a-5e0254bbe957',
      campusId,
      studentId,
      subjectId,
      subjectName: 'Frozen subject',
      subject: { campusId },
      entryType: 'CONSUME',
      bucket: 'GIFT',
      deltaUnits: -150,
      balanceBeforeUnits: 350,
      balanceAfterUnits: 200,
      reason: null,
      createdAt: now,
      student: { displayName: 'Synthetic student' },
      coursePackage: {
        name: 'Synthetic package',
        campusId,
        studentId,
        financeIssuance: null,
        sourceOrder: null,
      },
      lessonSession: null,
      phone: 'must not escape',
    },
  ];
  const groups = [
    {
      entryType: 'GRANT',
      bucket: 'MAIN',
      delta: 1000n,
      invalidCount: 0n,
    },
    {
      entryType: 'CONSUME',
      bucket: 'GIFT',
      delta: -150n,
      invalidCount: 0n,
    },
  ];
  const tx = {
    user: { findUnique: jest.fn().mockResolvedValue(current) },
    campus: {
      findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Shanghai' }),
    },
    student: { count: jest.fn().mockResolvedValue(1) },
    coursePackage: { findMany: jest.fn().mockResolvedValue(packages) },
    lessonLedgerEntry: {
      count: jest.fn().mockResolvedValue(21),
      findMany: jest.fn().mockResolvedValue(rows),
    },
    campusSubject: {
      findFirst: jest.fn().mockResolvedValue({ id: subjectId }),
      count: jest.fn().mockResolvedValue(21),
      findMany: jest.fn().mockResolvedValue([
        {
          id: subjectId,
          name: 'Archived subject',
          isActive: false,
          version: 2,
        },
      ]),
    },
    $queryRaw: jest.fn((sql: Prisma.Sql | TemplateStringsArray) =>
      Promise.resolve(
        ('sql' in sql ? sql.sql : sql.join('')).includes('SUM(') ? groups : [],
      ),
    ),
  };
  const fresh = {
    user: { findUnique: jest.fn().mockResolvedValue(current) },
    student: { count: jest.fn().mockResolvedValue(1) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  let transactionCount = 0;
  const transaction = jest.fn<
    Promise<unknown>,
    [
      (value: unknown) => Promise<unknown>,
      { isolationLevel: Prisma.TransactionIsolationLevel; timeout?: number }?,
    ]
  >((read) => read(++transactionCount === 1 ? tx : fresh));
  const prisma = { $transaction: transaction };
  const { OperatorAccountService } = jest.requireActual<{
    OperatorAccountService: new (...args: unknown[]) => Service;
  }>('../src/modules/operator/operator-account.service');
  const service = Reflect.construct(OperatorAccountService, [
    prisma,
    new OperatorScopeService(),
  ]);
  const query: Query = { page: 2, pageSize: 20 };
  return { service, prisma, tx, fresh, packages, rows, groups, query };
}

describe('operator account read source and scope, offline only', () => {
  it('protects both actual controller routes with token and account permission guards', () => {
    const { OperatorAccountController } = jest.requireActual<{
      OperatorAccountController: new (...args: unknown[]) => object;
    }>('../src/modules/operator/operator-account.controller');
    const reflector = new Reflector();
    expect(reflector.get(PATH_METADATA, OperatorAccountController)).toBe(
      'operators/me',
    );
    expect(reflector.get(GUARDS_METADATA, OperatorAccountController)).toEqual([
      AccessTokenGuard,
      PermissionsGuard,
    ]);
    expect(
      reflector.get('required-permissions', OperatorAccountController),
    ).toEqual(['OPERATOR_ACCOUNT_READ']);
    for (const method of ['lessonAccount', 'subjects']) {
      expect(
        reflector.get(
          PATH_METADATA,
          (
            OperatorAccountController.prototype as Record<
              string,
              (...args: unknown[]) => unknown
            >
          )[method],
        ),
      ).toBe(method === 'lessonAccount' ? 'lesson-account' : 'subjects');
    }
  });

  it('has its own read permission without adding financial write privileges', () => {
    expect(ROLE_PERMISSION_MATRIX.OPERATOR).toContain('OPERATOR_ACCOUNT_READ');
    for (const role of ['PARTNER', 'CAMPUS_MANAGER', 'TEACHER'] as const)
      expect(ROLE_PERMISSION_MATRIX[role]).not.toContain(
        'OPERATOR_ACCOUNT_READ',
      );
    expect(
      ROLE_PERMISSION_MATRIX.OPERATOR.some((value) =>
        /REFUND_PAY|WITHDRAWAL|EARNING_REVIEW|LEDGER_ADJUST/.test(value),
      ),
    ).toBe(false);
  });

  it('returns the nine current values and full unfiltered historical sources', async () => {
    const { service, tx, prisma, query } = host();
    const result = await service.lessonAccount(actor, query, now);
    expect(result).toMatchObject({
      mainBalanceUnits: 500,
      giftBalanceUnits: 200,
      totalBalanceUnits: 700,
      mainReservedUnits: 100,
      giftReservedUnits: 50,
      reservedTotalUnits: 150,
      mainAvailableUnits: 400,
      giftAvailableUnits: 150,
      availableTotalUnits: 550,
      enrollmentSummary: {
        receivedAmountFen: 12000,
        refundedAmountFen: 2000,
        initialGiftUnits: null,
        pendingIssuanceCount: 1,
      },
      serverTime: now.toISOString(),
      timezone: 'Asia/Shanghai',
      meta: { page: 2, pageSize: 20, total: 21, totalPages: 2 },
    });
    expect(result.lessonActivityTotals).toHaveLength(6);
    expect(result.lessonActivityTotals).toContainEqual({
      entryType: 'CONSUME',
      mainDeltaUnits: 0,
      giftDeltaUnits: -150,
      totalDeltaUnits: -150,
    });
    expect(tx.coursePackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campusId,
          student: { campusId },
          isActive: true,
          validFrom: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
        },
      }),
    );
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 15000,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('applies AND filters and stable pagination only to the detail query', async () => {
    const { service, tx, query } = host();
    const result = await service.lessonAccount(
      actor,
      { ...query, entryType: 'CONSUME', subjectId: 'UNCLASSIFIED' },
      now,
    );
    expect(result.availableTotalUnits).toBe(550);
    expect(result.enrollmentSummary.receivedAmountFen).toBe(12000);
    expect(tx.lessonLedgerEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campusId,
          student: { campusId },
          coursePackage: { campusId },
          entryType: 'CONSUME',
          subjectId: null,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 20,
        take: 20,
      }),
    );
    const sql = tx.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.values).toEqual([campusId]);
  });

  it('returns exact detail fields without raw source or personal extras', async () => {
    const { service, query } = host();
    const result = await service.lessonAccount(actor, query, now);
    expect(Object.keys(result.items[0]).sort()).toEqual(
      [
        'id',
        'studentId',
        'studentName',
        'packageName',
        'subject',
        'entryType',
        'bucket',
        'deltaUnits',
        'balanceBeforeUnits',
        'balanceAfterUnits',
        'reason',
        'createdAt',
        'paymentContext',
        'teachingContext',
      ].sort(),
    );
    expect(result.items[0]).toMatchObject({
      subject: { id: subjectId, name: 'Frozen subject' },
      paymentContext: null,
      teachingContext: null,
    });
  });

  it.each([
    [{ code: 'OPERATOR', campusId: null }],
    [{ code: 'PARTNER', campusId }],
    [
      { code: 'OPERATOR', campusId },
      { code: 'TEACHER', campusId },
    ],
  ] as AuthenticatedUser['roles'][])(
    'rejects unsupported identities before reading sources: %j',
    async (...roles: AuthenticatedUser['roles']) => {
      const { service, prisma, query } = host();
      await expect(
        service.lessonAccount({ ...actor, roles }, query, now),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('checks disabled identity inside the read snapshot', async () => {
    const { service, tx, query } = host();
    tx.user.findUnique.mockResolvedValue(null);
    await expect(
      service.lessonAccount(actor, query, now),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(tx.coursePackage.findMany).not.toHaveBeenCalled();
  });

  it('checks fresh role revocation before returning private data', async () => {
    const { service, fresh, query } = host();
    fresh.user.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      roles: [{ roleCode: 'PARTNER', campusId }],
    });
    await expect(
      service.lessonAccount(actor, query, now),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('does not return a student name after a concurrent campus move', async () => {
    const { service, fresh, query } = host();
    fresh.student.count.mockResolvedValue(0);
    await expect(
      service.lessonAccount(actor, query, now),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects an unknown or other-campus subject', async () => {
    const { service, tx, query } = host();
    tx.campusSubject.findFirst.mockResolvedValue(null);
    await expect(
      service.lessonAccount(actor, { ...query, subjectId }, now),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(tx.lessonLedgerEntry.findMany).not.toHaveBeenCalled();
  });

  it.each([-1, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid current balance %s instead of silently displaying zero',
    async (value) => {
      const { service, packages, query } = host();
      packages[0].mainBalanceUnits = value;
      await expect(
        service.lessonAccount(actor, query, now),
      ).rejects.toMatchObject({ statusCode: 500 });
    },
  );

  it('rejects reservations larger than their original bucket', async () => {
    const { service, packages, query } = host();
    packages[0].giftReservedUnits = 201;
    await expect(
      service.lessonAccount(actor, query, now),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it('rejects aggregate current-balance overflow across otherwise valid packages', async () => {
    const { service, packages, query } = host();
    packages[0].mainBalanceUnits = Number.MAX_SAFE_INTEGER;
    packages[0].giftBalanceUnits = 1;
    await expect(
      service.lessonAccount(actor, query, now),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it('rejects a damaged detail link instead of exposing another student package', async () => {
    const { service, rows, query } = host();
    rows[0].coursePackage.studentId = 'foreign-student';
    await expect(
      service.lessonAccount(actor, query, now),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it('distinguishes a truly empty system ledger from an invalid source', async () => {
    const { service, groups, packages, rows, tx, query } = host();
    groups.length = 0;
    packages.length = 0;
    rows.length = 0;
    tx.lessonLedgerEntry.count.mockResolvedValue(0);
    const result = await service.lessonAccount(actor, query, now);
    expect(result.mainBalanceUnits).toBe(0);
    expect(result.lessonActivityTotals).toHaveLength(6);
    expect(
      result.lessonActivityTotals.every(
        (row) =>
          row.mainDeltaUnits === 0 &&
          row.giftDeltaUnits === 0 &&
          row.totalDeltaUnits === 0,
      ),
    ).toBe(true);
  });

  it('propagates a damaged or overflowed historical bucket as null', async () => {
    const { service, groups, query } = host();
    groups[0].delta = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    groups[1].invalidCount = 1n;
    const result = await service.lessonAccount(actor, query, now);
    expect(result.lessonActivityTotals).toContainEqual({
      entryType: 'GRANT',
      mainDeltaUnits: null,
      giftDeltaUnits: 0,
      totalDeltaUnits: null,
    });
    expect(result.lessonActivityTotals).toContainEqual({
      entryType: 'CONSUME',
      mainDeltaUnits: 0,
      giftDeltaUnits: null,
      totalDeltaUnits: null,
    });
  });

  it('keeps reversal, refund and correction separate with signed deltas', async () => {
    const { service, groups, query } = host();
    groups.push(
      { entryType: 'REVERSAL', bucket: 'GIFT', delta: 150n, invalidCount: 0n },
      { entryType: 'REFUND', bucket: 'MAIN', delta: -200n, invalidCount: 0n },
      {
        entryType: 'CORRECTION',
        bucket: 'MAIN',
        delta: -300n,
        invalidCount: 0n,
      },
    );
    const result = await service.lessonAccount(actor, query, now);
    expect(
      result.lessonActivityTotals
        .filter(({ entryType }) =>
          ['REVERSAL', 'REFUND', 'CORRECTION'].includes(entryType),
        )
        .map(({ totalDeltaUnits }) => totalDeltaUnits),
    ).toEqual([150, -200, -300]);
  });

  it('lists archived subjects without financial source or personal fields', async () => {
    const { service, tx, query } = host();
    const result = await service.subjects(actor, {
      ...query,
      query: 'Archived',
    });
    expect(result).toMatchObject({
      data: [
        {
          id: subjectId,
          name: 'Archived subject',
          isActive: false,
          version: 2,
        },
      ],
      meta: { page: 2, total: 21, totalPages: 2 },
    });
    expect(tx.campusSubject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campusId,
          name: { contains: 'Archived', mode: 'insensitive' },
        },
        skip: 20,
        take: 20,
      }),
    );
    expect(tx.coursePackage.findMany).not.toHaveBeenCalled();
  });

  it('also rejects fresh identity loss on the subject directory', async () => {
    const { service, fresh, query } = host();
    fresh.user.findUnique.mockResolvedValue(null);
    await expect(service.subjects(actor, query)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it.each(['lessonAccount', 'subjects'] as const)(
    'rejects an overflowing %s page before opening a transaction',
    async (method) => {
      for (const page of [1e308, 2147483647]) {
        const { service, prisma } = host();
        await expect(
          Promise.resolve().then(async () => {
            await service[method](actor, { page, pageSize: 100 });
          }),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(prisma.$transaction).not.toHaveBeenCalled();
      }
    },
  );

  it('both new DTOs reject huge, fractional and nonnumeric page values', () => {
    const dtos = jest.requireActual<{
      OperatorAccountQueryDto: new () => object;
      OperatorAccountSubjectsQueryDto: new () => object;
    }>('../src/modules/operator/dto/operator-account.dto');
    for (const Type of [
      dtos.OperatorAccountQueryDto,
      dtos.OperatorAccountSubjectsQueryDto,
    ]) {
      for (const page of ['1e308', '2147483648', '1.5', 'bad', '0'])
        expect(
          validateSync(plainToInstance(Type, { page }), {
            whitelist: true,
            forbidNonWhitelisted: true,
          }).length,
        ).toBeGreaterThan(0);
      expect(
        validateSync(plainToInstance(Type, { page: '1', pageSize: '20' })),
      ).toEqual([]);
    }
  });

  it('rejects caller scope fields, invalid subject IDs and invalid page size', () => {
    const { OperatorAccountQueryDto } = jest.requireActual<{
      OperatorAccountQueryDto: new () => object;
    }>('../src/modules/operator/dto/operator-account.dto');
    for (const query of [
      { campusId },
      { subjectId: 'not-an-id' },
      { entryType: 'ALL' },
      { pageSize: 101 },
    ]) {
      expect(
        validateSync(plainToInstance(OperatorAccountQueryDto, query), {
          whitelist: true,
          forbidNonWhitelisted: true,
        }).length,
      ).toBeGreaterThan(0);
    }
  });
});
