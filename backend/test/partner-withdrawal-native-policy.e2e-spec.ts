import {
  allowWithdrawalNativeRequest as allowed,
  type WithdrawalNativeScope,
} from './support/partner-withdrawal-native-policy';

const scope: WithdrawalNativeScope = {
  adminId: 'admin',
  partnerId: 'partner',
  campusId: 'campus',
  earningId: 'earning',
  runTag: 'owned-run',
  adminLogin: 'owned-admin-code',
  partnerLogin: 'owned-partner-code',
  withdrawals: new Map([['withdrawal', 'proof']]),
};
const configuration = {
  expectedVersion: 0,
  payerName: '模拟付款机构',
  beneficiaryName: '模拟合作机构',
  accountLastFour: '1234',
  minimumAmountFen: 10000,
  dailyRequestLimit: 2,
  reason: '原生联调合成结算确认',
};
describe('withdrawal native fixture boundary', () => {
  it('admits only exact owned ephemeral logins and fails closed before setup', () => {
    for (const code of [scope.adminLogin, scope.partnerLogin])
      expect(
        allowed(scope, { method: 'POST', path: '/auth/login', body: { code } }),
      ).toBe(true);
    for (const body of [
      null,
      [],
      {},
      { code: 'other' },
      { code: scope.adminLogin, role: 'SUPER_ADMIN' },
    ])
      expect(
        allowed(scope, { method: 'POST', path: '/auth/login', body }),
      ).toBe(false);
    expect(
      allowed(
        { ...scope, campusId: '' },
        {
          method: 'POST',
          path: '/auth/login',
          body: { code: scope.adminLogin },
        },
      ),
    ).toBe(false);
  });
  it('requires an owned actor and restricts the campus directory query', () => {
    const request = {
      method: 'GET',
      path: '/management/campuses',
      actorId: scope.adminId,
    };
    expect(
      allowed(scope, {
        ...request,
        query: { page: '1', pageSize: '20', query: '' },
      }),
    ).toBe(true);
    expect(allowed(scope, { ...request, query: { query: scope.runTag } })).toBe(
      true,
    );
    for (const query of [
      { query: 'other' },
      { query: '', regionId: 'other' },
      { query: ['owned-run'] },
    ])
      expect(allowed(scope, { ...request, query })).toBe(false);
    for (const actorId of [undefined, 'other', scope.partnerId])
      expect(allowed(scope, { ...request, actorId })).toBe(false);
  });
  it('confines configuration and source confirmation to the declared fixture', () => {
    const root = `/management/campuses/${scope.campusId}/partner-settlement`;
    const request = {
      actorId: scope.adminId,
      method: 'PUT',
      path: root,
      body: configuration,
    };
    expect(allowed(scope, request)).toBe(true);
    expect(
      allowed(scope, { ...request, path: root.replace('campus', 'other') }),
    ).toBe(false);
    expect(
      allowed(scope, {
        ...request,
        body: { ...configuration, dailyRequestLimit: 100 },
      }),
    ).toBe(false);
    expect(allowed(scope, { ...request, actorId: scope.partnerId })).toBe(
      false,
    );
    const confirm = {
      actorId: scope.adminId,
      method: 'POST',
      path: `${root}/sources/earning`,
      body: {
        expectedVersion: 1,
        expectedProfileVersion: 1,
        reason: configuration.reason,
      },
    };
    expect(allowed(scope, confirm)).toBe(true);
    expect(
      allowed(scope, { ...confirm, path: `${root}/sources/foreign` }),
    ).toBe(false);
  });
  it('permits the planned amount and owned cancellation, with no extra fields', () => {
    const request = {
      actorId: scope.partnerId,
      method: 'POST',
      path: '/partners/me/withdrawals',
      body: { amountFen: 80000, expectedProfileVersion: 1 },
    };
    expect(allowed(scope, request)).toBe(true);
    expect(
      allowed(scope, {
        ...request,
        body: { amountFen: 100000, expectedProfileVersion: 1 },
      }),
    ).toBe(false);
    expect(
      allowed(scope, {
        ...request,
        body: { ...request.body, campusId: 'other' },
      }),
    ).toBe(false);
    for (const id of ['withdrawal', 'foreign']) {
      const cancel = {
        actorId: scope.partnerId,
        method: 'POST',
        path: `/partners/me/withdrawals/${id}/cancel`,
        body: { expectedVersion: 1 },
      };
      expect(allowed(scope, cancel)).toBe(id === 'withdrawal');
    }
  });
  it('binds review and paid evidence to the owned withdrawal and proof', () => {
    const request = {
      actorId: scope.adminId,
      method: 'POST',
      path: '/management/partner-withdrawals/withdrawal/approve',
      body: { expectedVersion: 1 },
    };
    expect(allowed(scope, request)).toBe(true);
    for (const actorId of ['other', scope.partnerId])
      expect(allowed(scope, { ...request, actorId })).toBe(false);
    for (const action of ['reject', 'mark-failed', 'mark-unknown', 'delete'])
      expect(
        allowed(scope, {
          ...request,
          path: request.path.replace('approve', action),
        }),
      ).toBe(false);
    expect(
      allowed(scope, {
        ...request,
        path: request.path.replace('/withdrawal/', '/foreign/'),
      }),
    ).toBe(false);
    const proof = {
      ...request,
      path: request.path.replace('approve', 'mock-proof'),
      body: {
        expectedVersion: 3,
        evidenceOutcome: 'PAID',
        reason: configuration.reason,
      },
    };
    expect(allowed(scope, proof)).toBe(true);
    expect(
      allowed(scope, {
        ...proof,
        body: { ...proof.body, evidenceOutcome: 'UNPAID' },
      }),
    ).toBe(false);
    const paid = {
      ...request,
      path: request.path.replace('approve', 'mark-paid'),
      body: {
        expectedVersion: 4,
        amountFen: 80000,
        accountVersion: 1,
        proofFileId: 'proof',
        payoutReference: 'SIM-owned-run',
        paidAt: new Date().toISOString(),
      },
    };
    expect(allowed(scope, paid)).toBe(true);
    expect(
      allowed(scope, {
        ...paid,
        body: { ...paid.body, proofFileId: 'foreign' },
      }),
    ).toBe(false);
    expect(
      allowed(scope, { ...paid, body: { ...paid.body, paidAt: 'invalid' } }),
    ).toBe(false);
  });
  it('restricts reads and proof downloads to the declared actor, campus and IDs', () => {
    const request = {
      actorId: scope.partnerId,
      method: 'GET',
      path: '/partners/me/withdrawals/withdrawal/proof',
    };
    expect(allowed(scope, request)).toBe(true);
    expect(
      allowed(scope, {
        ...request,
        path: request.path.replace('/withdrawal/', '/foreign/'),
      }),
    ).toBe(false);
    expect(allowed(scope, { ...request, method: 'DELETE' })).toBe(false);
    const list = {
      actorId: scope.adminId,
      method: 'GET',
      path: '/management/partner-withdrawals',
    };
    expect(
      allowed(scope, {
        ...list,
        query: { campusId: scope.campusId, page: '1', pageSize: '20' },
      }),
    ).toBe(true);
    expect(allowed(scope, list)).toBe(false);
    expect(allowed(scope, { ...list, query: { campusId: 'other' } })).toBe(
      false,
    );
    for (const path of [
      '/management/staff-accounts',
      '/partners/me/students',
      '/auth/refresh',
    ])
      expect(allowed(scope, { ...request, path })).toBe(false);
  });
});
