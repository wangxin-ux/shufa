import {
  allowRankingNativeRequest as allowed,
  type RankingNativeScope,
} from './support/partner-rankings-native-policy';

const scope: RankingNativeScope = {
  partnerId: 'owned-partner',
  loginCode: 'ephemeral-owned-login',
};

describe('monthly rankings native fixture boundary', () => {
  it('accepts only the owned synthetic login with exactly one field', () => {
    const request = { method: 'POST', path: '/auth/login' };
    expect(
      allowed(scope, { ...request, body: { code: scope.loginCode } }),
    ).toBe(true);
    for (const body of [
      null,
      [],
      {},
      { code: 'other' },
      { code: scope.loginCode, role: 'SUPER_ADMIN' },
    ])
      expect(allowed(scope, { ...request, body })).toBe(false);
  });

  it.each([
    '/me',
    '/partners/me/profile',
    '/partners/me/subjects',
    '/partners/me/lesson-account',
    '/partners/me/earnings',
    '/partners/me/earnings/summary',
    '/partners/me/rankings',
  ])('requires the declared actor and GET for %s', (path) => {
    expect(
      allowed(scope, { method: 'GET', path, actorId: scope.partnerId }),
    ).toBe(true);
    for (const actorId of [undefined, '', 'other'])
      expect(allowed(scope, { method: 'GET', path, actorId })).toBe(false);
    for (const method of ['POST', 'PATCH', 'DELETE'])
      expect(allowed(scope, { method, path, actorId: scope.partnerId })).toBe(
        false,
      );
  });

  it.each([
    '/partners/me/students',
    '/partners/me/rankings/',
    '/partners/me/rankings/other',
    '/partners/me/withdrawals',
    '/management/campuses',
  ])('rejects unrelated paths: %s', (path) => {
    expect(
      allowed(scope, { method: 'GET', path, actorId: scope.partnerId }),
    ).toBe(false);
  });

  it('fails closed before fixture identity is established', () => {
    const empty = { partnerId: '', loginCode: '' };
    expect(allowed(empty, { method: 'GET', path: '/me', actorId: '' })).toBe(
      false,
    );
    expect(
      allowed(empty, {
        method: 'POST',
        path: '/auth/login',
        body: { code: '' },
      }),
    ).toBe(false);
  });
});
