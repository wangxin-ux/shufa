import { Injectable } from '@nestjs/common';
import { PartnerApplicationMaterialKind } from '@prisma/client';
import type {
  PartnerApplication,
  PartnerApplicationUpload,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  PartnerPrivateImageStore,
  type MaterialEncryption,
} from '../file/partner-private-image-store';
import type { UploadedStoredFile } from '../file/stored-file.service';
import type { ApplicantRequest } from './partner-applicant.guard';
import type {
  ReservePartnerMaterialDto,
  SavePartnerMaterialsDto,
  PartnerMaterialReferenceDto,
} from './dto/partner-application-material.dto';
import { privateBankUnavailable } from './partner-application-private-cipher';

type Actor = ApplicantRequest['applicant'];
type Tx = Prisma.TransactionClient;
const transactionOptions = { maxWait: 10_000, timeout: 30_000 };

@Injectable()
export class PartnerApplicationMaterialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: PartnerPrivateImageStore,
  ) {}

  getOwn(actor: Actor) {
    this.files.requireAvailable();
    return this.prisma.$transaction(async (tx) => {
      await this.lockAndAuthorize(tx, actor);
      const application = await tx.partnerApplication.findUnique({
        where: { applicantId: actor.applicantId },
      });
      const current = application
        ? await this.current(tx, actor, application)
        : null;
      const uploads = application
        ? await tx.partnerApplicationUpload.findMany({
            where: {
              applicationId: application.id,
              ownerUserId: actor.userId,
              adoptedAt: null,
            },
            orderBy: { createdAt: 'asc' },
          })
        : [];
      return {
        applicationId: application?.id ?? null,
        status: application?.status ?? null,
        version: application?.version ?? 0,
        readonly:
          Boolean(application && application.status !== 'DRAFT') ||
          Boolean(await tx.userRole.count({ where: { userId: actor.userId } })),
        materials: current?.files.map((item) => this.fileView(item)) ?? [],
        uploads: uploads.map((item) => this.intentView(item)),
      };
    });
  }

  reserve(actor: Actor, input: ReservePartnerMaterialDto) {
    const runTag = this.files.requireAvailable();
    return this.prisma.$transaction(async (tx) => {
      await this.lockAndAuthorize(tx, actor);
      const application = await this.editable(tx, actor);
      const existing = await tx.partnerApplicationUpload.findUnique({
        where: {
          applicationId_requestKey: {
            applicationId: application.id,
            requestKey: input.requestKey,
          },
        },
      });
      if (existing) {
        if (
          existing.kind !== input.kind ||
          existing.expectedVersion !== input.expectedVersion ||
          existing.ownerUserId !== actor.userId
        )
          this.conflict('上传请求已使用，请恢复原上传');
        return this.intentView(existing);
      }
      if (input.expectedVersion !== application.version)
        this.conflict('草稿已更新，请重新读取后上传');
      if (
        (await tx.partnerApplicationUpload.count({
          where: { ownerUserId: actor.userId, adoptedAt: null },
        })) >= 3
      )
        this.conflict('请先保存已上传材料或恢复未完成上传');
      const id = randomUUID();
      const storedFileId = randomUUID();
      const upload = await tx.partnerApplicationUpload.create({
        data: {
          id,
          storedFileId,
          applicationId: application.id,
          ownerUserId: actor.userId,
          expectedVersion: input.expectedVersion,
          requestKey: input.requestKey,
          kind: input.kind,
          runTag,
          storageKey: `partner-application-private/${runTag}/${storedFileId}.bin`,
          objects: {
            create: {
              storageKey: `partner-application-private/${runTag}/${storedFileId}.bin`,
              attempt: 1,
            },
          },
        },
      });
      await this.audit(
        tx,
        actor,
        application.id,
        'PARTNER_APPLICATION_MATERIAL_RESERVE',
        {
          uploadId: id,
          storedFileId,
          kind: input.kind,
        },
      );
      return this.intentView(upload);
    });
  }

  async upload(
    actor: Actor,
    uploadId: string,
    file: UploadedStoredFile | undefined,
  ) {
    this.files.requireAvailable();
    const original = await this.prisma.$transaction(async (tx) => {
      await this.lockAndAuthorize(tx, actor);
      const application = await this.editable(tx, actor);
      return this.ownedUpload(tx, actor, application.id, uploadId);
    });
    const prepared =
      original.state === 'RESERVED'
        ? await this.files.prepare(original, file)
        : this.files.resume(original, file, this.encryption(original));
    // Commit the resumable envelope before file I/O; a later rollback leaves durable ownership.
    const stage = await this.prisma.$transaction(async (tx) => {
      await this.lockAndAuthorize(tx, actor);
      const application = await this.editable(tx, actor);
      const upload = await this.ownedUpload(
        tx,
        actor,
        application.id,
        uploadId,
      );
      if (upload.state !== 'RESERVED') return upload;
      return tx.partnerApplicationUpload.update({
        where: { id: upload.id },
        data: { state: 'WRITING', ...prepared.metadata },
      });
    });
    const resumed = this.files.resume(stage, file, this.encryption(stage));
    await this.prepareObject(actor, uploadId, resumed.ciphertext);
    return this.prisma.$transaction(async (tx) => {
      await this.lockAndAuthorize(tx, actor);
      const application = await this.editable(tx, actor);
      const upload = await this.ownedUpload(
        tx,
        actor,
        application.id,
        uploadId,
      );
      if (upload.state === 'COMPLETED') return this.fileView(upload);
      if (upload.state !== 'WRITING') privateBankUnavailable();
      await this.files.write(upload.storageKey, resumed.ciphertext);
      await tx.storedFile.create({
        data: {
          id: upload.storedFileId,
          purpose: 'PARTNER_APPLICATION_MATERIAL',
          storageKey: upload.storageKey,
          originalName: `${upload.kind}.${upload.mimeType === 'image/png' ? 'png' : 'jpg'}`,
          mimeType: upload.mimeType!,
          sizeBytes: upload.sizeBytes!,
          sha256: upload.ciphertextDigest!,
          createdByUserId: actor.userId,
          partnerApplicationCipher: {
            create: {
              uploadId: upload.id,
              keyId: upload.keyId!,
              nonce: upload.nonce!,
              authenticationTag: upload.authenticationTag!,
            },
          },
        },
      });
      const completed = await tx.partnerApplicationUpload.update({
        where: { id: upload.id },
        data: { state: 'COMPLETED', completedAt: new Date() },
      });
      await tx.partnerApplicationUploadObject.update({
        where: { storageKey: upload.storageKey },
        data: { completedAt: completed.completedAt },
      });
      await this.audit(
        tx,
        actor,
        application.id,
        'PARTNER_APPLICATION_MATERIAL_UPLOAD',
        {
          uploadId: upload.id,
          storedFileId: upload.storedFileId,
          kind: upload.kind,
        },
      );
      await this.authorize(tx, actor);
      return this.fileView(completed);
    }, transactionOptions);
  }

  saveOwn(actor: Actor, input: SavePartnerMaterialsDto) {
    this.files.requireAvailable();
    this.validateReferences(input.materials);
    return this.prisma.$transaction(async (tx) => {
      await this.lockAndAuthorize(tx, actor);
      const application = await this.editable(tx, actor);
      const current = await this.current(tx, actor, application);
      if (
        current &&
        current.record.applicationVersion === application.version &&
        [application.version, application.version - 1].includes(
          input.expectedVersion,
        ) &&
        JSON.stringify(
          current.files.map(({ storedFileId, kind }) => ({
            storedFileId,
            kind,
          })),
        ) ===
          JSON.stringify(
            input.materials.map(({ storedFileId, kind }) => ({
              storedFileId,
              kind,
            })),
          )
      )
        return this.receipt(application, current.record.id);
      if (input.expectedVersion !== application.version)
        this.conflict('草稿已更新，请重新读取后保存材料');
      if (application.version === 2_147_483_647)
        this.conflict('草稿版本已达上限');
      for (const reference of input.materials) {
        const owned = await this.validFile(
          tx,
          actor,
          application.id,
          reference,
        );
        await this.files.read(owned, owned.storageKey, this.encryption(owned));
      }
      const version = application.version + 1;
      const record = await tx.partnerApplicationMaterialRecord.create({
        data: {
          applicationId: application.id,
          applicationVersion: version,
          items: {
            create: input.materials.map((item, sortOrder) => ({
              ...item,
              sortOrder,
            })),
          },
        },
      });
      await tx.partnerApplicationUpload.updateMany({
        where: {
          applicationId: application.id,
          ownerUserId: actor.userId,
          adoptedAt: null,
          state: 'COMPLETED',
          storedFileId: {
            in: input.materials.map((item) => item.storedFileId),
          },
        },
        data: { adoptedAt: new Date() },
      });
      const saved = await tx.partnerApplication.update({
        where: { id: application.id },
        data: { version, currentMaterialRecordId: record.id },
      });
      await this.audit(
        tx,
        actor,
        application.id,
        'PARTNER_APPLICATION_MATERIAL_SAVE',
        {
          previousVersion: application.version,
          version,
          materialRecordId: record.id,
        },
      );
      await this.authorize(tx, actor);
      return this.receipt(saved, record.id);
    }, transactionOptions);
  }

  async readOwn(actor: Actor, storedFileId: string) {
    this.files.requireAvailable();
    const snapshot = await this.prisma.$transaction(async (tx) => {
      await this.lockAndAuthorize(tx, actor);
      const application = await tx.partnerApplication.findUnique({
        where: { applicantId: actor.applicantId },
      });
      if (!application) this.notFound();
      const current = await this.current(tx, actor, application);
      const file = current?.files.find(
        (item) => item.storedFileId === storedFileId,
      );
      if (!file || !current) this.notFound();
      return { application, recordId: current.record.id, file };
    });
    const buffer = await this.files.read(
      snapshot.file,
      snapshot.file.storageKey,
      this.encryption(snapshot.file),
    );
    await this.prisma.$transaction(async (tx) => {
      await this.lockAndAuthorize(tx, actor);
      const application = await tx.partnerApplication.findUnique({
        where: { id: snapshot.application.id },
      });
      if (
        !application ||
        application.applicantId !== actor.applicantId ||
        application.currentMaterialRecordId !== snapshot.recordId
      )
        this.conflict('材料已更新，请重新读取');
      await this.validFile(tx, actor, application.id, snapshot.file);
      await this.audit(
        tx,
        actor,
        application.id,
        'PARTNER_APPLICATION_MATERIAL_READ',
        {
          version: application.version,
          materialRecordId: snapshot.recordId,
          storedFileId,
          kind: snapshot.file.kind,
        },
      );
      await this.authorize(tx, actor);
    });
    return {
      buffer,
      mimeType: snapshot.file.mimeType!,
      kind: snapshot.file.kind,
    };
  }

  private prepareObject(actor: Actor, uploadId: string, ciphertext: Buffer) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockAndAuthorize(tx, actor);
      const application = await this.editable(tx, actor);
      const upload = await this.ownedUpload(
        tx,
        actor,
        application.id,
        uploadId,
      );
      if (upload.state === 'COMPLETED') return;
      const object = await tx.partnerApplicationUploadObject.findUnique({
        where: { storageKey: upload.storageKey },
      });
      if (
        !object ||
        object.uploadId !== upload.id ||
        object.retainedAt ||
        object.completedAt
      )
        privateBankUnavailable();
      if (
        (await this.files.inspect(upload.storageKey, ciphertext)) !==
        'INCOMPLETE'
      )
        return;
      if (object.attempt >= 3) privateBankUnavailable();
      const id = randomUUID();
      const storageKey = `partner-application-private/${upload.runTag}/${id}.bin`;
      await tx.partnerApplicationUploadObject.update({
        where: { id: object.id },
        data: { retainedAt: new Date() },
      });
      await tx.partnerApplicationUploadObject.create({
        data: { id, uploadId, storageKey, attempt: object.attempt + 1 },
      });
      await tx.partnerApplicationUpload.update({
        where: { id: uploadId },
        data: { storageKey },
      });
      await this.audit(
        tx,
        actor,
        application.id,
        'PARTNER_APPLICATION_MATERIAL_RECOVER',
        {
          uploadId,
          storedFileId: upload.storedFileId,
          previousObjectId: object.id,
          objectId: id,
          attempt: object.attempt + 1,
        },
      );
    }, transactionOptions);
  }

  private async current(
    tx: Tx,
    actor: Pick<Actor, 'userId'>,
    application: PartnerApplication,
  ) {
    if (!application.currentMaterialRecordId) return null;
    const record = await tx.partnerApplicationMaterialRecord.findUnique({
      where: { id: application.currentMaterialRecordId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (
      !record ||
      record.applicationId !== application.id ||
      record.applicationVersion > application.version
    )
      privateBankUnavailable();
    this.validateReferences(record.items);
    const files: PartnerApplicationUpload[] = [];
    for (const item of record.items)
      files.push(await this.validFile(tx, actor, application.id, item));
    return { record, files };
  }
  async snapshotFiles(
    tx: Tx,
    application: PartnerApplication,
    ownerUserId: string,
  ) {
    const materials = await this.current(
      tx,
      { userId: ownerUserId },
      application,
    );
    if (!materials) privateBankUnavailable();
    return materials.files.map((file) => ({ file, view: this.fileView(file) }));
  }

  readSnapshotFile(file: PartnerApplicationUpload) {
    return this.files.read(file, file.storageKey, this.encryption(file));
  }
  async validateForSubmission(
    tx: Tx,
    actor: Actor,
    application: PartnerApplication,
  ) {
    const materials = await this.current(tx, actor, application);
    const required = Object.values(PartnerApplicationMaterialKind);
    if (
      !materials ||
      required.some(
        (kind) => !materials.files.some((file) => file.kind === kind),
      )
    )
      throw new DomainError(
        'BAD_REQUEST',
        '请完整上传并保存六类入驻材料，包含门头和环境照片',
        400,
      );
    for (const file of materials.files) {
      await this.files.read(
        {
          storedFileId: file.storedFileId,
          applicationId: application.id,
          ownerUserId: actor.userId,
          kind: file.kind,
        },
        file.storageKey,
        this.encryption(file),
      );
    }
    return materials.record.id;
  }
  private async validFile(
    tx: Tx,
    actor: Pick<Actor, 'userId'>,
    applicationId: string,
    item: PartnerMaterialReferenceDto,
  ) {
    const file = await tx.storedFile.findUnique({
      where: { id: item.storedFileId },
      include: { partnerApplicationCipher: { include: { upload: true } } },
    });
    const cipher = file?.partnerApplicationCipher;
    const upload = cipher?.upload;
    if (
      !file ||
      !cipher ||
      !upload ||
      file.purpose !== 'PARTNER_APPLICATION_MATERIAL' ||
      file.createdByUserId !== actor.userId ||
      upload.ownerUserId !== actor.userId ||
      upload.applicationId !== applicationId ||
      upload.storedFileId !== file.id ||
      upload.kind !== item.kind ||
      upload.state !== 'COMPLETED'
    )
      this.notFound();
    if (
      file.storageKey !== upload.storageKey ||
      file.sha256 !== upload.ciphertextDigest ||
      file.sizeBytes !== upload.sizeBytes ||
      file.mimeType !== upload.mimeType ||
      cipher.keyId !== upload.keyId ||
      cipher.nonce !== upload.nonce ||
      cipher.authenticationTag !== upload.authenticationTag
    )
      privateBankUnavailable();
    return upload;
  }
  private validateReferences(items: PartnerMaterialReferenceDto[]) {
    const counts = new Map<string, number>();
    if (new Set(items.map((item) => item.storedFileId)).size !== items.length)
      throw new DomainError('BAD_REQUEST', '材料不能重复', 400);
    for (const item of items) {
      const count = (counts.get(item.kind) ?? 0) + 1;
      if (count > (item.kind === 'ENVIRONMENT' ? 9 : 1))
        throw new DomainError('BAD_REQUEST', '同类材料数量超出限制', 400);
      counts.set(item.kind, count);
    }
  }
  private async ownedUpload(
    tx: Tx,
    actor: Actor,
    applicationId: string,
    id: string,
  ) {
    const upload = await tx.partnerApplicationUpload.findFirst({
      where: { id, applicationId, ownerUserId: actor.userId },
    });
    if (!upload) this.notFound();
    return upload;
  }
  private async editable(tx: Tx, actor: Actor) {
    if (await tx.userRole.count({ where: { userId: actor.userId } }))
      this.conflict('正式账号不能修改入驻材料');
    const application = await tx.partnerApplication.findUnique({
      where: { applicantId: actor.applicantId },
    });
    if (!application) this.conflict('请先保存机构信息');
    if (application.status !== 'DRAFT') this.conflict('当前申请不能直接修改');
    return application;
  }
  private async lockAndAuthorize(tx: Tx, actor: Actor) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "PartnerApplicantSession" WHERE "id" = ${actor.sessionId}::uuid FOR UPDATE`;
    await this.authorize(tx, actor);
  }
  private async authorize(tx: Tx, actor: Actor) {
    if (
      !(await tx.partnerApplicantSession.findFirst({
        where: {
          id: actor.sessionId,
          applicantId: actor.applicantId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          applicant: { userId: actor.userId, user: { status: 'ACTIVE' } },
        },
        select: { id: true },
      }))
    )
      throw new DomainError('UNAUTHORIZED', '申请登录凭证已失效', 401);
  }
  private encryption(upload: PartnerApplicationUpload): MaterialEncryption {
    if (
      !upload.keyId ||
      !upload.nonce ||
      !upload.authenticationTag ||
      !upload.inputDigest ||
      !upload.ciphertextDigest ||
      !upload.mimeType ||
      !upload.sizeBytes ||
      !upload.width ||
      !upload.height
    )
      privateBankUnavailable();
    return {
      keyId: upload.keyId,
      nonce: upload.nonce,
      authenticationTag: upload.authenticationTag,
      inputDigest: upload.inputDigest,
      ciphertextDigest: upload.ciphertextDigest,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      width: upload.width,
      height: upload.height,
    };
  }
  private intentView(upload: PartnerApplicationUpload) {
    return {
      uploadId: upload.id,
      storedFileId: upload.storedFileId,
      kind: upload.kind,
      state: upload.state,
      expectedVersion: upload.expectedVersion,
      requestKey: upload.requestKey,
    };
  }
  private fileView(upload: PartnerApplicationUpload) {
    return {
      storedFileId: upload.storedFileId,
      kind: upload.kind,
      mimeType: upload.mimeType!,
      sizeBytes: upload.sizeBytes!,
      width: upload.width!,
      height: upload.height!,
    };
  }
  private receipt(application: PartnerApplication, materialRecordId: string) {
    return {
      applicationId: application.id,
      version: application.version,
      materialRecordId,
    };
  }
  private audit(
    tx: Tx,
    actor: Actor,
    applicationId: string,
    action: string,
    details: Prisma.InputJsonObject,
  ) {
    return tx.auditLog.create({
      data: {
        campusId: null,
        actorUserId: actor.userId,
        action,
        resourceType: 'PartnerApplication',
        resourceId: applicationId,
        outcome: 'SUCCESS',
        details,
      },
    });
  }
  private conflict(message: string): never {
    throw new DomainError('CONFLICT', message, 409);
  }
  private notFound(): never {
    throw new DomainError('RESOURCE_NOT_FOUND', '材料不存在或无权访问', 404);
  }
}
