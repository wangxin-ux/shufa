import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';

interface IssueStaffBindTokenInput {
  userId: string;
  rawToken: string;
  expiresAt: Date;
}

const STAFF_BIND_ROUTE = '/auth/staff/bind';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class StaffBindTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(input: IssueStaffBindTokenInput): Promise<void> {
    if (input.rawToken.length < 16 || input.rawToken.length > 256) {
      throw new RangeError('Staff bind tokens must contain 16-256 characters');
    }

    const now = new Date();
    if (input.expiresAt <= now) {
      throw new RangeError('Staff bind token expiration must be in the future');
    }

    await this.prisma.staffBindToken.create({
      data: {
        userId: input.userId,
        tokenDigest: this.digest(input.rawToken),
        tokenHash: await hash(input.rawToken, { type: argon2id }),
        expiresAt: input.expiresAt,
      },
    });
  }

  async consume(
    rawToken: string,
    mockSubject: string,
    idempotencyKey: string,
  ): Promise<string> {
    const tokenDigest = this.digest(rawToken);
    const requestHash = this.digest(JSON.stringify([mockSubject, tokenDigest]));

    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const claim = await transaction.idempotencyRecord.createMany({
        data: {
          key: idempotencyKey,
          route: STAFF_BIND_ROUTE,
          requestHash,
          status: 'IN_PROGRESS',
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
        },
        skipDuplicates: true,
      });
      if (claim.count === 0) {
        return this.replayCompletedRequest(
          transaction,
          idempotencyKey,
          requestHash,
        );
      }

      const userId = await this.consumeToken(
        transaction,
        rawToken,
        tokenDigest,
        mockSubject,
        now,
      );
      await transaction.idempotencyRecord.update({
        where: {
          key_route: { key: idempotencyKey, route: STAFF_BIND_ROUTE },
        },
        data: {
          actorUserId: userId,
          status: 'COMPLETED',
          responseStatus: 200,
          responseBody: { userId },
        },
      });

      return userId;
    });
  }

  private async consumeToken(
    transaction: Prisma.TransactionClient,
    rawToken: string,
    tokenDigest: string,
    mockSubject: string,
    now: Date,
  ): Promise<string> {
    const token = await transaction.staffBindToken.findUnique({
      where: { tokenDigest },
      select: {
        id: true,
        userId: true,
        tokenHash: true,
        expiresAt: true,
        consumedAt: true,
      },
    });
    if (!token) {
      this.unauthorized();
    }
    if (token.consumedAt || token.expiresAt <= new Date()) {
      this.conflict();
    }
    if (!(await verify(token.tokenHash, rawToken))) {
      this.unauthorized();
    }

    try {
      const consumed = await transaction.staffBindToken.updateMany({
        where: {
          id: token.id,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        this.conflict();
      }

      const [subjectIdentity, userIdentity] = await Promise.all([
        transaction.authIdentity.findUnique({
          where: {
            provider_subject: { provider: 'MOCK', subject: mockSubject },
          },
          select: { id: true },
        }),
        transaction.authIdentity.findUnique({
          where: {
            userId_provider: { userId: token.userId, provider: 'MOCK' },
          },
          select: { id: true },
        }),
      ]);
      if (subjectIdentity || userIdentity) {
        this.conflict();
      }

      await transaction.authIdentity.create({
        data: {
          userId: token.userId,
          provider: 'MOCK',
          subject: mockSubject,
        },
      });
    } catch (error: unknown) {
      if (error instanceof DomainError) {
        throw error;
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        this.conflict();
      }
      throw error;
    }

    return token.userId;
  }

  private async replayCompletedRequest(
    transaction: Prisma.TransactionClient,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<string> {
    const record = await transaction.idempotencyRecord.findUnique({
      where: {
        key_route: { key: idempotencyKey, route: STAFF_BIND_ROUTE },
      },
      select: {
        requestHash: true,
        status: true,
        responseBody: true,
      },
    });
    if (
      !record ||
      record.requestHash !== requestHash ||
      record.status !== 'COMPLETED'
    ) {
      this.idempotencyConflict();
    }

    const responseBody = record.responseBody;
    if (
      typeof responseBody !== 'object' ||
      responseBody === null ||
      Array.isArray(responseBody) ||
      typeof responseBody.userId !== 'string'
    ) {
      throw new Error('Completed staff bind idempotency result is invalid');
    }

    return responseBody.userId;
  }

  private digest(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }

  private unauthorized(): never {
    throw new DomainError(
      ErrorCode.UNAUTHORIZED,
      'The staff bind token is invalid',
      401,
    );
  }

  private conflict(): never {
    throw new DomainError(
      ErrorCode.CONFLICT,
      'The staff bind token is expired, consumed, or already bound',
      409,
    );
  }

  private idempotencyConflict(): never {
    throw new DomainError(
      ErrorCode.CONFLICT,
      'The idempotency key is already in use for a different request',
      409,
    );
  }
}
