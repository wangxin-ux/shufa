import {
  allowStudentNativeRequest as allowed,
  type StudentNativeScope,
} from './support/partner-students-native-policy';

const scope: StudentNativeScope = {
  partnerId: 'owned-partner',
  loginCode: 'ephemeral-owned-login',
  studentIds: ['owned-student'],
};

describe('partner students native fixture request boundary', () => {
  it('admits the exact synthetic login without additional fields', () => {
    const login = {
      method: 'POST',
      path: '/auth/login',
      body: { code: scope.loginCode },
    };
    expect(allowed(scope, login)).toBe(true);
    for (const body of [
      null,
      [],
      {},
      { code: 'other' },
      { code: scope.loginCode, role: 'SUPER_ADMIN' },
    ]) {
      expect(allowed(scope, { ...login, body })).toBe(false);
    }
  });

  it.each([
    '/me',
    '/partners/me/profile',
    '/partners/me/subjects',
    '/partners/me/students',
    '/partners/me/students/owned-student',
  ])('admits only the fixture partner reading %s', (path) => {
    const read = { method: 'GET', path, actorId: scope.partnerId };
    expect(allowed(scope, read)).toBe(true);
    expect(allowed(scope, { ...read, actorId: 'other' })).toBe(false);
    expect(allowed(scope, { ...read, actorId: undefined })).toBe(false);
    expect(allowed(scope, { ...read, method: 'POST' })).toBe(false);
    expect(allowed(scope, { ...read, method: 'PATCH' })).toBe(false);
    expect(allowed(scope, { ...read, method: 'DELETE' })).toBe(false);
  });

  it.each([
    '/partners/me/students/other',
    '/partners/me/students/owned-student/growth',
    '/partners/me/students/owned-student/',
    '/partners/me/students/owned-student-other',
    '/partners/me/lesson-account',
    '/partners/me/rankings',
    '/partners/me/withdrawals',
    '/management/campuses',
  ])('rejects reads outside the declared fixture: %s', (path) => {
    expect(
      allowed(scope, { method: 'GET', path, actorId: scope.partnerId }),
    ).toBe(false);
  });

  it('fails closed before an actor or student ownership is established', () => {
    const empty = { partnerId: '', loginCode: '', studentIds: [] };
    expect(
      allowed(empty, {
        method: 'POST',
        path: '/auth/login',
        body: { code: '' },
      }),
    ).toBe(false);
    expect(allowed(empty, { method: 'GET', path: '/me', actorId: '' })).toBe(
      false,
    );
    expect(
      allowed(
        { ...scope, studentIds: [] },
        {
          method: 'GET',
          path: '/partners/me/students/owned-student',
          actorId: scope.partnerId,
        },
      ),
    ).toBe(false);
  });
});
