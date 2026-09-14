import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { DomainError } from '../errors/domain-error';
import { ErrorCode } from '../errors/error-codes';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

interface ClaimInput {
  key: string;
  route: string;
  request: unknown;
  campusId: string | null;
  actorUserId: string;
}

export type IdempotencyClaim =
  | { replayed: false; requestHash: string }
  | { replayed: true; responseBody: Prisma.JsonValue };

@Injectable()
export class IdempotencyService {
  async claim(
    transaction: Prisma.TransactionClient,
    input: ClaimInput,
  ): Promise<IdempotencyClaim> {
    const requestHash = createHash('sha256')
      .update(JSON.stringify(canonicalize(input.request)), 'utf8')
      .digest('hex');
    const inserted = await transaction.idempotencyRecord.createMany({
      data: {
        key: input.key,
        route: input.route,
        requestHash,
        campusId: input.campusId,
        actorUserId: input.actorUserId,
        status: 'IN_PROGRESS',
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
      skipDuplicates: true,
    });
    if (inserted.count === 1) {
      return { replayed: false, requestHash };
    }

    const existing = await transaction.idempotencyRecord.findUnique({
      where: { key_route: { key: input.key, route: input.route } },
      select: {
        requestHash: true,
        status: true,
        responseBody: true,
        campusId: true,
        actorUserId: true,
      },
    });
    if (
      !existing ||
      existing.requestHash !== requestHash ||
      existing.campusId !== input.campusId ||
      existing.actorUserId !== input.actorUserId
    ) {
      this.conflict('The idempotency key was used for a different request');
    }
    if (existing.status !== 'COMPLETED' || existing.responseBody === null) {
      this.conflict('The idempotent request is still being processed');
    }

    return { replayed: true, responseBody: existing.responseBody };
  }

  async complete(
    transaction: Prisma.TransactionClient,
    input: {
      key: string;
      route: string;
      responseBody: Prisma.InputJsonValue;
      responseStatus?: number;
    },
  ): Promise<void> {
    await transaction.idempotencyRecord.update({
      where: { key_route: { key: input.key, route: input.route } },
      data: {
        status: 'COMPLETED',
        responseStatus: input.responseStatus ?? 200,
        responseBody: input.responseBody,
      },
    });
  }

  private conflict(message: string): never {
    throw new DomainError(ErrorCode.IDEMPOTENCY_CONFLICT, message, 409);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== 'object' || value === null || value instanceof Date) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}
