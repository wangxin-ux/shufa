import {
  allowSubjectNativeRequest as allowed,
  type SubjectNativeScope,
} from './support/campus-subject-native-policy';

const scope: SubjectNativeScope = {
  adminId: 'owned-admin',
  partnerId: 'owned-partner',
  campusId: 'owned-campus',
  subjectId: 'owned-subject',
  packageId: 'owned-package',
  adminLogin: 'unique-run-admin',
  partnerLogin: 'unique-run-partner',
  renamedSubject: '合成书法新名称',
  bindingReason: '合成课包关联验证',
};
const root = `/management/campuses/${scope.campusId}`;
const rename = {
  method: 'PATCH',
  path: `${root}/subjects/${scope.subjectId}`,
  actorId: scope.adminId,
  body: { name: scope.renamedSubject, isActive: true, expectedVersion: 1 },
};
const bind = {
  method: 'PATCH',
  path: `${root}/subjects/links/PACKAGE/${scope.packageId}`,
  actorId: scope.adminId,
  body: {
    subjectId: scope.subjectId,
    expectedVersion: 1,
    reason: scope.bindingReason,
  },
};

describe('campus subject native fixture request boundary', () => {
  it.each([scope.adminLogin, scope.partnerLogin])(
    'admits only the exact owned login %s',
    (code) => {
      const login = { method: 'POST', path: '/auth/login', body: { code } };
      expect(allowed(scope, login)).toBe(true);
      expect(allowed(scope, { ...login, body: { code: 'other' } })).toBe(false);
      expect(
        allowed(scope, { ...login, body: { code, role: 'SUPER_ADMIN' } }),
      ).toBe(false);
    },
  );

  it.each([root, `${root}/subjects`, `${root}/subjects/links`])(
    'admits the owned headquarters read %s',
    (path) => {
      const read = { method: 'GET', path, actorId: scope.adminId };
      expect(allowed(scope, read)).toBe(true);
      expect(allowed(scope, { ...read, actorId: scope.partnerId })).toBe(false);
      expect(
        allowed(scope, {
          ...read,
          path: path.replace('owned-campus', 'other'),
        }),
      ).toBe(false);
    },
  );

  it.each([
    'profile',
    'subjects',
    'lesson-account',
    'earnings',
    'earnings/summary',
  ])('admits only owned partner %s reads', (suffix) => {
    const read = {
      method: 'GET',
      path: `/partners/me/${suffix}`,
      actorId: scope.partnerId,
    };
    expect(allowed(scope, read)).toBe(true);
    expect(allowed(scope, { ...read, actorId: scope.adminId })).toBe(false);
    expect(allowed(scope, { ...read, actorId: 'other' })).toBe(false);
  });

  it.each([rename, bind])(
    'limits $path to the predeclared write',
    (operation) => {
      expect(allowed(scope, operation)).toBe(true);
      expect(allowed(scope, { ...operation, actorId: scope.partnerId })).toBe(
        false,
      );
      expect(
        allowed(scope, {
          ...operation,
          body: { ...operation.body, expectedVersion: 2 },
        }),
      ).toBe(false);
      expect(
        allowed(scope, {
          ...operation,
          body: { ...operation.body, campusId: 'other' },
        }),
      ).toBe(false);
      expect(allowed(scope, { ...operation, body: null })).toBe(false);
      expect(allowed(scope, { ...operation, body: [] })).toBe(false);
      expect(allowed(scope, { ...operation, body: {} })).toBe(false);
      expect(
        allowed(scope, { ...operation, path: `${operation.path}-other` }),
      ).toBe(false);
    },
  );

  it('rejects changed subject facts and every unrelated operation', () => {
    expect(
      allowed(scope, { ...rename, body: { ...rename.body, name: 'other' } }),
    ).toBe(false);
    expect(
      allowed(scope, { ...rename, body: { ...rename.body, isActive: false } }),
    ).toBe(false);
    expect(
      allowed(scope, { ...bind, body: { ...bind.body, subjectId: null } }),
    ).toBe(false);
    expect(
      allowed(scope, { ...bind, body: { ...bind.body, reason: 'other' } }),
    ).toBe(false);
    for (const [method, path] of [
      ['POST', `${root}/subjects`],
      ['DELETE', `${root}/subjects/${scope.subjectId}`],
      ['PATCH', `${root}/map-location`],
      ['GET', '/management/campuses'],
      ['GET', '/partners/me/rankings'],
      ['POST', '/partners/me/withdrawals'],
    ]) {
      expect(allowed(scope, { method, path, actorId: scope.adminId })).toBe(
        false,
      );
      expect(allowed(scope, { method, path, actorId: scope.partnerId })).toBe(
        false,
      );
    }
  });
});
