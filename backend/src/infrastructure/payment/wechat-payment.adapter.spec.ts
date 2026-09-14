import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { WechatPaymentAdapter } from './wechat-payment.adapter';

describe('WechatPaymentAdapter', () => {
  it('fails closed until real merchant signing and notification verification are integrated', async () => {
    const adapter = new WechatPaymentAdapter();

    await expect(
      adapter.createJsapiPayment({
        outTradeNo: 'GROUP-PAY-001',
        amountFen: 1990,
        description: '19.9 元创意美术拼团课',
        payerOpenId: 'openid',
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({
      code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
      statusCode: 503,
    });
  });
});
