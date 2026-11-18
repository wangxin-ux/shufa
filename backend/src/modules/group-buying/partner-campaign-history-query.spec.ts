import type { ParentScopeService } from '../../common/auth/parent-scope.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { StoredFileService } from '../file/stored-file.service';
import type { Prisma } from '@prisma/client';
import { GroupBuyingQueryService } from './group-buying-query.service';

describe('partner campaign history clock and snapshot', () => {
  const now = new Date('2026-10-12T04:00:00.000Z');
  const record = () => ({
    id: 'campaign-1',
    code: 'test-campaign',
    campusId: 'campus-1',
    courseProductId: 'course-1',
    title: '合成活动',
    description: '测试',
    priceFen: 1990,
    maxPaidMembers: 3,
    status: 'ACTIVE',
    startsAt: new Date(now.getTime() - 1_000),
    endsAt: new Date(now.getTime() + 1_000),
    createdAt: now,
    updatedAt: now,
    posters: [],
    campus: {
      name: '合成校区',
      contactPhone: null,
      customerServiceName: null,
      customerServiceQrFile: null,
    },
    courseProduct: { name: '体验课' },
  });
  type Record = ReturnType<typeof record>;
  type Database = {
    groupCampaign: {
      count: typeof count;
      findMany: typeof findMany;
      findFirst: typeof findFirst;
    };
  };
  let count: jest.Mock<Promise<number>, [Prisma.GroupCampaignCountArgs]>;
  let findMany: jest.Mock<
    Promise<Record[]>,
    [Prisma.GroupCampaignFindManyArgs]
  >;
  let findFirst: jest.Mock<
    Promise<Record | null>,
    [Prisma.GroupCampaignFindFirstArgs]
  >;
  let transaction: jest.Mock<
    Promise<unknown>,
    [(database: Database) => Promise<unknown>, { isolationLevel: string }]
  >;
  let service: GroupBuyingQueryService;

  beforeEach(() => {
    jest.useFakeTimers({ now });
    count = jest
      .fn<Promise<number>, [Prisma.GroupCampaignCountArgs]>()
      .mockResolvedValue(1);
    findMany = jest
      .fn<Promise<Record[]>, [Prisma.GroupCampaignFindManyArgs]>()
      .mockResolvedValue([record()]);
    findFirst = jest
      .fn<Promise<Record | null>, [Prisma.GroupCampaignFindFirstArgs]>()
      .mockResolvedValue(record());
    const database = { groupCampaign: { count, findMany, findFirst } };
    transaction = jest.fn<
      Promise<unknown>,
      [(database: Database) => Promise<unknown>, { isolationLevel: string }]
    >((callback) => callback(database));
    service = new GroupBuyingQueryService(
      {
        $transaction: transaction,
        groupCampaign: { findFirst },
      } as unknown as PrismaService,
      {} as ParentScopeService,
      { toCustomerServiceQrUrl: () => null } as unknown as StoredFileService,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('keeps rows, total and promotion flags on one time and database snapshot', async () => {
    const campaign = record();
    findMany.mockImplementation(() => {
      jest.setSystemTime(now.getTime() + 10_000);
      return Promise.resolve([campaign]);
    });
    const result = await service.listPartnerPromotionCampaigns('campus-1', {
      phase: 'ONGOING',
      page: 2,
      pageSize: 5,
    });
    expect(transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'RepeatableRead',
    });
    const where = count.mock.calls[0][0].where as unknown;
    expect(where).toEqual({
      campusId: 'campus-1',
      status: 'ACTIVE',
      startsAt: { lte: now },
      endsAt: { gt: now },
    });
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where,
      skip: 5,
      take: 5,
    });
    expect(result.data[0].canPromote).toBe(true);
    expect(result.meta).toMatchObject({ page: 2, pageSize: 5, total: 1 });
  });

  it('uses an inclusive end boundary and stable ordering for history', async () => {
    await service.listPartnerPromotionCampaigns('campus-1', {
      phase: 'ENDED',
      page: 1,
      pageSize: 20,
    });
    expect(count.mock.calls[0][0].where).toEqual({
      campusId: 'campus-1',
      OR: [{ status: 'CLOSED' }, { status: 'ACTIVE', endsAt: { lte: now } }],
    });
    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { endsAt: 'desc' },
      { id: 'asc' },
    ]);
  });

  it.each([
    {
      label: 'start equals now',
      start: 0,
      end: 1,
      status: 'ACTIVE',
      expected: true,
    },
    {
      label: 'end equals now',
      start: -1,
      end: 0,
      status: 'ACTIVE',
      expected: false,
    },
    {
      label: 'closed before planned end',
      start: -1,
      end: 1,
      status: 'CLOSED',
      expected: false,
    },
  ])(
    'computes canPromote for $label',
    async ({ start, end, status, expected }) => {
      findFirst.mockResolvedValue({
        ...record(),
        status,
        startsAt: new Date(now.getTime() + start),
        endsAt: new Date(now.getTime() + end),
      });
      const result = await service.getPartnerPromotionCampaign(
        'campus-1',
        'campaign-1',
      );
      expect(result.canPromote).toBe(expected);
      expect(findFirst.mock.calls[0][0].where).toEqual({
        id: 'campaign-1',
        campusId: 'campus-1',
        OR: [
          { status: 'CLOSED' },
          { status: 'ACTIVE', startsAt: { lte: now } },
        ],
      });
    },
  );
});
