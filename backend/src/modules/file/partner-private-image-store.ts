import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PartnerApplicationMaterialKind } from '@prisma/client';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import sharp from 'sharp';
import { DomainError } from '../../common/errors/domain-error';
import {
  PARTNER_APPLICATION_PRIVATE_KEY_RING,
  privateBankUnavailable,
  type PartnerApplicationPrivateKeyRing,
} from '../partner-application/partner-application-private-cipher';
import {
  PartnerPrivateLocalAdapter,
  PRIVATE_IMAGE_MAX_BYTES,
} from './partner-private-local.adapter';
import type { UploadedStoredFile } from './stored-file.service';

export const PARTNER_APPLICATION_MATERIAL_RUN_TAG =
  'PARTNER_APPLICATION_MATERIAL_RUN_TAG';
export interface MaterialCipherContext {
  storedFileId: string;
  applicationId: string;
  ownerUserId: string;
  kind: PartnerApplicationMaterialKind;
}
export interface MaterialEncryption {
  keyId: string;
  nonce: string;
  authenticationTag: string;
  inputDigest: string;
  ciphertextDigest: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
}

@Injectable()
export class PartnerPrivateImageStore {
  private decoding = 0;
  constructor(
    private readonly config: ConfigService,
    private readonly storage: PartnerPrivateLocalAdapter,
    @Inject(PARTNER_APPLICATION_PRIVATE_KEY_RING)
    private readonly keys: PartnerApplicationPrivateKeyRing,
    @Inject(PARTNER_APPLICATION_MATERIAL_RUN_TAG)
    private readonly runTag: string | undefined,
  ) {}

  requireAvailable(): string {
    if (
      this.config.get<string>('NODE_ENV') !== 'test' ||
      this.config.get<string>('FILE_STORAGE_DRIVER') !== 'local' ||
      !this.runTag ||
      !/^[a-z0-9-]{1,100}$/.test(this.runTag)
    )
      privateBankUnavailable();
    const current = this.keys.current();
    if (!current || !/^[a-zA-Z0-9_.-]{1,100}$/.test(current.id))
      privateBankUnavailable();
    this.requireKey(current.key);
    return this.runTag;
  }

  async prepare(
    context: MaterialCipherContext,
    file: UploadedStoredFile | undefined,
  ) {
    this.requireAvailable();
    if (
      !file ||
      !Buffer.isBuffer(file.buffer) ||
      file.size !== file.buffer.length ||
      file.size < 1 ||
      file.size > PRIVATE_IMAGE_MAX_BYTES
    )
      this.invalid();
    this.requireStaticImageHeader(file.buffer);
    if (this.decoding >= 2)
      throw new DomainError(
        'TOO_MANY_REQUESTS',
        '图片处理繁忙，请稍后重试',
        429,
      );
    ++this.decoding;
    let image: { mimeType: string; width: number; height: number };
    try {
      const decoder = sharp(file.buffer, {
        failOn: 'warning',
        limitInputPixels: 16_777_216,
        sequentialRead: true,
      }).timeout({ seconds: 5 });
      const metadata = await decoder.metadata();
      if (
        !['jpeg', 'png'].includes(metadata.format ?? '') ||
        (metadata.pages ?? 1) !== 1 ||
        !metadata.width ||
        !metadata.height ||
        metadata.width > 8192 ||
        metadata.height > 8192 ||
        metadata.width * metadata.height > 16_777_216
      )
        this.invalid();
      const mimeType = metadata.format === 'png' ? 'image/png' : 'image/jpeg';
      if (file.mimetype !== mimeType) this.invalid();
      // metadata() does not decode pixels; raw output forces the whole input through the decoder.
      const decoded = await decoder.raw().toBuffer({ resolveWithObject: true });
      if (
        decoded.info.width !== metadata.width ||
        decoded.info.height !== metadata.height
      )
        this.invalid();
      image = { mimeType, width: metadata.width, height: metadata.height };
    } catch {
      return this.invalid();
    } finally {
      --this.decoding;
    }
    const current = this.keys.current();
    if (!current) privateBankUnavailable();
    this.requireKey(current.key);
    const encrypted = this.encryptBytes(
      context,
      file.buffer,
      current.key,
      randomBytes(12),
    );
    return {
      ciphertext: encrypted.ciphertext,
      metadata: {
        ...image,
        keyId: current.id,
        nonce: encrypted.nonce,
        authenticationTag: encrypted.authenticationTag,
        inputDigest: this.inputDigest(context, file.buffer, current.key),
        ciphertextDigest: this.digest(encrypted.ciphertext),
        sizeBytes: file.size,
      } satisfies MaterialEncryption,
    };
  }

  resume(
    context: MaterialCipherContext,
    file: UploadedStoredFile | undefined,
    metadata: MaterialEncryption,
  ) {
    this.requireAvailable();
    this.validate(metadata);
    const key = this.keys.get(metadata.keyId);
    this.requireKey(key);
    if (
      !file ||
      file.size !== metadata.sizeBytes ||
      file.buffer.length !== file.size ||
      file.mimetype !== metadata.mimeType ||
      this.inputDigest(context, file.buffer, key) !== metadata.inputDigest
    )
      throw new DomainError('CONFLICT', '请使用原图片恢复这次上传', 409);
    const encrypted = this.encryptBytes(
      context,
      file.buffer,
      key,
      Buffer.from(metadata.nonce, 'hex'),
    );
    if (
      encrypted.authenticationTag !== metadata.authenticationTag ||
      this.digest(encrypted.ciphertext) !== metadata.ciphertextDigest
    )
      privateBankUnavailable();
    return { ciphertext: encrypted.ciphertext, metadata };
  }

  async write(storageKey: string, ciphertext: Buffer) {
    try {
      await this.storage.writeOnce(storageKey, ciphertext);
    } catch {
      privateBankUnavailable();
    }
  }

  async inspect(storageKey: string, ciphertext: Buffer) {
    try {
      return await this.storage.inspect(storageKey, ciphertext);
    } catch {
      return privateBankUnavailable();
    }
  }

  async read(
    context: MaterialCipherContext,
    storageKey: string,
    metadata: MaterialEncryption,
  ) {
    try {
      this.requireAvailable();
      this.validate(metadata);
      const key = this.keys.get(metadata.keyId);
      this.requireKey(key);
      const ciphertext = await this.storage.read(storageKey);
      if (
        ciphertext.length !== metadata.sizeBytes ||
        this.digest(ciphertext) !== metadata.ciphertextDigest
      )
        privateBankUnavailable();
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(metadata.nonce, 'hex'),
      );
      decipher.setAAD(this.aad(context));
      decipher.setAuthTag(Buffer.from(metadata.authenticationTag, 'hex'));
      const bytes = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      if (this.inputDigest(context, bytes, key) !== metadata.inputDigest)
        privateBankUnavailable();
      return bytes;
    } catch {
      return privateBankUnavailable();
    }
  }

  private encryptBytes(
    context: MaterialCipherContext,
    bytes: Buffer,
    key: Buffer,
    nonce: Buffer,
  ) {
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(this.aad(context));
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return {
      ciphertext,
      nonce: nonce.toString('hex'),
      authenticationTag: cipher.getAuthTag().toString('hex'),
    };
  }
  private inputDigest(
    context: MaterialCipherContext,
    bytes: Buffer,
    key: Buffer,
  ) {
    const digestKey = createHmac('sha256', key)
      .update('partner-material-resume-v1')
      .digest();
    return createHmac('sha256', digestKey)
      .update(this.aad(context))
      .update(bytes)
      .digest('hex');
  }
  private digest(bytes: Buffer) {
    return createHash('sha256').update(bytes).digest('hex');
  }
  private requireKey(value: unknown): asserts value is Buffer {
    if (!Buffer.isBuffer(value) || value.length !== 32)
      privateBankUnavailable();
  }
  private aad(context: MaterialCipherContext) {
    if (
      ![context.storedFileId, context.applicationId, context.ownerUserId].every(
        (id) =>
          typeof id === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id,
          ),
      ) ||
      !Object.values(PartnerApplicationMaterialKind).includes(context.kind)
    )
      privateBankUnavailable();
    return Buffer.from(
      JSON.stringify([
        'partner-application-file-v1',
        context.storedFileId,
        context.applicationId,
        context.ownerUserId,
        context.kind,
      ]),
    );
  }
  private validate(metadata: MaterialEncryption) {
    if (
      !/^[a-zA-Z0-9_.-]{1,100}$/.test(metadata.keyId) ||
      !/^[a-f0-9]{24}$/.test(metadata.nonce) ||
      !/^[a-f0-9]{32}$/.test(metadata.authenticationTag) ||
      !/^[a-f0-9]{64}$/.test(metadata.inputDigest) ||
      !/^[a-f0-9]{64}$/.test(metadata.ciphertextDigest) ||
      !Number.isInteger(metadata.sizeBytes) ||
      metadata.sizeBytes < 1 ||
      metadata.sizeBytes > PRIVATE_IMAGE_MAX_BYTES ||
      !['image/jpeg', 'image/png'].includes(metadata.mimeType) ||
      !Number.isInteger(metadata.width) ||
      !Number.isInteger(metadata.height) ||
      metadata.width < 1 ||
      metadata.width > 8192 ||
      metadata.height < 1 ||
      metadata.height > 8192 ||
      metadata.width * metadata.height > 16_777_216
    )
      privateBankUnavailable();
  }
  private invalid(): never {
    throw new DomainError(
      'BAD_REQUEST',
      '请选择完整的 JPEG 或 PNG 图片，单张不超过 3MB',
      400,
    );
  }
  private requireStaticImageHeader(bytes: Buffer) {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    if (!bytes.subarray(0, 8).equals(png)) {
      if (!bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')))
        this.invalid();
      return;
    }
    // libvips decodes only APNG's first frame. Reject animation chunks before full pixel decoding.
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      if (length > bytes.length - offset - 12) this.invalid();
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (['acTL', 'fcTL', 'fdAT'].includes(type)) this.invalid();
      offset += length + 12;
      if (type === 'IEND') return;
    }
    this.invalid();
  }
}
