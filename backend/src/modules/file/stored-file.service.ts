import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { StoredFilePurpose } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import type { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface UploadedStoredFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface StoredFileOptions {
  purpose: StoredFilePurpose;
  directory: string;
  allowedMimeTypes: readonly DetectedMimeType[];
  maxBytes: number;
  invalidCode: ErrorCode;
  label: string;
}

type DetectedMimeType = 'image/jpeg' | 'image/png' | 'application/pdf';

export const STUDENT_FEEDBACK_IMAGE_OPTIONS = {
  purpose: 'STUDENT_FEEDBACK_IMAGE',
  directory: 'student-feedback',
  allowedMimeTypes: ['image/jpeg', 'image/png'],
  maxBytes: 2 * 1024 * 1024,
  invalidCode: 'FEEDBACK_IMAGE_INVALID',
  label: 'feedback image',
} as const satisfies StoredFileOptions;

export const GROUP_CAMPAIGN_POSTER_OPTIONS = {
  purpose: 'GROUP_CAMPAIGN_POSTER',
  directory: 'group-campaign-posters',
  allowedMimeTypes: ['image/jpeg', 'image/png'],
  maxBytes: 3 * 1024 * 1024,
  invalidCode: 'GROUP_CAMPAIGN_POSTER_INVALID',
  label: 'group campaign poster',
} as const satisfies StoredFileOptions;

export const CUSTOMER_SERVICE_QR_OPTIONS = {
  purpose: 'CUSTOMER_SERVICE_QR',
  directory: 'customer-service-qr',
  allowedMimeTypes: ['image/jpeg', 'image/png'],
  maxBytes: 3 * 1024 * 1024,
  invalidCode: 'CUSTOMER_SERVICE_QR_INVALID',
  label: 'customer service QR image',
} as const satisfies StoredFileOptions;

export interface FeedbackImageFileView {
  id: string;
  mimeType: string;
  sizeBytes: number;
  accessUrl: string;
  accessUrlExpiresAt: string;
}

export type GroupCampaignPosterFileView = {
  id: string;
  storedFileId: string;
  sortOrder: number;
  mimeType: string;
  sizeBytes: number;
  accessUrl: string;
  accessUrlExpiresAt: string;
};

@Injectable()
export class StoredFileService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async store(
    actor: AuthenticatedUser,
    file: UploadedStoredFile | undefined,
    options: StoredFileOptions,
  ) {
    if (!file || file.buffer.length === 0) {
      this.invalid(options, `A ${options.label} file is required`);
    }
    if (file.size !== file.buffer.length || file.size > options.maxBytes) {
      this.invalid(options, `The ${options.label} file size is invalid`);
    }
    const detected = detectFileType(file.buffer);
    if (
      !detected ||
      detected.mimeType !== file.mimetype ||
      !options.allowedMimeTypes.includes(detected.mimeType)
    ) {
      this.invalid(
        options,
        `The ${options.label} signature or MIME type is invalid`,
      );
    }

    const now = new Date();
    const storageKey = path.posix.join(
      options.directory,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${randomUUID()}.${detected.extension}`,
    );
    const absolutePath = this.resolveStoragePath(storageKey, options);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.buffer, { flag: 'wx' });

    try {
      return await this.prisma.storedFile.create({
        data: {
          purpose: options.purpose,
          storageKey,
          originalName: path.basename(file.originalname),
          mimeType: detected.mimeType,
          sizeBytes: file.size,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          createdByUserId: actor.userId,
        },
      });
    } catch (error: unknown) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  // Callers must authorize the linked business record before accessing private bytes.
  async readPrivateFile(storedFileId: string, options: StoredFileOptions) {
    const stored = await this.prisma.storedFile.findFirst({
      where: { id: storedFileId, purpose: options.purpose },
      select: { storageKey: true, mimeType: true },
    });
    if (!stored) this.imageNotFound(options.label);
    try {
      return { buffer: await readFile(this.resolveStoragePath(stored.storageKey, options)), mimeType: stored.mimeType };
    } catch {
      this.imageNotFound(options.label);
    }
  }

  async discard(storedFileId: string): Promise<void> {
    const stored = await this.prisma.storedFile.findUnique({
      where: { id: storedFileId },
      select: { id: true, storageKey: true },
    });
    if (!stored) return;
    const options: StoredFileOptions = {
      purpose: 'PAYMENT_PROOF',
      directory: 'payment-proofs',
      allowedMimeTypes: ['image/jpeg', 'image/png'],
      maxBytes: 10 * 1024 * 1024,
      invalidCode: 'PAYMENT_PROOF_INVALID',
      label: 'payment proof',
    };
    const absolutePath = this.resolveStoragePath(stored.storageKey, options);
    await this.prisma.storedFile.delete({ where: { id: stored.id } });
    await unlink(absolutePath).catch(() => undefined);
  }

  toFeedbackImageView(file: {
    id: string;
    mimeType: string;
    sizeBytes: number;
  }): FeedbackImageFileView {
    const expires = Math.floor(Date.now() / 1_000) + 15 * 60;
    const signature = this.signFeedbackImage(file.id, expires);
    return {
      ...file,
      accessUrl: `/media/student-feedback/${encodeURIComponent(file.id)}?expires=${expires}&signature=${signature}`,
      accessUrlExpiresAt: new Date(expires * 1_000).toISOString(),
    };
  }

  toGroupCampaignPosterView(poster: {
    id: string;
    sortOrder: number;
    storedFile: { id: string; mimeType: string; sizeBytes: number };
  }): GroupCampaignPosterFileView {
    const expires = Math.floor(Date.now() / 1_000) + 15 * 60;
    const signature = this.signImage(
      'group-campaign-poster',
      poster.storedFile.id,
      expires,
    );
    return {
      id: poster.id,
      storedFileId: poster.storedFile.id,
      sortOrder: poster.sortOrder,
      mimeType: poster.storedFile.mimeType,
      sizeBytes: poster.storedFile.sizeBytes,
      accessUrl: `/media/group-campaign-posters/${encodeURIComponent(poster.storedFile.id)}?expires=${expires}&signature=${signature}`,
      accessUrlExpiresAt: new Date(expires * 1_000).toISOString(),
    };
  }

  toCustomerServiceQrUrl(
    file: { id: string } | null | undefined,
  ): string | null {
    if (!file) return null;
    const expires = Math.floor(Date.now() / 1_000) + 15 * 60;
    const signature = this.signImage(
      'customer-service-qr',
      file.id,
      expires,
    );
    return `/media/customer-service-qr/${encodeURIComponent(file.id)}?expires=${expires}&signature=${signature}`;
  }

  async readGroupCampaignPoster(
    storedFileId: string,
    expiresValue: string,
    signature: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    return this.readSignedImage(
      'group-campaign-poster',
      storedFileId,
      expiresValue,
      signature,
      GROUP_CAMPAIGN_POSTER_OPTIONS,
    );
  }

  async readCustomerServiceQr(
    storedFileId: string,
    expiresValue: string,
    signature: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    return this.readSignedImage(
      'customer-service-qr',
      storedFileId,
      expiresValue,
      signature,
      CUSTOMER_SERVICE_QR_OPTIONS,
    );
  }

  async readFeedbackImage(
    storedFileId: string,
    expiresValue: string,
    signature: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const expires = Number(expiresValue);
    const now = Math.floor(Date.now() / 1_000);
    if (
      !Number.isSafeInteger(expires) ||
      expires < now ||
      expires > now + 60 * 60 ||
      !/^[a-f0-9]{64}$/.test(signature)
    ) {
      this.feedbackImageNotFound();
    }
    const expected = Buffer.from(
      this.signFeedbackImage(storedFileId, expires),
      'hex',
    );
    const actual = Buffer.from(signature, 'hex');
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      this.feedbackImageNotFound();
    }

    const stored = await this.prisma.storedFile.findFirst({
      where: { id: storedFileId, purpose: 'STUDENT_FEEDBACK_IMAGE' },
      select: { storageKey: true, mimeType: true },
    });
    if (!stored) {
      this.feedbackImageNotFound();
    }
    const absolutePath = this.resolveStoragePath(
      stored.storageKey,
      STUDENT_FEEDBACK_IMAGE_OPTIONS,
    );
    try {
      return {
        buffer: await readFile(absolutePath),
        mimeType: stored.mimeType,
      };
    } catch {
      this.feedbackImageNotFound();
    }
  }

  private signFeedbackImage(storedFileId: string, expires: number): string {
    return this.signImage('student-feedback', storedFileId, expires);
  }

  private signImage(
    namespace: string,
    storedFileId: string,
    expires: number,
  ): string {
    return createHmac(
      'sha256',
      this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    )
      .update(`${namespace}:${storedFileId}:${expires}`)
      .digest('hex');
  }

  private async readSignedImage(
    namespace: string,
    storedFileId: string,
    expiresValue: string,
    signature: string,
    options: StoredFileOptions,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const expires = Number(expiresValue);
    const now = Math.floor(Date.now() / 1_000);
    if (
      !Number.isSafeInteger(expires) ||
      expires < now ||
      expires > now + 60 * 60 ||
      !/^[a-f0-9]{64}$/.test(signature)
    ) {
      this.imageNotFound(options.label);
    }
    const expected = Buffer.from(
      this.signImage(namespace, storedFileId, expires),
      'hex',
    );
    const actual = Buffer.from(signature, 'hex');
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      this.imageNotFound(options.label);
    }
    const stored = await this.prisma.storedFile.findFirst({
      where: { id: storedFileId, purpose: options.purpose },
      select: { storageKey: true, mimeType: true },
    });
    if (!stored) this.imageNotFound(options.label);
    try {
      return {
        buffer: await readFile(this.resolveStoragePath(stored.storageKey, options)),
        mimeType: stored.mimeType,
      };
    } catch {
      this.imageNotFound(options.label);
    }
  }

  private imageNotFound(label: string): never {
    throw new DomainError(
      'RESOURCE_NOT_FOUND',
      `The ${label} is unavailable`,
      404,
    );
  }

  private feedbackImageNotFound(): never {
    throw new DomainError(
      'RESOURCE_NOT_FOUND',
      'The feedback image is unavailable',
      404,
    );
  }

  private resolveStoragePath(
    storageKey: string,
    options: StoredFileOptions,
  ): string {
    const storageRoot = path.resolve(
      this.configService.getOrThrow<string>('FILE_STORAGE_ROOT'),
    );
    const absolutePath = path.resolve(storageRoot, ...storageKey.split('/'));
    if (!absolutePath.startsWith(`${storageRoot}${path.sep}`)) {
      this.invalid(options, `The ${options.label} storage key is invalid`);
    }
    return absolutePath;
  }

  private invalid(options: StoredFileOptions, message: string): never {
    throw new DomainError(options.invalidCode, message, 400);
  }
}

function detectFileType(buffer: Buffer): {
  mimeType: DetectedMimeType;
  extension: string;
} | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(pngSignature)) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (
    buffer.length >= 5 &&
    buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  ) {
    return { mimeType: 'application/pdf', extension: 'pdf' };
  }
  return null;
}
