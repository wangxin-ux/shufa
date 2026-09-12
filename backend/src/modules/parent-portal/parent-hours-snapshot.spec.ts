import { ParentPortalService } from './parent-portal.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ParentScopeService } from '../../common/auth/parent-scope.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { StoredFileService } from '../file/stored-file.service';

it('reads parent balances and ledger in one repeatable snapshot', async () => {
  const prisma = {
    coursePackage: { findMany: jest.fn().mockResolvedValue([]) },
    lessonLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    ),
  };
  const scope = {
    resolveStudent: jest.fn().mockResolvedValue({ id: 'student' }),
  };
  const service = new ParentPortalService(
    prisma as unknown as PrismaService,
    scope as unknown as ParentScopeService,
    {} as IdempotencyService,
    {} as StoredFileService,
  );
  await service.getHours({ userId: 'parent', campusId: 'campus' });
  expect(prisma.$transaction).toHaveBeenCalledWith(
    [expect.any(Promise), expect.any(Promise)],
    { isolationLevel: 'RepeatableRead' },
  );
});
