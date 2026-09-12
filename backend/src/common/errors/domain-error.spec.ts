import { ErrorCode } from './error-codes';
import { DomainError } from './domain-error';

describe('DomainError', () => {
  it.each([200, 399, 600, 400.5])(
    'rejects an invalid HTTP error status: %s',
    (statusCode) => {
      expect(
        () =>
          new DomainError(ErrorCode.BAD_REQUEST, 'invalid status', statusCode),
      ).toThrow(RangeError);
    },
  );

  it.each([400, 599])('accepts an HTTP error status: %s', (statusCode) => {
    expect(
      new DomainError(ErrorCode.BAD_REQUEST, 'valid status', statusCode)
        .statusCode,
    ).toBe(statusCode);
  });
});
