import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PartnerScopeService } from '../../common/auth/partner-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  SubjectBindDto,
  SubjectCreateDto,
  SubjectLinksQueryDto,
  SubjectPageQueryDto,
  SubjectUpdateDto,
} from './campus-subject.dto';

const subjectSelect = {
  id: true,
  name: true,
  isActive: true,
  version: true,
} as const;
const missing = (): never => {
  throw new DomainError(
    ErrorCode.RESOURCE_NOT_FOUND,
    'Subject or target not found',
    404,
  );
};
const conflict = (): never => {
  throw new DomainError(
    ErrorCode.CONFLICT,
    'Subject or target has changed',
    409,
  );
};
const pageMeta = (total: number, query: SubjectPageQueryDto) => ({
  page: query.page,
  pageSize: query.pageSize,
  total,
  totalPages: Math.ceil(total / query.pageSize),
});

@Injectable()
export class CampusSubjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly partnerScope: PartnerScopeService,
  ) {}

  private admin(user: AuthenticatedUser) {
    if (user.roles.length !== 1 || user.roles[0].code !== 'SUPER_ADMIN') {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        'Only headquarters can maintain subjects',
        403,
      );
    }
  }
  private async campus(tx: Prisma.TransactionClient, id: string) {
    if (!(await tx.campus.findUnique({ where: { id }, select: { id: true } })))
      missing();
  }
  async list(
    user: AuthenticatedUser,
    campusId: string | null,
    query: SubjectPageQueryDto,
  ) {
    if (campusId) this.admin(user);
    const scope = campusId ?? this.partnerScope.require(user).campusId;
    return this.prisma.$transaction(
      async (tx) => {
        await this.campus(tx, scope);
        const where = {
          campusId: scope,
          ...(query.query
            ? { name: { contains: query.query, mode: 'insensitive' as const } }
            : {}),
        };
        const total = await tx.campusSubject.count({ where });
        const rows = await tx.campusSubject.findMany({
          where,
          select: subjectSelect,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        });
        return { data: rows, meta: pageMeta(total, query) };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  private async mutate(
    user: AuthenticatedUser,
    campusId: string,
    route: string,
    key: string,
    dto: object,
    action: (tx: Prisma.TransactionClient) => Promise<Prisma.InputJsonObject>,
  ) {
    this.admin(user);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.campus(tx, campusId);
        const claim = await this.idempotency.claim(tx, {
          key,
          route,
          request: dto,
          campusId,
          actorUserId: user.userId,
        });
        if (claim.replayed) return claim.responseBody;
        const result = await action(tx);
        await this.idempotency.complete(tx, {
          key,
          route,
          responseBody: result,
        });
        return result;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        conflict();
      throw error;
    }
  }
  async create(
    user: AuthenticatedUser,
    campusId: string,
    dto: SubjectCreateDto,
    key: string,
  ) {
    return this.mutate(
      user,
      campusId,
      `/management/campuses/${campusId}/subjects`,
      key,
      dto,
      async (tx) => {
        const row = await tx.campusSubject.create({
          data: { campusId, name: dto.name },
          select: subjectSelect,
        });
        await tx.auditLog.create({
          data: {
            campusId,
            actorUserId: user.userId,
            action: 'SUBJECT_CREATE',
            resourceType: 'CampusSubject',
            resourceId: row.id,
            outcome: 'SUCCESS',
            details: { after: row },
          },
        });
        return row;
      },
    );
  }
  async update(
    user: AuthenticatedUser,
    campusId: string,
    id: string,
    dto: SubjectUpdateDto,
    key: string,
  ) {
    return this.mutate(
      user,
      campusId,
      `/management/campuses/${campusId}/subjects/${id}`,
      key,
      dto,
      async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            name: string;
            isActive: boolean;
            version: number;
          }>
        >`
          SELECT "id", "name", "isActive", "version" FROM "CampusSubject"
          WHERE "id" = ${id}::uuid AND "campusId" = ${campusId}::uuid FOR UPDATE`;
        const before = rows[0];
        if (!before) missing();
        if (before.version !== dto.expectedVersion) conflict();
        const updated = await tx.campusSubject.updateMany({
          where: { id, campusId, version: dto.expectedVersion },
          data: {
            name: dto.name,
            isActive: dto.isActive,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) conflict();
        const after = {
          id,
          name: dto.name,
          isActive: dto.isActive,
          version: dto.expectedVersion + 1,
        };
        await tx.auditLog.create({
          data: {
            campusId,
            actorUserId: user.userId,
            action: 'SUBJECT_UPDATE',
            resourceType: 'CampusSubject',
            resourceId: id,
            outcome: 'SUCCESS',
            details: { before, after },
          },
        });
        return after;
      },
    );
  }
  async links(
    user: AuthenticatedUser,
    campusId: string,
    query: SubjectLinksQueryDto,
  ) {
    this.admin(user);
    return this.prisma.$transaction(
      async (tx) => {
        await this.campus(tx, campusId);
        const name = query.query
          ? { contains: query.query, mode: 'insensitive' as const }
          : undefined;
        const pagination = {
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          orderBy: [{ name: 'asc' as const }, { id: 'asc' as const }],
        };
        const select = {
          id: true,
          name: true,
          subjectId: true,
          subjectVersion: true,
          subject: { select: { name: true } },
        } as const;
        if (query.kind === 'CLASS') {
          const where = { campusId, ...(name ? { name } : {}) };
          const total = await tx.classGroup.count({ where });
          const rows = await tx.classGroup.findMany({
            where,
            ...pagination,
            select,
          });
          return {
            data: rows.map((row) => ({
              id: row.id,
              name: row.name,
              studentName: null,
              subjectId: row.subjectId,
              subjectName: row.subject?.name ?? null,
              version: row.subjectVersion,
            })),
            meta: pageMeta(total, query),
          };
        }
        const where = {
          campusId,
          student: { campusId },
          ...(name
            ? { OR: [{ name }, { student: { displayName: name } }] }
            : {}),
        };
        const total = await tx.coursePackage.count({ where });
        const rows = await tx.coursePackage.findMany({
          where,
          ...pagination,
          select: { ...select, student: { select: { displayName: true } } },
        });
        return {
          data: rows.map((row) => ({
            id: row.id,
            name: row.name,
            studentName: row.student.displayName,
            subjectId: row.subjectId,
            subjectName: row.subject?.name ?? null,
            version: row.subjectVersion,
          })),
          meta: pageMeta(total, query),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async bind(
    user: AuthenticatedUser,
    campusId: string,
    kind: string,
    id: string,
    dto: SubjectBindDto,
    key: string,
  ) {
    if (kind !== 'CLASS' && kind !== 'PACKAGE') {
      throw new DomainError(
        ErrorCode.BAD_REQUEST,
        'Invalid subject target kind',
        400,
      );
    }
    return this.mutate(
      user,
      campusId,
      `/management/campuses/${campusId}/subjects/links/${kind}/${id}`,
      key,
      dto,
      async (tx) => {
        const table =
          kind === 'CLASS'
            ? Prisma.sql`"ClassGroup"`
            : Prisma.sql`"CoursePackage"`;
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            subjectId: string | null;
            subjectVersion: number;
          }>
        >(
          Prisma.sql`SELECT "id", "subjectId", "subjectVersion" FROM ${table}
          WHERE "id" = ${id}::uuid AND "campusId" = ${campusId}::uuid FOR UPDATE`,
        );
        const before = rows[0];
        if (!before) missing();
        if (before.subjectVersion !== dto.expectedVersion) conflict();
        if (dto.subjectId) {
          const subject = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "CampusSubject" WHERE "id" = ${dto.subjectId}::uuid
          AND "campusId" = ${campusId}::uuid AND "isActive" = TRUE FOR SHARE`;
          if (!subject.length) missing();
        }
        const where = { id, campusId, subjectVersion: dto.expectedVersion };
        const update = {
          subjectId: dto.subjectId,
          subjectVersion: { increment: 1 },
        };
        const result =
          kind === 'CLASS'
            ? await tx.classGroup.updateMany({ where, data: update })
            : await tx.coursePackage.updateMany({ where, data: update });
        if (result.count !== 1) conflict();
        const after = {
          id,
          subjectId: dto.subjectId,
          version: dto.expectedVersion + 1,
        };
        await tx.auditLog.create({
          data: {
            campusId,
            actorUserId: user.userId,
            action: 'SUBJECT_LINK_UPDATE',
            resourceType: kind === 'CLASS' ? 'ClassGroup' : 'CoursePackage',
            resourceId: id,
            outcome: 'SUCCESS',
            details: { before, after, reason: dto.reason },
          },
        });
        return after;
      },
    );
  }
}
