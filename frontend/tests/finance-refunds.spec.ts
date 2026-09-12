import { refundActions, refundActionGroups, RefundApi } from '../services/finance-refunds.service';

describe('finance refund client boundaries', () => {
  it('keeps routine commands visible and moves finance exceptions into the secondary menu', () => {
    expect(refundActionGroups('FINANCE', 'APPROVED')).toMatchObject({
      primaryActions: [{ code: 'START_PAYMENT' }],
      secondaryActions: [{ code: 'REQUEST_CANCELLATION' }],
    });
    expect(refundActionGroups('FINANCE', 'PAYING')).toMatchObject({
      primaryActions: [{ code: 'RECORD_PAYMENT' }],
      secondaryActions: [{ code: 'MARK_UNCERTAIN' }],
    });
    expect(refundActionGroups('SUPER_ADMIN', 'SUBMITTED').primaryActions.map((a) => a.code)).toEqual(['APPROVE', 'REJECT']);
    expect(refundActionGroups('FINANCE', 'PAID')).toEqual({
      actions: [], primaryActions: [], secondaryActions: [],
    });
  });
  it('keeps review commands out of finance and payment commands out of headquarters review', () => {
    expect(refundActions('FINANCE', 'SUBMITTED').map((a) => a.code)).toEqual(['WITHDRAW']);
    expect(refundActions('SUPER_ADMIN', 'SUBMITTED').map((a) => a.code)).toEqual(['APPROVE', 'REJECT']);
    expect(refundActions('FINANCE', 'PAYING').map((a) => a.code)).toEqual(['RECORD_PAYMENT', 'MARK_UNCERTAIN']);
    expect(refundActions('SUPER_ADMIN', 'PAYING')).toEqual([]);
    expect(refundActions('FINANCE', 'PAID')).toEqual([]);
  });
  it('routes approval and payment to separately authorized endpoints, preserving keys', async () => {
    const calls: Array<{ url: string; header: Record<string, string>; data?: unknown }> = [];
    const api = new RefundApi('https://example.test', () => 'test-token', 'SUPER_ADMIN', (options) => {
      calls.push(options);
      options.success({ statusCode: 200, data: { data: { id: 'r1', status: 'APPROVED' } } });
    });
    await api.act('r1', { action: 'APPROVE', expectedVersion: 1, reason: '审核通过' }, 'refund-action-key');
    expect(calls[0]).toMatchObject({
      url: 'https://example.test/management/finance-refunds/r1/actions',
      header: { Authorization: 'Bearer test-token', 'Idempotency-Key': 'refund-action-key' },
    });
  });
});
