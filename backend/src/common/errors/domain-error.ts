import type { ErrorCode } from './error-codes';

export type ErrorDetails = Record<string, unknown>;

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly details: ErrorDetails = {},
  ) {
    super(message);
    if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
      throw new RangeError(
        'DomainError statusCode must be an integer from 400 to 599',
      );
    }
    this.name = DomainError.name;
  }
}
