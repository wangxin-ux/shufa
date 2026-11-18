import type { Prisma } from '@prisma/client';

export function isOwnedFreeReviewPageRead(
  origin: string,
  ids: readonly string[],
  input: { url: string; method: string; data?: unknown },
): boolean {
  if (
    input.method !== 'GET' ||
    input.data !== undefined ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)
  )
    return false;
  let target: URL;
  try {
    target = new URL(input.url);
  } catch {
    return false;
  }
  if (
    target.origin !== origin ||
    target.username ||
    target.password ||
    target.hash
  )
    return false;
  if (target.pathname === '/management/campaign-reviews') {
    const keys = [...target.searchParams.keys()];
    const page = target.searchParams.get('page') ?? '';
    const status = target.searchParams.get('status');
    return (
      keys.every((key) => ['page', 'pageSize', 'status'].includes(key)) &&
      new Set(keys).size === keys.length &&
      /^[1-9]\d*$/.test(page) &&
      Number(page) <= 1_000_000 &&
      target.searchParams.get('pageSize') === '20' &&
      (status === null ||
        ['SUBMITTED', 'APPROVED', 'REJECTED'].includes(status))
    );
  }
  return (
    target.search === '' &&
    ids.some((id) => target.pathname === `/management/campaign-reviews/${id}`)
  );
}

export function ownedFreeReviewRead(
  tx: Prisma.TransactionClient,
  ids: readonly string[],
): Prisma.TransactionClient {
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some(
      (id) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ),
    )
  )
    throw new Error('Explicit unique review fixture IDs required');
  const owned = [...ids];
  const versions = new Proxy(tx.campaignVersion, {
    get(target, property) {
      if (property === 'count')
        return (args: Prisma.CampaignVersionCountArgs = {}) =>
          target.count({
            ...args,
            where: { AND: [args.where ?? {}, { id: { in: [...owned] } }] },
          });
      if (property === 'findMany')
        return (args: Prisma.CampaignVersionFindManyArgs = {}) =>
          target.findMany({
            ...args,
            where: { AND: [args.where ?? {}, { id: { in: [...owned] } }] },
          });
      if (property === 'findUnique') {
        return (args: Prisma.CampaignVersionFindUniqueArgs) => {
          if (!args.where.id || !owned.includes(args.where.id))
            throw new Error('Owned review detail required');
          return target.findUnique(args);
        };
      }
      throw new Error('Read-only review fixture delegate required');
    },
  });
  // The application's snapshot still performs its real identity checks and
  // repeatable-read transaction; only candidate reads get fixture confinement.
  return new Proxy(tx, {
    get(target, property, receiver) {
      if (property === 'campaignVersion') return versions;
      const value: unknown = Reflect.get(target, property, receiver);
      return value;
    },
  });
}
