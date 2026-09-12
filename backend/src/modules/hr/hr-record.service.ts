import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  StoredFileService,
  type UploadedStoredFile,
} from '../file/stored-file.service';
import {
  ArchiveHrTeacherRecordDto,
  HrTeacherRecordInputDto,
  HrTeacherRecordQueryDto,
  UpdateHrTeacherRecordDto,
} from './hr-record.dto';

const attachmentOptions = {
  purpose: 'HR_TEACHER_RECORD_ATTACHMENT',
  directory: 'hr-teacher-records',
  allowedMimeTypes: ['image/png', 'image/jpeg', 'application/pdf'],
  maxBytes: 3 * 1024 * 1024,
  invalidCode: 'BAD_REQUEST',
  label: 'HR teacher record attachment',
} as const;

const recordInclude = {
  attachment: {
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
    },
  },
  createdBy: { select: { displayName: true } },
} satisfies Prisma.HrTeacherRecordInclude;
type HrTeacherRecordRow = Prisma.HrTeacherRecordGetPayload<{
  include: typeof recordInclude;
}>;

@Injectable()
export class HrRecordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly files: StoredFileService,
  ) {}

  async uploadAttachment(actor: AuthenticatedUser, file?: UploadedStoredFile) {
    this.authorize(actor);
    const stored = await this.files.store(actor, file, attachmentOptions);
    return attachmentView(stored);
  }

  async records(
    actor: AuthenticatedUser,
    teacherId: string,
    query: HrTeacherRecordQueryDto,
  ) {
    this.authorize(actor);
    const where = {
      teacherId,
      kind: query.kind,
      archivedAt:
        query.status === 'ALL'
          ? undefined
          : query.status === 'ARCHIVED'
            ? { not: null }
            : null,
    } satisfies Prisma.HrTeacherRecordWhereInput;
    return this.prisma.$transaction(
      async (tx) => {
        await this.requireTeacher(tx, teacherId);
        const [rows, total] = await Promise.all([
          tx.hrTeacherRecord.findMany({
            where,
            include: recordInclude,
            orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          tx.hrTeacherRecord.count({ where }),
        ]);
        return {
          items: rows.map(recordView),
          total,
          page: query.page,
          pageSize: query.pageSize,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async create(
    actor: AuthenticatedUser,
    teacherId: string,
    input: HrTeacherRecordInputDto,
    key: string,
  ) {
    this.authorize(actor);
    const data = normalizeInput(input);
    const route = `/hr/teachers/${teacherId}/records`;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const claim = await this.idempotency.claim(tx, {
          key,
          route,
          request: input,
          campusId: null,
          actorUserId: actor.userId,
        });
        if (claim.replayed) return claim.responseBody;
        const teacher = await this.requireTeacher(tx, teacherId, true);
        if (data.attachmentFileId) {
          await this.requireAvailableAttachment(
            tx,
            actor,
            data.attachmentFileId,
          );
        }
        const record = await tx.hrTeacherRecord.create({
          data: {
            teacherId,
            ...data,
            createdByUserId: actor.userId,
          },
          include: recordInclude,
        });
        await this.audit(tx, actor, teacher.campusId, record.id, 'CREATE', {
          teacherId,
          kind: record.kind,
          title: record.title,
          attachmentFileId: record.attachmentFileId,
          version: record.version,
        });
        const response = recordView(record);
        await this.idempotency.complete(tx, {
          key,
          route,
          responseBody: response,
          responseStatus: 201,
        });
        return response;
      });
    } catch (error: unknown) {
      this.handleAttachmentConflict(error);
    }
  }

  async update(
    actor: AuthenticatedUser,
    recordId: string,
    input: UpdateHrTeacherRecordDto,
    key: string,
  ) {
    this.authorize(actor);
    const data = normalizeInput(input);
    const route = `/hr/teacher-records/${recordId}`;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const claim = await this.idempotency.claim(tx, {
          key,
          route,
          request: input,
          campusId: null,
          actorUserId: actor.userId,
        });
        if (claim.replayed) return claim.responseBody;
        const current = await this.lockRecord(tx, recordId);
        if (current.archivedAt) this.conflict('Archived records are immutable');
        if (current.version !== input.expectedVersion)
          this.conflict('The teacher record version has changed');
        if (
          data.attachmentFileId &&
          data.attachmentFileId !== current.attachmentFileId
        ) {
          await this.requireAvailableAttachment(
            tx,
            actor,
            data.attachmentFileId,
          );
        }
        const updated = await tx.hrTeacherRecord.update({
          where: { id: recordId },
          data: { ...data, version: { increment: 1 } },
          include: recordInclude,
        });
        await this.audit(
          tx,
          actor,
          current.teacher.campusId,
          recordId,
          'UPDATE',
          {
            teacherId: current.teacherId,
            attachmentFileId: updated.attachmentFileId,
            before: businessSnapshot(current),
            after: businessSnapshot(updated),
          },
        );
        const response = recordView(updated);
        await this.idempotency.complete(tx, {
          key,
          route,
          responseBody: response,
        });
        return response;
      });
    } catch (error: unknown) {
      this.handleAttachmentConflict(error);
    }
  }

  async archive(
    actor: AuthenticatedUser,
    recordId: string,
    input: ArchiveHrTeacherRecordDto,
    key: string,
  ) {
    this.authorize(actor);
    const reason = input.reason.trim();
    if (!reason) this.invalid('Archive reason cannot be blank');
    const route = `/hr/teacher-records/${recordId}/archive`;
    return this.prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: input,
        campusId: null,
        actorUserId: actor.userId,
      });
      if (claim.replayed) return claim.responseBody;
      const current = await this.lockRecord(tx, recordId);
      if (current.archivedAt) this.conflict('The teacher record is archived');
      if (current.version !== input.expectedVersion)
        this.conflict('The teacher record version has changed');
      const updated = await tx.hrTeacherRecord.update({
        where: { id: recordId },
        data: { archivedAt: new Date(), version: { increment: 1 } },
        include: recordInclude,
      });
      await this.audit(
        tx,
        actor,
        current.teacher.campusId,
        recordId,
        'ARCHIVE',
        {
          teacherId: current.teacherId,
          reason,
          attachmentFileId: current.attachmentFileId,
          previousVersion: current.version,
          version: updated.version,
        },
      );
      const response = recordView(updated);
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: response,
      });
      return response;
    });
  }

  async readAttachment(actor: AuthenticatedUser, recordId: string) {
    this.authorize(actor);
    const record = await this.prisma.hrTeacherRecord.findUnique({
      where: { id: recordId },
      select: { attachmentFileId: true },
    });
    if (!record?.attachmentFileId) this.notFound();
    return this.files.readPrivateFile(
      record.attachmentFileId,
      attachmentOptions,
    );
  }

  private authorize(actor: AuthenticatedUser) {
    if (
      actor.roles.length !== 1 ||
      actor.roles[0].code !== 'HR' ||
      actor.roles[0].campusId !== null
    ) {
      throw new DomainError(
        'FORBIDDEN',
        'A single headquarters HR identity is required',
        403,
      );
    }
  }

  private async requireTeacher(
    tx: Prisma.TransactionClient,
    teacherId: string,
    lock = false,
  ) {
    if (lock) {
      await tx.$queryRaw`SELECT "id" FROM "TeacherProfile" WHERE "id" = ${teacherId}::uuid FOR UPDATE`;
    }
    const teacher = await tx.teacherProfile.findUnique({
      where: { id: teacherId },
      select: { id: true, campusId: true },
    });
    if (!teacher) this.notFound();
    return teacher;
  }

  private async lockRecord(tx: Prisma.TransactionClient, recordId: string) {
    await tx.$queryRaw`SELECT "id" FROM "HrTeacherRecord" WHERE "id" = ${recordId}::uuid FOR UPDATE`;
    const record = await tx.hrTeacherRecord.findUnique({
      where: { id: recordId },
      include: { teacher: { select: { campusId: true } } },
    });
    if (!record) this.notFound();
    return record;
  }

  private async requireAvailableAttachment(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    attachmentFileId: string,
  ) {
    await tx.$queryRaw`SELECT "id" FROM "StoredFile" WHERE "id" = ${attachmentFileId}::uuid FOR UPDATE`;
    const attachment = await tx.storedFile.findFirst({
      where: {
        id: attachmentFileId,
        purpose: attachmentOptions.purpose,
        createdByUserId: actor.userId,
      },
      include: {
        hrTeacherRecordAttachment: { select: { id: true } },
      },
    });
    if (!attachment)
      this.invalid(
        'An uploader-owned HR teacher record attachment is required',
      );
    if (attachment.hrTeacherRecordAttachment)
      this.conflict('This attachment is already linked to a teacher record');
    const previousUse = await tx.auditLog.findFirst({
      where: {
        resourceType: 'HrTeacherRecord',
        OR: [
          { details: { path: ['attachmentFileId'], equals: attachmentFileId } },
          {
            details: {
              path: ['before', 'attachmentFileId'],
              equals: attachmentFileId,
            },
          },
          {
            details: {
              path: ['after', 'attachmentFileId'],
              equals: attachmentFileId,
            },
          },
        ],
      },
      select: { id: true },
    });
    if (previousUse)
      this.conflict('This attachment was already used by a teacher record');
  }

  private audit(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    campusId: string,
    recordId: string,
    action: 'CREATE' | 'UPDATE' | 'ARCHIVE',
    details: Prisma.InputJsonObject,
  ) {
    return tx.auditLog.create({
      data: {
        campusId,
        actorUserId: actor.userId,
        action: `HR_TEACHER_RECORD_${action}`,
        resourceType: 'HrTeacherRecord',
        resourceId: recordId,
        outcome: 'SUCCESS',
        details,
      },
    });
  }

  private handleAttachmentConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      this.conflict('This attachment is already linked to a teacher record');
    }
    throw error;
  }

  private invalid(message: string): never {
    throw new DomainError('BAD_REQUEST', message, 400);
  }

  private conflict(message: string): never {
    throw new DomainError('CONFLICT', message, 409);
  }

  private notFound(): never {
    throw new DomainError(
      'RESOURCE_NOT_FOUND',
      'Teacher record or teacher profile not found',
      404,
    );
  }
}

function normalizeInput(input: HrTeacherRecordInputDto) {
  const occurredOn = calendarDate(input.occurredOn);
  const expiresOn = input.expiresOn ? calendarDate(input.expiresOn) : null;
  if (expiresOn && expiresOn < occurredOn) {
    throw new DomainError(
      'BAD_REQUEST',
      'Expiry date cannot precede the occurred date',
      400,
    );
  }
  const title = input.title.trim();
  if (!title) {
    throw new DomainError('BAD_REQUEST', 'Record title cannot be blank', 400);
  }
  return {
    kind: input.kind,
    title,
    organization: input.organization?.trim() || null,
    occurredOn,
    expiresOn,
    note: input.note?.trim() ?? '',
    attachmentFileId: input.attachmentFileId ?? null,
  };
}

function calendarDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new DomainError('BAD_REQUEST', 'Invalid calendar date', 400);
  }
  return date;
}

function attachmentView(file: {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}) {
  return {
    id: file.id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
  };
}

function businessSnapshot(row: {
  id: string;
  teacherId: string;
  kind: string;
  title: string;
  organization: string | null;
  occurredOn: Date;
  expiresOn: Date | null;
  note: string;
  attachmentFileId: string | null;
  version: number;
  archivedAt: Date | null;
}) {
  return {
    id: row.id,
    teacherId: row.teacherId,
    kind: row.kind,
    title: row.title,
    organization: row.organization,
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    expiresOn: row.expiresOn?.toISOString().slice(0, 10) ?? null,
    note: row.note,
    attachmentFileId: row.attachmentFileId,
    version: row.version,
    status: row.archivedAt ? ('ARCHIVED' as const) : ('ACTIVE' as const),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function recordView(row: HrTeacherRecordRow) {
  return {
    id: row.id,
    teacherId: row.teacherId,
    kind: row.kind,
    title: row.title,
    organization: row.organization,
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    expiresOn: row.expiresOn?.toISOString().slice(0, 10) ?? null,
    note: row.note,
    attachmentFileId: row.attachmentFileId,
    attachment: row.attachment ? attachmentView(row.attachment) : null,
    version: row.version,
    status: row.archivedAt ? ('ARCHIVED' as const) : ('ACTIVE' as const),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdByName: row.createdBy.displayName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
