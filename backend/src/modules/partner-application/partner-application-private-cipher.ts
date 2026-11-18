import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';

export const PARTNER_APPLICATION_PRIVATE_KEY_RING =
  'PARTNER_APPLICATION_PRIVATE_KEY_RING';
export interface PartnerApplicationPrivateKeyRing {
  current(): { id: string; key: Buffer } | undefined;
  get(id: string): Buffer | undefined;
}
export const unavailablePrivateKeyRing: PartnerApplicationPrivateKeyRing = {
  current: () => undefined,
  get: () => undefined,
};
export const BANK_LIMITS = {
  bankName: 200,
  accountHolder: 200,
  accountNumber: 80,
} as const;
export type PrivateBankInformation = Record<
  keyof typeof BANK_LIMITS,
  string | null
>;
export interface BankCipherContext {
  id: string;
  applicationId: string;
  ownerUserId: string;
}
export interface BankEnvelope {
  keyId: string;
  nonce: string;
  authenticationTag: string;
  ciphertext: string;
}
export function privateBankUnavailable(): never {
  throw new DomainError(
    ErrorCode.INTERNAL_SERVER_ERROR,
    '入驻私有资料服务暂时不可用',
    503,
  );
}

@Injectable()
export class PartnerApplicationPrivateCipher {
  constructor(
    private readonly config: ConfigService,
    @Inject(PARTNER_APPLICATION_PRIVATE_KEY_RING)
    private readonly keys: PartnerApplicationPrivateKeyRing,
  ) {}

  encrypt(
    context: BankCipherContext,
    value: PrivateBankInformation,
  ): BankEnvelope {
    try {
      this.requireTestEnvironment();
      const current = this.keys.current();
      if (!current || !/^[a-zA-Z0-9_.-]{1,100}$/.test(current.id))
        privateBankUnavailable();
      this.requireKey(current.key);
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', current.key, nonce);
      cipher.setAAD(this.aad(context));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(this.payload(value)), 'utf8'),
        cipher.final(),
      ]);
      return {
        keyId: current.id,
        nonce: nonce.toString('hex'),
        authenticationTag: cipher.getAuthTag().toString('hex'),
        ciphertext: ciphertext.toString('hex'),
      };
    } catch {
      return privateBankUnavailable();
    }
  }

  decrypt(
    context: BankCipherContext,
    envelope: BankEnvelope,
  ): PrivateBankInformation {
    try {
      this.requireTestEnvironment();
      if (
        !/^[a-zA-Z0-9_.-]{1,100}$/.test(envelope.keyId) ||
        !/^[a-f0-9]{24}$/.test(envelope.nonce) ||
        !/^[a-f0-9]{32}$/.test(envelope.authenticationTag) ||
        !/^(?:[a-f0-9]{2}){1,4096}$/.test(envelope.ciphertext)
      )
        privateBankUnavailable();
      const key = this.keys.get(envelope.keyId);
      this.requireKey(key);
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(envelope.nonce, 'hex'),
      );
      decipher.setAAD(this.aad(context));
      decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'hex'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'hex')),
        decipher.final(),
      ]);
      return this.payload(JSON.parse(plaintext.toString('utf8')) as unknown);
    } catch {
      return privateBankUnavailable();
    }
  }

  private requireTestEnvironment() {
    if (this.config.get<string>('NODE_ENV') !== 'test')
      privateBankUnavailable();
  }

  private requireKey(value: unknown): asserts value is Buffer {
    if (!Buffer.isBuffer(value) || value.length !== 32)
      privateBankUnavailable();
  }

  private aad(context: BankCipherContext) {
    if (
      ![context.id, context.applicationId, context.ownerUserId].every(
        (id) =>
          typeof id === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id,
          ),
      )
    )
      privateBankUnavailable();
    return Buffer.from(
      JSON.stringify([
        'partner-application-bank',
        context.id,
        context.applicationId,
        context.ownerUserId,
      ]),
    );
  }

  private payload(value: unknown): PrivateBankInformation {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      privateBankUnavailable();
    const fields = Object.keys(BANK_LIMITS) as Array<keyof typeof BANK_LIMITS>;
    if (
      Reflect.ownKeys(value).length !== fields.length ||
      !fields.every((field) => Object.hasOwn(value, field))
    )
      privateBankUnavailable();
    const result = {} as PrivateBankInformation;
    for (const field of fields) {
      const item = (value as Record<string, unknown>)[field];
      if (
        item !== null &&
        (typeof item !== 'string' ||
          Array.from(item).length > BANK_LIMITS[field])
      )
        privateBankUnavailable();
      result[field] = item;
    }
    return result;
  }
}
