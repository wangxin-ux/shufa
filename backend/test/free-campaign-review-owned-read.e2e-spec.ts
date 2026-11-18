import type { Prisma } from '@prisma/client';

const first = '10000000-0000-4000-8000-000000000001';
const second = '10000000-0000-4000-8000-000000000002';
const other = '10000000-0000-4000-8000-000000000003';
const ownedRead = (
  tx: Prisma.TransactionClient,
  ids: readonly string[],
): Prisma.TransactionClient =>
  jest
    .requireActual<{
      ownedFreeReviewRead: typeof ownedRead;
    }>('./support/free-campaign-review-owned-read')
    .ownedFreeReviewRead(tx, ids);

function fixture() {
  const versions = {
    count: jest.fn().mockResolvedValue(2),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue({ id: first }),
    update: jest.fn(),
  };
  const user = { findUnique: jest.fn() };
  const tx = { campaignVersion: versions, user };
  return {
    tx: tx as unknown as Prisma.TransactionClient,
    versions,
    user,
  };
}

describe('exclusive free-review fixture read confinement (no database)', () => {
  it.each(['count', 'findMany'] as const)(
    'adds immutable owned IDs to %s while retaining caller status and paging',
    async (method) => {
      const f = fixture();
      const ids = [first, second];
      const isolated = ownedRead(f.tx, ids);
      ids.push(other);
      const args = {
        where: { status: 'SUBMITTED' as const },
        skip: 20,
        take: 20,
      };
      if (method === 'count') await isolated.campaignVersion.count(args);
      else await isolated.campaignVersion.findMany(args);
      expect(f.versions[method]).toHaveBeenCalledWith({
        ...args,
        where: { AND: [args.where, { id: { in: [first, second] } }] },
      });
      expect(args.where).toEqual({ status: 'SUBMITTED' });
    },
  );
  it('intersects an adversarial caller ID predicate instead of replacing the whitelist', async () => {
    const f = fixture();
    await ownedRead(f.tx, [first]).campaignVersion.findMany({
      where: {
        id: other,
        OR: [{ status: 'APPROVED' }, { status: 'SUBMITTED' }],
      },
    });
    expect(f.versions.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { id: other, OR: [{ status: 'APPROVED' }, { status: 'SUBMITTED' }] },
          { id: { in: [first] } },
        ],
      },
    });
  });
  it('permits the exact owned unique detail and refuses unknown or indirect identifiers', async () => {
    const f = fixture();
    const isolated = ownedRead(f.tx, [first]);
    await isolated.campaignVersion.findUnique({ where: { id: first } });
    expect(f.versions.findUnique).toHaveBeenCalledTimes(1);
    expect(() =>
      isolated.campaignVersion.findUnique({ where: { id: other } }),
    ).toThrow('Owned review detail required');
    expect(() =>
      isolated.campaignVersion.findUnique({
        where: { campaignId_sequence: { campaignId: first, sequence: 1 } },
      }),
    ).toThrow('Owned review detail required');
    expect(f.versions.findUnique).toHaveBeenCalledTimes(1);
  });
  it('refuses a write or an unsupported delegate before database dispatch', () => {
    const f = fixture();
    const isolated = ownedRead(f.tx, [first]);
    expect(() =>
      isolated.campaignVersion.update({
        where: { id: first },
        data: { status: 'APPROVED' },
      }),
    ).toThrow('Read-only review fixture delegate required');
    expect(() => isolated.campaignVersion.findFirst()).toThrow(
      'Read-only review fixture delegate required',
    );
    expect(f.versions.update).not.toHaveBeenCalled();
  });
  it.each([{ ids: [] }, { ids: ['other'] }, { ids: [first, first] }])(
    'refuses an empty, malformed or duplicate ownership set (%#)',
    ({ ids }) => {
      const f = fixture();
      expect(() => ownedRead(f.tx, ids)).toThrow(
        'Explicit unique review fixture IDs required',
      );
      expect(f.versions.count).not.toHaveBeenCalled();
    },
  );
  it('keeps the real transaction identity queries and the original delegate unchanged', () => {
    const f = fixture();
    const original = f.versions.count;
    const isolated = ownedRead(f.tx, [first]);
    expect(isolated.user).toBe(f.user);
    expect(Reflect.get(f.tx.campaignVersion, 'count')).toBe(original);
    expect(isolated).not.toBe(f.tx);
  });
});

const origin = 'http://127.0.0.1:3001';
const allow = (method: string, suffix: string, data?: unknown) =>
  jest
    .requireActual<{
      isOwnedFreeReviewPageRead(
        origin: string,
        ids: readonly string[],
        input: { url: string; method: string; data?: unknown },
      ): boolean;
    }>('./support/free-campaign-review-owned-read')
    .isOwnedFreeReviewPageRead(origin, [first], {
      method,
      url: origin + suffix,
      data,
    });

describe('Page read channel admission before HTTP dispatch (no database)', () => {
  const list =
    '/management/campaign-reviews?page=1&pageSize=20&status=SUBMITTED';
  it('admits only an owned detail and the exact bounded list query', () => {
    expect(allow('GET', list)).toBe(true);
    expect(
      allow('GET', '/management/campaign-reviews?page=2&pageSize=20'),
    ).toBe(true);
    expect(allow('GET', `/management/campaign-reviews/${first}`)).toBe(true);
    expect(allow('GET', `/management/campaign-reviews/${other}`)).toBe(false);
  });
  it.each([
    ['POST', `/management/campaign-reviews/${first}/approve`],
    ['POST', `/management/campaign-reviews/${other}/approve`],
    ['POST', `/management/campaign-reviews/${first}/reject`],
    ['POST', `/management/campaigns/${first}/close`],
    ['PUT', '/partners/me/campaign-drafts/owned/basic-information'],
  ])('refuses Page-side %s %s before side effects', (method, suffix) => {
    expect(allow(method, suffix)).toBe(false);
  });
  it.each([
    '/management/campaign-reviews',
    '/management/campaign-reviews?page=0&pageSize=20',
    '/management/campaign-reviews?page=1000001&pageSize=20',
    '/management/campaign-reviews?page=1&pageSize=100',
    '/management/campaign-reviews?page=1&pageSize=20&campusId=other',
    '/management/campaign-reviews?page=1&pageSize=20&page=2',
    '/management/campaign-reviews?page=1&pageSize=20&status=OTHER',
    `/management/campaign-reviews/${first}?campusId=other`,
    `/management/campaign-reviews/${first}#ignored`,
  ])('refuses a malformed, expanded or duplicate query (%#)', (suffix) => {
    expect(allow('GET', suffix)).toBe(false);
  });
  it('refuses GET bodies and another HTTP origin', () => {
    expect(allow('GET', list, { expectedVersion: 1 })).toBe(false);
    const { isOwnedFreeReviewPageRead } = jest.requireActual<{
      isOwnedFreeReviewPageRead: (
        origin: string,
        ids: readonly string[],
        input: { url: string; method: string },
      ) => boolean;
    }>('./support/free-campaign-review-owned-read');
    expect(
      isOwnedFreeReviewPageRead(origin, [first], {
        method: 'GET',
        url: `http://127.0.0.1:3002${list}`,
      }),
    ).toBe(false);
    expect(
      isOwnedFreeReviewPageRead(origin, [first], {
        method: 'GET',
        url: `http://other.example${list}`,
      }),
    ).toBe(false);
  });
});
