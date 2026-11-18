import { Prisma } from '@prisma/client';
import { OperatorScopeService } from '../../common/auth/operator-scope.service';
import { PartnerScopeService } from '../../common/auth/partner-scope.service';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PartnerRankingService } from '../partner/partner-ranking.service';
import { PartnerRankingQueryDto } from '../partner/dto/partner-ranking.dto';
import { ROLE_PERMISSION_MATRIX } from '../iam/role-permission.matrix';

const campusId = '99713a3d-ee64-4f9a-96b1-e0cf84bbe7b9';
const actor: AuthenticatedUser = {
  userId: 'e56f97bc-1d09-4935-bf08-ac1a5fd3fe3a',
  roles: [{ code: 'OPERATOR', campusId }],
};
const now = new Date('2026-10-28T08:00:00.000Z');
const revisionId = 'f8345dc3-2a68-49c6-8f5f-10119c138455';

function host() {
  const own = {
    campusId,
    campusName: 'Synthetic own campus',
    rank: 3,
    previousRank: 5,
  };
  const other = {
    campusId: 'd066cf74-f813-4d37-97c7-6f62f7c813f4',
    campusName: 'Synthetic other campus',
    rank: 1,
    previousRank: null,
  };
  const tx = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        status: 'ACTIVE',
        roles: [{ roleCode: 'OPERATOR', campusId }],
      }),
    },
    partnerRankingRevision: {
      findFirst: jest.fn().mockResolvedValue({
        id: revisionId,
        asOf: new Date('2026-10-28T07:00:00.000Z'),
      }),
    },
    partnerRankingRow: {
      findMany: jest.fn().mockResolvedValue([other]),
      findUnique: jest.fn().mockResolvedValue(own),
      count: jest.fn().mockResolvedValue(21),
    },
  };
  const prisma = {
    $transaction: jest.fn((read: (value: typeof tx) => Promise<unknown>) =>
      read(tx),
    ),
  };
  const service = Reflect.construct(PartnerRankingService, [
    prisma,
    new PartnerScopeService(),
    new OperatorScopeService(),
  ]) as PartnerRankingService & {
    listForOperator(
      user: AuthenticatedUser,
      query: PartnerRankingQueryDto,
      time: Date,
    ): Promise<Record<string, unknown>>;
  };
  const query = Object.assign(new PartnerRankingQueryDto(), {
    month: '2026-10',
    revisionId,
    page: 2,
    pageSize: 20,
  });
  return { service, prisma, tx, query };
}

describe('independent operator monthly rankings', () => {
  it('projects only four allowed fields and keeps the independent own-campus row', async () => {
    const { service, prisma, tx, query } = host();
    const result = await service.listForOperator(actor, query, now);
    expect(result).toMatchObject({
      metric: 'STUDENTS',
      month: '2026-10',
      asOf: '2026-10-28T07:00:00.000Z',
      revisionId,
      data: [
        {
          campusName: 'Synthetic other campus',
          rank: 1,
          rankDelta: null,
          isOwnCampus: false,
        },
      ],
      ownCampus: {
        campusName: 'Synthetic own campus',
        rank: 3,
        rankDelta: 2,
        isOwnCampus: true,
      },
      meta: { page: 2, pageSize: 20, total: 21, totalPages: 2 },
    });
    for (const row of [
      ...(result.data as object[]),
      result.ownCampus as object,
    ]) {
      expect(Object.keys(row).sort()).toEqual([
        'campusName',
        'isOwnCampus',
        'rank',
        'rankDelta',
      ]);
    }
    expect(tx.partnerRankingRow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction.mock.calls[0]).toHaveLength(2);
    expect((prisma.$transaction.mock.calls[0] as unknown[])[1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20_000,
    });
  });

  it.each([
    [{ code: 'OPERATOR', campusId: null }],
    [{ code: 'PARTNER', campusId }],
    [
      { code: 'OPERATOR', campusId },
      { code: 'TEACHER', campusId },
    ],
    [
      { code: 'OPERATOR', campusId },
      { code: 'OPERATOR', campusId: 'another-campus' },
    ],
  ] as AuthenticatedUser['roles'][])(
    'rejects invalid role sets before reading source data: %j',
    async (...roles) => {
      const { service, prisma, query } = host();
      await expect(
        service.listForOperator({ ...actor, roles }, query, now),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects a stale actor whose persisted scope is no longer OPERATOR', async () => {
    const { service, tx, query } = host();
    tx.user.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      roles: [{ roleCode: 'PARTNER', campusId }],
    });
    await expect(
      service.listForOperator(actor, query, now),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.partnerRankingRevision.findFirst).not.toHaveBeenCalled();
  });

  it('rechecks current scope outside the repeatable snapshot before returning data', async () => {
    const { service, tx, query } = host();
    tx.user.findUnique
      .mockResolvedValueOnce({
        status: 'ACTIVE',
        roles: [{ roleCode: 'OPERATOR', campusId }],
      })
      .mockResolvedValueOnce({
        status: 'DISABLED',
        roles: [{ roleCode: 'OPERATOR', campusId }],
      });
    await expect(
      service.listForOperator(actor, query, now),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.partnerRankingRow.findMany).toHaveBeenCalledTimes(1);
    expect(tx.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('keeps the existing partner projection and partner-only scope validation', async () => {
    const { service, tx, query } = host();
    tx.user.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      roles: [{ roleCode: 'PARTNER', campusId }],
    });
    const result = await service.list(
      { ...actor, roles: [{ code: 'PARTNER', campusId }] },
      query,
      now,
    );
    expect(result.ownCampus).toMatchObject({
      campusId,
      previousRank: 5,
      rankDelta: 2,
    });
    await expect(service.list(actor, query, now)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('grants only the role-specific read capability without financial writes', () => {
    expect(ROLE_PERMISSION_MATRIX.OPERATOR).toContain('OPERATOR_RANKING_READ');
    for (const role of [
      'PARTNER',
      'CAMPUS_MANAGER',
      'PARENT',
      'TEACHER',
    ] as const)
      expect(ROLE_PERMISSION_MATRIX[role]).not.toContain(
        'OPERATOR_RANKING_READ',
      );
    for (const forbidden of [
      'PARTNER_RANKING_READ',
      'PARTNER_WITHDRAWAL_CREATE',
      'PARTNER_EARNING_REVIEW',
      'FINANCE_REFUND_PAY',
      'LESSON_LEDGER_ADJUST',
    ])
      expect(ROLE_PERMISSION_MATRIX.OPERATOR).not.toContain(forbidden);
  });
});
