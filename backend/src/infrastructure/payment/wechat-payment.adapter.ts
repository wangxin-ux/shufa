import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  randomBytes,
  sign,
  verify,
  X509Certificate,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type {
  PaymentAdapter,
  PaymentInvocation,
  VerifiedPaymentEvent,
} from './payment.adapter';

const API_ORIGIN = 'https://api.mch.weixin.qq.com';
const PREPAY_PATH = '/v3/pay/transactions/jsapi';
const SIGNATURE_TYPE = 'WECHATPAY2-SHA256-RSA2048';
const MAX_BODY_BYTES = 256 * 1024;

interface MerchantCredentials {
  appId: string;
  mchId: string;
  serial: string;
  privateKey: KeyObject;
  verificationKey: KeyObject;
  verificationId: string;
  platformCertificate?: X509Certificate;
  apiV3Key: Buffer;
  notifyUrl: string;
}

@Injectable()
export class WechatPaymentAdapter implements PaymentAdapter {
  readonly mode = 'WECHAT' as const;
  private credentials?: MerchantCredentials;

  constructor(@Optional() private readonly config?: ConfigService) {}

  async createJsapiPayment(input: {
    outTradeNo: string;
    amountFen: number;
    description: string;
    payerOpenId: string;
    expiresAt?: Date;
  }): Promise<PaymentInvocation> {
    const credentials = this.requireCredentials();
    try {
      if (
        !/^[a-zA-Z0-9_\-|*]{6,32}$/.test(input.outTradeNo) ||
        !Number.isSafeInteger(input.amountFen) ||
        input.amountFen <= 0 ||
        input.amountFen > 2_147_483_647 ||
        !nonemptyString(input.description, 127) ||
        !nonemptyString(input.payerOpenId, 128) ||
        (input.expiresAt !== undefined &&
          (!Number.isFinite(input.expiresAt.getTime()) ||
            input.expiresAt.getTime() <= Date.now() + 60_000))
      ) {
        this.unavailable();
      }
      const payload = {
        appid: credentials.appId,
        mchid: credentials.mchId,
        description: input.description,
        out_trade_no: input.outTradeNo,
        notify_url: credentials.notifyUrl,
        ...(input.expiresAt
          ? { time_expire: input.expiresAt.toISOString() }
          : {}),
        amount: { total: input.amountFen, currency: 'CNY' },
        payer: { openid: input.payerOpenId },
      };
      const body = JSON.stringify(payload);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = randomBytes(16).toString('hex');
      const signature = sign(
        'RSA-SHA256',
        Buffer.from(`POST\n${PREPAY_PATH}\n${timestamp}\n${nonce}\n${body}\n`),
        credentials.privateKey,
      ).toString('base64');
      // Do not resend a financial request after an ambiguous transport failure.
      const response = await fetch(`${API_ORIGIN}${PREPAY_PATH}`, {
        method: 'POST',
        headers: {
          Authorization: `${SIGNATURE_TYPE} mchid="${credentials.mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${credentials.serial}",signature="${signature}"`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Wechatpay-Serial': credentials.verificationId,
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) this.unavailable();
      const raw = Buffer.from(await response.arrayBuffer());
      this.verifySignedBody(
        Object.fromEntries(response.headers.entries()),
        raw,
        credentials,
      );
      const result = parseObject(raw);
      if (
        !nonemptyString(result.prepay_id, 64) ||
        !/^[a-zA-Z0-9_-]+$/.test(result.prepay_id)
      ) {
        this.unavailable();
      }
      const timeStamp = String(Math.floor(Date.now() / 1000));
      const nonceStr = randomBytes(16).toString('hex');
      const packageValue = `prepay_id=${result.prepay_id}`;
      const paySign = sign(
        'RSA-SHA256',
        Buffer.from(
          `${credentials.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`,
        ),
        credentials.privateKey,
      ).toString('base64');
      return {
        mode: this.mode,
        outTradeNo: input.outTradeNo,
        timeStamp,
        nonceStr,
        package: packageValue,
        signType: 'RSA',
        paySign,
      };
    } catch {
      this.unavailable();
    }
  }

  async verifyNotification(
    headers: Record<string, string>,
    rawBody: Buffer,
  ): Promise<VerifiedPaymentEvent> {
    const credentials = this.requireCredentials();
    try {
      this.verifySignedBody(headers, rawBody, credentials);
      const envelope = parseObject(rawBody);
      const resource = record(envelope.resource);
      if (
        !nonemptyString(envelope.id, 64) ||
        envelope.event_type !== 'TRANSACTION.SUCCESS' ||
        envelope.resource_type !== 'encrypt-resource' ||
        resource.original_type !== 'transaction' ||
        resource.algorithm !== 'AEAD_AES_256_GCM' ||
        !nonemptyString(resource.nonce, 16) ||
        Buffer.byteLength(resource.nonce) !== 12 ||
        (resource.associated_data !== undefined &&
          (typeof resource.associated_data !== 'string' ||
            Buffer.byteLength(resource.associated_data) > 16))
      )
        throw new Error('Invalid resource');
      const ciphertext = decodeBase64(resource.ciphertext);
      if (ciphertext.length <= 16) throw new Error('Invalid ciphertext');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        credentials.apiV3Key,
        Buffer.from(resource.nonce),
      );
      decipher.setAuthTag(ciphertext.subarray(-16));
      decipher.setAAD(
        Buffer.from((resource.associated_data as string | undefined) ?? ''),
      );
      const transaction = parseObject(
        Buffer.concat([
          decipher.update(ciphertext.subarray(0, -16)),
          decipher.final(),
        ]),
      );
      const amount = record(transaction.amount);
      if (
        transaction.appid !== credentials.appId ||
        transaction.mchid !== credentials.mchId ||
        transaction.trade_type !== 'JSAPI' ||
        transaction.trade_state !== 'SUCCESS' ||
        !nonemptyString(transaction.out_trade_no, 32) ||
        !/^[a-zA-Z0-9_\-|*]{6,32}$/.test(transaction.out_trade_no) ||
        !nonemptyString(transaction.transaction_id, 32) ||
        !Number.isSafeInteger(amount.total) ||
        (amount.total as number) <= 0 ||
        (amount.total as number) > 2_147_483_647 ||
        amount.currency !== 'CNY'
      )
        throw new Error('Invalid transaction');
      return {
        provider: this.mode,
        outTradeNo: transaction.out_trade_no,
        providerTradeNo: transaction.transaction_id,
        amountFen: amount.total as number,
        status: 'SUCCEEDED',
        rawNotification: {
          id: envelope.id,
          event_type: envelope.event_type,
          appid: transaction.appid,
          mchid: transaction.mchid,
          out_trade_no: transaction.out_trade_no,
          transaction_id: transaction.transaction_id,
          trade_state: transaction.trade_state,
          amount: { total: amount.total, currency: amount.currency },
        },
      };
    } catch {
      throw new DomainError(
        ErrorCode.PAYMENT_NOTIFICATION_INVALID,
        'WeChat payment notification verification failed',
        400,
      );
    }
  }

  async requestRefund(_input: {
    outTradeNo: string;
    outRefundNo: string;
    amountFen: number;
    totalFen: number;
    reason: string;
  }): Promise<{
    providerRefundNo: string;
    status: 'PROCESSING' | 'SUCCEEDED';
  }> {
    // The business service has no asynchronous refund reconciliation yet.
    this.unavailable();
  }

  private requireCredentials(): MerchantCredentials {
    if (this.credentials) return this.credentials;
    try {
      if (this.config?.get<string>('PAYMENT_DRIVER') !== 'wechat')
        this.unavailable();
      const appId = this.required('WECHAT_APP_ID');
      const mchId = this.required('WECHAT_MCH_ID');
      const serial = this.required('WECHAT_PAY_CERT_SERIAL_NO');
      const apiV3Key = Buffer.from(this.credential('WECHAT_PAY_API_V3_KEY'));
      const notifyUrl = this.required('WECHAT_PAY_NOTIFY_URL');
      const url = new URL(notifyUrl);
      if (
        !/^[a-zA-Z0-9_-]{1,32}$/.test(appId) ||
        !/^\d{1,32}$/.test(mchId) ||
        !/^[a-fA-F0-9]{1,64}$/.test(serial) ||
        apiV3Key.length !== 32 ||
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.hash ||
        url.search
      )
        this.unavailable();
      const privateKey = createPrivateKey(
        this.credential('WECHAT_PAY_PRIVATE_KEY'),
      );
      const verificationId = this.config
        ?.get<string>('WECHAT_PAY_PUBLIC_KEY_ID')
        ?.trim();
      let verificationKey: KeyObject;
      let platformCertificate: X509Certificate | undefined;
      let resolvedId: string;
      if (verificationId) {
        if (
          !/^PUB_KEY_ID_\d+$/.test(verificationId) ||
          this.config?.get<string>('WECHAT_PAY_PLATFORM_CERT')?.trim()
        )
          this.unavailable();
        verificationKey = createPublicKey(
          this.credential('WECHAT_PAY_PUBLIC_KEY'),
        );
        resolvedId = verificationId;
      } else {
        if (
          this.config?.get<string>('WECHAT_PAY_PUBLIC_KEY')?.trim() ||
          this.config?.get<string>('WECHAT_PAY_PUBLIC_KEY_FILE')?.trim()
        )
          this.unavailable();
        platformCertificate = new X509Certificate(
          this.required('WECHAT_PAY_PLATFORM_CERT'),
        );
        verificationKey = platformCertificate.publicKey;
        resolvedId = platformCertificate.serialNumber;
      }
      for (const key of [privateKey, verificationKey]) {
        if (
          key.asymmetricKeyType !== 'rsa' ||
          key.asymmetricKeyDetails?.modulusLength !== 2048
        ) {
          this.unavailable();
        }
      }
      this.credentials = {
        appId,
        mchId,
        serial,
        privateKey,
        verificationKey,
        verificationId: resolvedId,
        platformCertificate,
        apiV3Key,
        notifyUrl,
      };
      return this.credentials;
    } catch {
      this.unavailable();
    }
  }

  private required(key: string): string {
    const value = this.config?.get<unknown>(key);
    if (typeof value !== 'string' || !value.trim()) this.unavailable();
    return value.trim();
  }

  private credential(key: string): string {
    const value = this.config?.get<string>(key)?.trim();
    const path = this.config?.get<string>(`${key}_FILE`)?.trim();
    if (Boolean(value) === Boolean(path)) this.unavailable();
    return value || readFileSync(path!, 'utf8').trim();
  }

  private verifySignedBody(
    headers: Record<string, string>,
    raw: Buffer,
    credentials: MerchantCredentials,
  ): void {
    const normalized = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const timestamp = normalized['wechatpay-timestamp'];
    const nonce = normalized['wechatpay-nonce'];
    if (
      raw.length === 0 ||
      raw.length > MAX_BODY_BYTES ||
      !/^\d{1,12}$/.test(timestamp ?? '') ||
      Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300 ||
      !/^[\x21-\x7e]{1,128}$/.test(nonce ?? '') ||
      normalized['wechatpay-serial'] !== credentials.verificationId ||
      (normalized['wechatpay-signature-type'] !== undefined &&
        normalized['wechatpay-signature-type'] !== SIGNATURE_TYPE)
    )
      throw new Error('Invalid signature metadata');
    const certificate = credentials.platformCertificate;
    if (
      certificate &&
      (Date.now() < Date.parse(certificate.validFrom) ||
        Date.now() > Date.parse(certificate.validTo))
    ) {
      throw new Error('Expired verification certificate');
    }
    const signature = decodeBase64(normalized['wechatpay-signature']);
    if (
      !verify(
        'RSA-SHA256',
        Buffer.concat([
          Buffer.from(`${timestamp}\n${nonce}\n`),
          raw,
          Buffer.from('\n'),
        ]),
        credentials.verificationKey,
        signature,
      )
    )
      throw new Error('Invalid signature');
  }

  private unavailable(): never {
    throw new DomainError(
      ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
      'WeChat Pay is not connected to verified merchant credentials',
      503,
    );
  }
}

function nonemptyString(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    [...value].length <= max &&
    !/[\r\n\0]/.test(value)
  );
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected object');
  }
  return value as Record<string, unknown>;
}

function parseObject(raw: Buffer): Record<string, unknown> {
  return record(JSON.parse(raw.toString('utf8')));
}

function decodeBase64(value: unknown): Buffer {
  if (
    typeof value !== 'string' ||
    !/^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(
      value,
    ) ||
    !value
  ) {
    throw new Error('Invalid base64');
  }
  return Buffer.from(value, 'base64');
}
