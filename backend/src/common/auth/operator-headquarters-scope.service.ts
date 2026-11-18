import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DomainError } from '../errors/domain-error';
import { ErrorCode } from '../errors/error-codes';
import type { AuthenticatedUser } from './authenticated-user';

type Client = Prisma.TransactionClient;
interface CampusGrant {
  campusId: string;
  version: number;
}

@Injectable()
export class OperatorHeadquartersScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot<T>(
    actor: AuthenticatedUser,
    read: (tx: Client, campusIds: readonly string[]) => Promise<T>,
    selectedCampusId?: string,
  ): Promise<T> {
    if (
      actor.roles.length !== 1 ||
      actor.roles[0].code !== 'OPERATOR' ||
      actor.roles[0].campusId !== null
    )
      this.forbidden();

    const snapshot = await this.prisma.$transaction(
      async (tx) => {
        await this.current(tx, actor.userId);
        const grants = await this.grants(tx, actor.userId);
        if (
          selectedCampusId !== undefined &&
          !grants.some((grant) => grant.campusId === selectedCampusId)
        )
          this.forbidden();
        return {
          grants,
          result: await read(
            tx,
            grants.map((grant) => grant.campusId),
          ),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
      },
    );

    // The fresh snapshot must observe revocation hidden by repeatable reads.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User"
          WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "UserRole"
          WHERE "userId" = ${actor.userId}::uuid ORDER BY "id" FOR SHARE`;
        await tx.$queryRaw`SELECT "campusId" FROM "OperatorCampusReadGrant"
          WHERE "userId" = ${actor.userId}::uuid ORDER BY "campusId" FOR SHARE`;
        await this.current(tx, actor.userId);
        const current = await this.grants(tx, actor.userId);
        if (
          current.length !== snapshot.grants.length ||
          current.some(
            (grant, index) =>
              grant.campusId !== snapshot.grants[index].campusId ||
              grant.version !== snapshot.grants[index].version,
          )
        )
          this.forbidden();
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15000,
      },
    );
    return snapshot.result;
  }

  private async current(tx: Client, userId: string) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        roles: { select: { roleCode: true, campusId: true } },
      },
    });
    if (!user || user.status !== 'ACTIVE')
      throw new DomainError(
        ErrorCode.UNAUTHORIZED,
        'The current staff session is no longer active',
        401,
      );
    if (
      user.roles.length !== 1 ||
      user.roles[0].roleCode !== 'OPERATOR' ||
      user.roles[0].campusId !== null
    )
      this.forbidden();
  }

  private async grants(tx: Client, userId: string): Promise<CampusGrant[]> {
    const rows = await tx.$queryRaw<CampusGrant[]>`
      SELECT g."campusId", g."version" FROM "OperatorCampusReadGrant" g
      WHERE g."userId" = ${userId}::uuid AND g."isActive" = true
      ORDER BY g."campusId"`;
    const ids = new Set<string>();
    for (const row of rows) {
      if (
        !row.campusId ||
        ids.has(row.campusId) ||
        !Number.isInteger(row.version) ||
        row.version < 1 ||
        row.version > 2_147_483_647
      )
        throw new DomainError(
          ErrorCode.INTERNAL_SERVER_ERROR,
          'The explicit campus grants require verification',
          500,
        );
      ids.add(row.campusId);
    }
    return [...rows].sort((a, b) => a.campusId.localeCompare(b.campusId));
  }

  private forbidden(): never {
    throw new DomainError(
      ErrorCode.FORBIDDEN,
      'An explicit headquarters operator campus grant is required',
      403,
    );
  }
}
