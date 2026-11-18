import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { WechatPaymentAdapter } from './wechat-payment.adapter';
import { ConfigService } from '@nestjs/config';
import fs from 'node:fs';
import { createCipheriv, generateKeyPairSync, sign, verify } from 'node:crypto';

const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 });
const platform = generateKeyPairSync('rsa', { modulusLength: 2048 });
const apiKey = '0123456789abcdef0123456789abcdef';
const keyId = 'PUB_KEY_ID_123456789';
const environment = () => ({
  PAYMENT_DRIVER: 'wechat',
  WECHAT_APP_ID: 'wx-test-payment',
  WECHAT_MCH_ID: '1900000001',
  WECHAT_PAY_API_V3_KEY: apiKey,
  WECHAT_PAY_CERT_SERIAL_NO: '123456ABCDEF',
  WECHAT_PAY_PRIVATE_KEY: merchant.privateKey
    .export({
      type: 'pkcs8',
      format: 'pem',
    })
    .toString(),
  WECHAT_PAY_PUBLIC_KEY: platform.publicKey
    .export({
      type: 'spki',
      format: 'pem',
    })
    .toString(),
  WECHAT_PAY_PUBLIC_KEY_ID: keyId,
  WECHAT_PAY_NOTIFY_URL: 'https://example.test/payments/wechat/notifications',
});
const prepay = () => ({
  outTradeNo: 'GPAY-001',
  amountFen: 1990,
  description: 'Synthetic course',
  payerOpenId: 'test-payer-openid',
});

function signatureHeaders(
  body: Buffer | string,
  timestamp = String(Math.floor(Date.now() / 1000)),
) {
  const nonce = 'synthetic-response-nonce';
  const signature = sign(
    'RSA-SHA256',
    Buffer.concat([
      Buffer.from(`${timestamp}\n${nonce}\n`),
      Buffer.from(body),
      Buffer.from('\n'),
    ]),
    platform.privateKey,
  ).toString('base64');
  return {
    'wechatpay-timestamp': timestamp,
    'wechatpay-nonce': nonce,
    'wechatpay-serial': keyId,
    'wechatpay-signature': signature,
  };
}

function signedResponse(
  payload: unknown,
  overrides: Record<string, string> = {},
) {
  const body = JSON.stringify(payload);
  return new Response(body, {
    status: 200,
    headers: {
      ...signatureHeaders(body),
      ...overrides,
    },
  });
}

function notification(
  transactionOverrides: Record<string, unknown> = {},
  resourceOverrides: Record<string, unknown> = {},
) {
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(apiKey),
    Buffer.from('testnonce123'),
  );
  cipher.setAAD(Buffer.from('transaction'));
  const ciphertext = Buffer.concat([
    cipher.update(
      JSON.stringify({
        appid: 'wx-test-payment',
        mchid: '1900000001',
        out_trade_no: 'GPAY-001',
        transaction_id: 'WX-001',
        trade_type: 'JSAPI',
        trade_state: 'SUCCESS',
        amount: { total: 1990, currency: 'CNY' },
        ...transactionOverrides,
      }),
    ),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
  const raw = Buffer.from(
    JSON.stringify({
      id: 'test-notification',
      event_type: 'TRANSACTION.SUCCESS',
      resource_type: 'encrypt-resource',
      resource: {
        original_type: 'transaction',
        algorithm: 'AEAD_AES_256_GCM',
        nonce: 'testnonce123',
        associated_data: 'transaction',
        ciphertext,
        ...resourceOverrides,
      },
    }),
  );
  return { raw, headers: signatureHeaders(raw) };
}

describe('WechatPaymentAdapter', () => {
  afterEach(() => jest.restoreAllMocks());
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

  it('signs the exact prepay request and the mini-program invocation', async () => {
    const transport = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(signedResponse({ prepay_id: 'wx-prepay-001' }));
    const adapter = new WechatPaymentAdapter(new ConfigService(environment()));
    const invocation = await adapter.createJsapiPayment(prepay());
    const [url, request] = transport.mock.calls[0];
    expect(url).toBe('https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi');
    const headers = new Headers(request?.headers);
    expect(headers.get('Wechatpay-Serial')).toBe(keyId);
    const auth = headers.get('Authorization')!;
    const authField = (name: string) =>
      new RegExp(`${name}="([^"]+)"`).exec(auth)![1];
    expect(auth).toMatch(/^WECHATPAY2-SHA256-RSA2048 /);
    expect(authField('mchid')).toBe('1900000001');
    expect(authField('serial_no')).toBe('123456ABCDEF');
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(
          `POST\n/v3/pay/transactions/jsapi\n${authField('timestamp')}\n${authField('nonce_str')}\n${String(request?.body)}\n`,
        ),
        merchant.publicKey,
        Buffer.from(authField('signature'), 'base64'),
      ),
    ).toBe(true);
    expect(JSON.parse(String(request?.body))).toMatchObject({
      appid: 'wx-test-payment',
      mchid: '1900000001',
      out_trade_no: 'GPAY-001',
      amount: { total: 1990, currency: 'CNY' },
      payer: { openid: 'test-payer-openid' },
      notify_url: 'https://example.test/payments/wechat/notifications',
    });
    if (invocation.mode !== 'WECHAT')
      throw new Error('Expected WeChat invocation');
    expect(invocation.package).toBe('prepay_id=wx-prepay-001');
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(
          `wx-test-payment\n${invocation.timeStamp}\n${invocation.nonceStr}\n${invocation.package}\n`,
        ),
        merchant.publicKey,
        Buffer.from(invocation.paySign, 'base64'),
      ),
    ).toBe(true);
    expect(request?.redirect).toBe('error');
    expect(request?.signal).toBeDefined();
  });

  it('verifies and decrypts a successful notification without persisting payer identity', async () => {
    const adapter = new WechatPaymentAdapter(new ConfigService(environment()));
    const event = notification({ payer: { openid: 'private-payer' } });
    await expect(
      adapter.verifyNotification(event.headers, event.raw),
    ).resolves.toMatchObject({
      provider: 'WECHAT',
      outTradeNo: 'GPAY-001',
      providerTradeNo: 'WX-001',
      amountFen: 1990,
      status: 'SUCCEEDED',
    });
    const verified = await adapter.verifyNotification(event.headers, event.raw);
    expect(JSON.stringify(verified.rawNotification)).not.toContain(
      'private-payer',
    );
  });

  it.each([
    ['missing signature', { 'wechatpay-signature': '' }],
    ['wrong key ID', { 'wechatpay-serial': 'PUB_KEY_ID_OTHER' }],
    ['probe signature', { 'wechatpay-signature': 'WECHATPAY/SIGNTEST/fake' }],
    ['stale timestamp', { 'wechatpay-timestamp': '1' }],
    ['unsupported signature type', { 'wechatpay-signature-type': 'HMAC' }],
  ])('rejects a notification with %s', async (_name, overrides) => {
    const adapter = new WechatPaymentAdapter(new ConfigService(environment()));
    const event = notification();
    await expect(
      adapter.verifyNotification({ ...event.headers, ...overrides }, event.raw),
    ).rejects.toMatchObject({
      code: ErrorCode.PAYMENT_NOTIFICATION_INVALID,
      statusCode: 400,
    });
  });

  it('rejects tampering of the raw notification body', async () => {
    const adapter = new WechatPaymentAdapter(new ConfigService(environment()));
    const event = notification();
    await expect(
      adapter.verifyNotification(
        event.headers,
        Buffer.concat([event.raw, Buffer.from(' ')]),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PAYMENT_NOTIFICATION_INVALID });
  });

  it.each([
    { appid: 'another-app' },
    { mchid: 'another-merchant' },
    { trade_state: 'NOTPAY' },
    { trade_type: 'NATIVE' },
    { amount: { total: 1.5, currency: 'CNY' } },
    { amount: { total: 1990, currency: 'USD' } },
    { out_trade_no: '' },
    { transaction_id: '' },
  ])('rejects inconsistent decrypted transaction %j', async (overrides) => {
    const adapter = new WechatPaymentAdapter(new ConfigService(environment()));
    const event = notification(overrides);
    await expect(
      adapter.verifyNotification(event.headers, event.raw),
    ).rejects.toMatchObject({ code: ErrorCode.PAYMENT_NOTIFICATION_INVALID });
  });

  it.each([
    { algorithm: 'AES-CBC' },
    { ciphertext: 'invalid' },
    { associated_data: 'wrong-aad' },
    { nonce: 'wrong-nonce' },
    { original_type: 'refund' },
  ])('rejects invalid encrypted resource %j', async (overrides) => {
    const adapter = new WechatPaymentAdapter(new ConfigService(environment()));
    const event = notification({}, overrides);
    await expect(
      adapter.verifyNotification(event.headers, event.raw),
    ).rejects.toMatchObject({ code: ErrorCode.PAYMENT_NOTIFICATION_INVALID });
  });

  it.each<Record<string, string>>([
    { 'wechatpay-serial': 'PUB_KEY_ID_OTHER' },
    { 'wechatpay-signature': 'WECHATPAY/SIGNTEST/probe' },
    { 'wechatpay-timestamp': '1' },
  ])('discards unverified provider responses %j', async (headers) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(signedResponse({ prepay_id: 'wx-001' }, headers));
    const adapter = new WechatPaymentAdapter(new ConfigService(environment()));
    await expect(adapter.createJsapiPayment(prepay())).rejects.toMatchObject({
      code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
      statusCode: 503,
    });
  });

  it.each([{ prepay_id: '' }, {}, { prepay_id: 'bad\npackage' }])(
    'rejects malformed signed response %j',
    async (payload) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(signedResponse(payload));
      const adapter = new WechatPaymentAdapter(
        new ConfigService(environment()),
      );
      await expect(adapter.createJsapiPayment(prepay())).rejects.toMatchObject({
        code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
      });
    },
  );

  it('redacts transport errors and never automatically resends a financial request', async () => {
    const transport = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('secret-key provider body'));
    const adapter = new WechatPaymentAdapter(new ConfigService(environment()));
    await expect(adapter.createJsapiPayment(prepay())).rejects.toMatchObject({
      code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
      statusCode: 503,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects incomplete credentials before any request', async () => {
    const transport = jest.spyOn(globalThis, 'fetch');
    const adapter = new WechatPaymentAdapter(
      new ConfigService({ ...environment(), WECHAT_PAY_PUBLIC_KEY: '' }),
    );
    await expect(adapter.createJsapiPayment(prepay())).rejects.toMatchObject({
      code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('loads the private key, verification key and APIv3 key from server-only files', async () => {
    const synthetic = environment();
    const fileValues = new Map<string, string>([
      ['/synthetic/merchant.pem', synthetic.WECHAT_PAY_PRIVATE_KEY],
      ['/synthetic/public.pem', synthetic.WECHAT_PAY_PUBLIC_KEY],
      ['/synthetic/apiv3.txt', synthetic.WECHAT_PAY_API_V3_KEY],
    ]);
    const originalRead = fs.readFileSync;
    const read = jest
      .spyOn(fs, 'readFileSync')
      .mockImplementation((path, options) => {
        const value = fileValues.get(String(path));
        return value === undefined ? originalRead(path, options) : value;
      });
    const transport = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(signedResponse({ prepay_id: 'wx-001' }));
    const adapter = new WechatPaymentAdapter(
      new ConfigService({
        ...synthetic,
        WECHAT_PAY_PRIVATE_KEY: '',
        WECHAT_PAY_PRIVATE_KEY_FILE: '/synthetic/merchant.pem',
        WECHAT_PAY_PUBLIC_KEY: '',
        WECHAT_PAY_PUBLIC_KEY_FILE: '/synthetic/public.pem',
        WECHAT_PAY_API_V3_KEY: '',
        WECHAT_PAY_API_V3_KEY_FILE: '/synthetic/apiv3.txt',
      }),
    );
    await expect(adapter.createJsapiPayment(prepay())).resolves.toMatchObject({
      mode: 'WECHAT',
    });
    expect(read).toHaveBeenCalledWith('/synthetic/merchant.pem', 'utf8');
    expect(read).toHaveBeenCalledWith('/synthetic/public.pem', 'utf8');
    expect(read).toHaveBeenCalledWith('/synthetic/apiv3.txt', 'utf8');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('never reads credential files or sends requests while the driver is mock', async () => {
    const read = jest.spyOn(fs, 'readFileSync');
    const transport = jest.spyOn(globalThis, 'fetch');
    const adapter = new WechatPaymentAdapter(
      new ConfigService({
        ...environment(),
        PAYMENT_DRIVER: 'mock',
        WECHAT_PAY_PRIVATE_KEY_FILE: '/synthetic/do-not-read.pem',
      }),
    );
    await expect(adapter.createJsapiPayment(prepay())).rejects.toMatchObject({
      code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
    });
    expect(read).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it('discards signed success bodies with mismatched raw bytes', async () => {
    const raw = JSON.stringify({ prepay_id: 'wx-001' });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(`${raw} `, {
        status: 200,
        headers: signatureHeaders(raw),
      }),
    );
    const adapter = new WechatPaymentAdapter(new ConfigService(environment()));
    await expect(adapter.createJsapiPayment(prepay())).rejects.toMatchObject({
      code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
    });
  });

  it('does not expose unsuccessful provider response bodies', async () => {
    const transport = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('provider-private-diagnostics', { status: 401 }),
      );
    const adapter = new WechatPaymentAdapter(new ConfigService(environment()));
    await expect(adapter.createJsapiPayment(prepay())).rejects.toThrow(
      'WeChat Pay is not connected to verified merchant credentials',
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    { amountFen: 1.5 },
    { amountFen: 0 },
    { outTradeNo: 'x'.repeat(33) },
    { payerOpenId: '' },
    { description: 'x'.repeat(128) },
    { expiresAt: new Date(Date.now() + 30_000) },
  ])('rejects invalid prepay fields before transport %j', async (overrides) => {
    const transport = jest.spyOn(globalThis, 'fetch');
    const adapter = new WechatPaymentAdapter(new ConfigService(environment()));
    await expect(
      adapter.createJsapiPayment({ ...prepay(), ...overrides }),
    ).rejects.toMatchObject({ code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE });
    expect(transport).not.toHaveBeenCalled();
  });

  it('uses the existing reservation expiry as the provider payment deadline', async () => {
    const transport = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(signedResponse({ prepay_id: 'wx-prepay-001' }));
    const adapter = new WechatPaymentAdapter(new ConfigService(environment()));
    const expiresAt = new Date(Date.now() + 20 * 60_000);
    await adapter.createJsapiPayment({ ...prepay(), expiresAt });
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toMatchObject({
      time_expire: expiresAt.toISOString(),
    });
  });

  it('keeps real refunds closed until their asynchronous business flow is implemented', async () => {
    const transport = jest.spyOn(globalThis, 'fetch');
    const adapter = new WechatPaymentAdapter(new ConfigService(environment()));
    await expect(
      adapter.requestRefund({
        outTradeNo: 'GPAY-001',
        outRefundNo: 'GREF-001',
        amountFen: 1990,
        totalFen: 1990,
        reason: 'Synthetic refund',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE });
    expect(transport).not.toHaveBeenCalled();
  });
});
