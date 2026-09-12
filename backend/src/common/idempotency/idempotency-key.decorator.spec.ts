import { DomainError } from '../errors/domain-error';
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  extractIdempotencyKey,
} from './idempotency-key.decorator';

const requestWithKey = (value: string | string[]) => ({
  headers: { 'idempotency-key': value },
});

describe('extractIdempotencyKey', () => {
  it('rejects a missing idempotency key', () => {
    expect(() => extractIdempotencyKey({ headers: {} })).toThrow(DomainError);
  });

  it.each([
    'a'.repeat(IDEMPOTENCY_KEY_MIN_LENGTH),
    'a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH),
    'request-2026_08.27:01',
  ])('accepts a single valid key: %s', (key) => {
    expect(extractIdempotencyKey(requestWithKey(key))).toBe(key);
  });

  it.each([
    'a'.repeat(IDEMPOTENCY_KEY_MIN_LENGTH - 1),
    'a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1),
    'request key',
    'request/key',
  ])('rejects an invalid key: %s', (key) => {
    expect(() => extractIdempotencyKey(requestWithKey(key))).toThrow(
      DomainError,
    );
  });

  it('rejects multiple idempotency key headers', () => {
    expect(() =>
      extractIdempotencyKey(requestWithKey(['request-1', 'request-2'])),
    ).toThrow(DomainError);
  });
});
