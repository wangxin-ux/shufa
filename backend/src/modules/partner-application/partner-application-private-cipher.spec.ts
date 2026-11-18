import { ConfigService } from '@nestjs/config';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import {
  PartnerApplicationPrivateCipher,
  unavailablePrivateKeyRing,
} from './partner-application-private-cipher';

describe('private bank authenticated encryption', () => {
  const context = {
    id: randomUUID(),
    applicationId: randomUUID(),
    ownerUserId: randomUUID(),
  };
  const bank = {
    bankName: '合成测试行',
    accountHolder: '合成户名',
    accountNumber: '00000000000000000001',
  };
  const key = randomBytes(32);
  const ring = { current: () => ({ id: 'synthetic-v1', key }), get: () => key };
  const cipher = new PartnerApplicationPrivateCipher(
    new ConfigService({ NODE_ENV: 'test' }),
    ring,
  );
  it('uses fresh nonces and can decrypt the same historical record independently of application version', () => {
    const first = cipher.encrypt(context, bank);
    const next = cipher.encrypt(context, bank);
    expect(first.nonce).not.toEqual(next.nonce);
    expect(first.ciphertext).not.toEqual(next.ciphertext);
    expect(cipher.decrypt(context, first)).toEqual(bank);
    expect(cipher.decrypt(context, next)).toEqual(bank);
  });
  it.each(['id', 'applicationId', 'ownerUserId'] as const)(
    'authenticates the immutable %s binding',
    (field) => {
      const encrypted = cipher.encrypt(context, bank);
      expect(() =>
        cipher.decrypt({ ...context, [field]: randomUUID() }, encrypted),
      ).toThrow('入驻私有资料服务暂时不可用');
    },
  );
  it.each(['development', 'production'])(
    'refuses %s even when a test ring is injected',
    (environment) => {
      const closed = new PartnerApplicationPrivateCipher(
        new ConfigService({ NODE_ENV: environment }),
        ring,
      );
      expect(() => closed.encrypt(context, bank)).toThrow(
        '入驻私有资料服务暂时不可用',
      );
      expect(() =>
        closed.decrypt(context, cipher.encrypt(context, bank)),
      ).toThrow('入驻私有资料服务暂时不可用');
    },
  );
  it('keeps the default provider closed', () => {
    const closed = new PartnerApplicationPrivateCipher(
      new ConfigService({ NODE_ENV: 'test' }),
      unavailablePrivateKeyRing,
    );
    expect(() => closed.encrypt(context, bank)).toThrow(
      '入驻私有资料服务暂时不可用',
    );
    expect(() =>
      closed.decrypt(context, cipher.encrypt(context, bank)),
    ).toThrow('入驻私有资料服务暂时不可用');
  });
  it.each([
    { ...bank, extra: 'unexpected' },
    { bankName: null },
    { ...bank, accountNumber: 123 },
    { ...bank, bankName: '行'.repeat(201) },
    ['unexpected'],
    null,
  ])(
    'rejects even authenticated malformed historical payloads %#',
    (payload) => {
      const nonce = randomBytes(12);
      const raw = createCipheriv('aes-256-gcm', key, nonce);
      raw.setAAD(
        Buffer.from(
          JSON.stringify([
            'partner-application-bank',
            context.id,
            context.applicationId,
            context.ownerUserId,
          ]),
        ),
      );
      const ciphertext = Buffer.concat([
        raw.update(JSON.stringify(payload)),
        raw.final(),
      ]).toString('hex');
      expect(() =>
        cipher.decrypt(context, {
          keyId: 'synthetic-v1',
          nonce: nonce.toString('hex'),
          authenticationTag: raw.getAuthTag().toString('hex'),
          ciphertext,
        }),
      ).toThrow('入驻私有资料服务暂时不可用');
    },
  );
});
