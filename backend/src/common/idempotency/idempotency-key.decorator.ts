import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { DomainError } from '../errors/domain-error';
import { ErrorCode } from '../errors/error-codes';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

const IDEMPOTENCY_KEY_PATTERN = new RegExp(
  `^[A-Za-z0-9._:-]{${IDEMPOTENCY_KEY_MIN_LENGTH},${IDEMPOTENCY_KEY_MAX_LENGTH}}$`,
);

type RequestHeaders = Pick<Request, 'headers'>;

export function extractIdempotencyKey(request: RequestHeaders): string {
  const value = request.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()];
  if (value === undefined) {
    throw new DomainError(
      ErrorCode.INVALID_IDEMPOTENCY_KEY,
      `${IDEMPOTENCY_KEY_HEADER} is required`,
      400,
      {
        header: IDEMPOTENCY_KEY_HEADER,
        minLength: IDEMPOTENCY_KEY_MIN_LENGTH,
        maxLength: IDEMPOTENCY_KEY_MAX_LENGTH,
      },
    );
  }

  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new DomainError(
      ErrorCode.INVALID_IDEMPOTENCY_KEY,
      `${IDEMPOTENCY_KEY_HEADER} must be ${IDEMPOTENCY_KEY_MIN_LENGTH}-${IDEMPOTENCY_KEY_MAX_LENGTH} characters using letters, numbers, dot, underscore, colon, or hyphen`,
      400,
      {
        header: IDEMPOTENCY_KEY_HEADER,
        minLength: IDEMPOTENCY_KEY_MIN_LENGTH,
        maxLength: IDEMPOTENCY_KEY_MAX_LENGTH,
      },
    );
  }

  return value;
}

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    extractIdempotencyKey(context.switchToHttp().getRequest<Request>()),
);
