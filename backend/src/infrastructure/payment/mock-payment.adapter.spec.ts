import { DomainError } from '../../common/errors/domain-error';
import { MockPaymentAdapter } from './mock-payment.adapter';

describe('MockPaymentAdapter', () => {
  const adapter = new MockPaymentAdapter();

  it('creates a local payment invocation without WeChat credentials', async () => {
    await expect(
      adapter.createJsapiPayment({
        outTradeNo: 'GROUP-PAY-001',
        amountFen: 1990,
        description: '19.9 元创意美术拼团课',
        payerOpenId: 'mock-parent-openid',
      }),
    ).resolves.toEqual({ mode: 'MOCK', outTradeNo: 'GROUP-PAY-001' });
  });

  it('verifies an explicit local success notification', async () => {
    const event = await adapter.verifyNotification(
      {},
      Buffer.from(
        JSON.stringify({
          outTradeNo: 'GROUP-PAY-001',
          providerTradeNo: 'MOCK-TRADE-001',
          amountFen: 1990,
          status: 'SUCCEEDED',
        }),
      ),
    );

    expect(event).toMatchObject({
      provider: 'MOCK',
      outTradeNo: 'GROUP-PAY-001',
      providerTradeNo: 'MOCK-TRADE-001',
      amountFen: 1990,
      status: 'SUCCEEDED',
    });
  });

  it('rejects malformed local notifications', async () => {
    await expect(
      adapter.verifyNotification({}, Buffer.from('{"amountFen":1990}')),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('returns a deterministic successful local refund', async () => {
    await expect(
      adapter.requestRefund({
        outTradeNo: 'GROUP-PAY-001',
        outRefundNo: 'GROUP-REFUND-001',
        amountFen: 1990,
        totalFen: 1990,
        reason: '活动取消',
      }),
    ).resolves.toEqual({
      providerRefundNo: 'MOCK-GROUP-REFUND-001',
      status: 'SUCCEEDED',
    });
  });
});
