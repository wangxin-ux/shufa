export interface WithdrawalNativeScope {
  adminId: string;
  partnerId: string;
  campusId: string;
  earningId: string;
  runTag: string;
  adminLogin: string;
  partnerLogin: string;
  withdrawals: Map<string, string | null>;
}

export interface WithdrawalNativeRequest {
  method: string;
  path: string;
  actorId?: string;
  body?: unknown;
  query?: Record<string, unknown>;
}

export function allowWithdrawalNativeRequest(
  scope: WithdrawalNativeScope,
  { method, path, actorId, body, query = {} }: WithdrawalNativeRequest,
): boolean {
  if (!scope.campusId || !scope.adminId || !scope.partnerId || !scope.earningId)
    return false;
  const exact = (expected: Record<string, unknown>) =>
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    Object.keys(body).length === Object.keys(expected).length &&
    Object.entries(expected).every(
      ([key, value]) => (body as Record<string, unknown>)[key] === value,
    );
  if (method === 'POST' && path === '/auth/login')
    return (
      Boolean(scope.adminLogin && exact({ code: scope.adminLogin })) ||
      Boolean(scope.partnerLogin && exact({ code: scope.partnerLogin }))
    );
  const data = body as Record<string, unknown> | undefined;
  const version =
    Number.isSafeInteger(data?.expectedVersion) &&
    Number(data?.expectedVersion) > 0;
  const reason = '原生联调合成结算确认';
  const root = `/management/campuses/${scope.campusId}/partner-settlement`;
  if (actorId === scope.adminId) {
    if (method === 'GET') {
      if (path === '/management/campuses')
        return (
          Object.keys(query).every((k) =>
            ['page', 'pageSize', 'query'].includes(k),
          ) &&
          (query.query === undefined ||
            query.query === '' ||
            query.query === scope.runTag)
        );
      if ([root, `${root}/sources`].includes(path)) return true;
      if (path === '/management/partner-withdrawals')
        return query.campusId === scope.campusId;
    }
    if (method === 'PUT' && path === root)
      return exact({
        expectedVersion: 0,
        payerName: '模拟付款机构',
        beneficiaryName: '模拟合作机构',
        accountLastFour: '1234',
        minimumAmountFen: 10000,
        dailyRequestLimit: 2,
        reason,
      });
    if (method === 'POST' && path === `${root}/sources/${scope.earningId}`)
      return exact({
        expectedVersion: 1,
        expectedProfileVersion: 1,
        reason,
      });
    for (const [id, proofFileId] of scope.withdrawals) {
      const prefix = `/management/partner-withdrawals/${id}/`;
      if (method !== 'POST' || !path.startsWith(prefix) || !version) continue;
      const action = path.slice(prefix.length);
      const expectedVersion = data!.expectedVersion;
      if (['approve', 'mark-paying'].includes(action))
        return exact({ expectedVersion });
      if (action === 'mock-proof')
        return exact({ expectedVersion, evidenceOutcome: 'PAID', reason });
      if (action === 'mark-paid')
        return Boolean(
          proofFileId &&
          typeof data!.paidAt === 'string' &&
          Number.isFinite(Date.parse(data!.paidAt)) &&
          exact({
            expectedVersion,
            amountFen: 80000,
            accountVersion: 1,
            proofFileId,
            payoutReference: `SIM-${scope.runTag}`,
            paidAt: data!.paidAt,
          }),
        );
    }
  }
  if (actorId === scope.partnerId) {
    if (
      method === 'GET' &&
      [
        '/me',
        '/partners/me/profile',
        '/partners/me/withdrawal-summary',
        '/partners/me/withdrawals',
      ].includes(path)
    )
      return true;
    if (method === 'POST' && path === '/partners/me/withdrawals')
      return exact({ amountFen: 80000, expectedProfileVersion: 1 });
    for (const id of scope.withdrawals.keys()) {
      if (method === 'GET' && path === `/partners/me/withdrawals/${id}/proof`)
        return true;
      if (method === 'POST' && path === `/partners/me/withdrawals/${id}/cancel`)
        return Boolean(
          version && exact({ expectedVersion: data!.expectedVersion }),
        );
    }
  }
  return false;
}
