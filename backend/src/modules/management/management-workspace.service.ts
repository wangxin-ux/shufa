import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  AuthenticatedUser,
  RoleCode,
} from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  lessonBalanceSelect,
  summarizeLessonBalances,
} from '../lesson-ledger/lesson-balance';
import { ROLE_PERMISSION_MATRIX } from '../iam/role-permission.matrix';
import {
  CUSTOMER_SERVICE_QR_OPTIONS,
  StoredFileService,
  type UploadedStoredFile,
} from '../file/stored-file.service';
import type {
  ManagementAdjustLessonLedgerDto,
  ManagementAuditLogsQueryDto,
  ManagementCampusesQueryDto,
  ManagementLessonLedgerQueryDto,
  ManagementStudentsQueryDto,
  ManagementUpdateCampusMapLocationDto,
  ManagementUploadCampusCustomerServiceQrDto,
  ManagementUpdateCoursePackageValidityDto,
} from './dto/management.dto';

const ADJUST_ROUTE = '/management/lesson-ledger/adjustments';
const validityRoute = (coursePackageId: string) =>
  `/management/course-packages/${coursePackageId}/validity`;
const campusMapRoute = (campusId: string) =>
  `/management/campuses/${campusId}/map-location`;
const campusCustomerServiceQrRoute = (campusId: string) =>
  `/management/campuses/${campusId}/customer-service-qr`;
const ROLE_LABELS: Record<RoleCode, string> = {
  PARENT: '家长',
  PARTNER: '合作方校区',
  TEACHER: '授课老师',
  OPERATOR: '招商招生运营',
  CAMPUS_MANAGER: '分校区管理员',
  SUPER_ADMIN: '超级管理员',
  HR: '总部人力',
  FINANCE: '总部财务',
};

interface LockedPackage {
  id: string;
  campusId: string;
  studentId: string;
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  mainReservedUnits: number;
  giftReservedUnits: number;
  version: number;
  isActive: boolean;
}

interface LockedValidityPackage extends LockedPackage {
  name: string;
  validFrom: Date;
  expiresAt: Date | null;
}

interface LockedCampusMapLocation {
  id: string;
  address: string | null;
  latitude: unknown;
  longitude: unknown;
  mapVisible: boolean;
  version: number;
}

interface LockedCampusCustomerServiceQr {
  id: string;
  customerServiceQrFileId: string | null;
  version: number;
}

@Injectable()
export class ManagementWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly storedFileService: StoredFileService,
  ) {}

  async listCampuses(query: ManagementCampusesQueryDto) {
    const keyword = query.query?.trim();
    const where: Prisma.CampusWhereInput = keyword
      ? {
          OR: [
            { name: { contains: keyword, mode: 'insensitive' } },
            { code: { contains: keyword, mode: 'insensitive' } },
          ],
        }
      : {};
    const [total, campuses] = await Promise.all([
      this.prisma.campus.count({ where }),
      this.prisma.campus.findMany({
        where,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          code: true,
          name: true,
          timezone: true,
          contactPhone: true,
          address: true,
          lessonWarningThresholdUnits: true,
          students: {
            where: { isActive: true },
            select: {
              coursePackages: {
                where: { isActive: true },
                select: lessonBalanceSelect,
              },
            },
          },
          _count: { select: { teacherProfiles: true, classGroups: true } },
        },
      }),
    ]);
    return {
      data: campuses.map((campus) => ({
        id: campus.id,
        code: campus.code,
        name: campus.name,
        timezone: campus.timezone,
        contactPhone: campus.contactPhone,
        address: campus.address,
        lessonWarningThresholdUnits: campus.lessonWarningThresholdUnits,
        activeStudentCount: campus.students.length,
        teacherCount: campus._count.teacherProfiles,
        classCount: campus._count.classGroups,
        warningStudentCount: campus.students.filter(
          (student) =>
            summarizeLessonBalances(student.coursePackages)
              .availableTotalUnits <= campus.lessonWarningThresholdUnits,
        ).length,
      })),
      meta: this.meta(query.page, query.pageSize, total),
    };
  }

  async getCampus(campusId: string) {
    const campusRecord = await this.prisma.campus.findUnique({
      where: { id: campusId },
      select: {
        id: true,
        code: true,
        name: true,
        timezone: true,
        contactPhone: true,
        address: true,
        latitude: true,
        longitude: true,
        mapVisible: true,
        customerServiceQrFile: { select: { id: true } },
        version: true,
        lessonWarningThresholdUnits: true,
        students: {
          where: { isActive: true },
          select: {
            coursePackages: {
              where: { isActive: true },
              select: lessonBalanceSelect,
            },
          },
        },
        _count: { select: { teacherProfiles: true, classGroups: true } },
      },
    });
    if (!campusRecord) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Campus not found',
        404,
      );
    }
    const campus = {
      id: campusRecord.id,
      code: campusRecord.code,
      name: campusRecord.name,
      timezone: campusRecord.timezone,
      contactPhone: campusRecord.contactPhone,
      address: campusRecord.address,
      latitude:
        campusRecord.latitude === null ? null : Number(campusRecord.latitude),
      longitude:
        campusRecord.longitude === null ? null : Number(campusRecord.longitude),
      mapVisible: campusRecord.mapVisible,
      customerServiceQrCodeUrl: this.storedFileService.toCustomerServiceQrUrl(
        campusRecord.customerServiceQrFile,
      ),
      version: campusRecord.version,
      lessonWarningThresholdUnits: campusRecord.lessonWarningThresholdUnits,
      activeStudentCount: campusRecord.students.length,
      teacherCount: campusRecord._count.teacherProfiles,
      classCount: campusRecord._count.classGroups,
      warningStudentCount: campusRecord.students.filter(
        (student) =>
          summarizeLessonBalances(student.coursePackages).availableTotalUnits <=
          campusRecord.lessonWarningThresholdUnits,
      ).length,
    };
    const [monthCompletedLessonCount, totalMain, totalGift] = await Promise.all(
      [
        this.prisma.lessonSession.count({
          where: { campusId, status: 'COMPLETED' },
        }),
        this.prisma.coursePackage.aggregate({
          where: { campusId, isActive: true },
          _sum: { mainBalanceUnits: true, mainReservedUnits: true },
        }),
        this.prisma.coursePackage.aggregate({
          where: { campusId, isActive: true },
          _sum: { giftBalanceUnits: true, giftReservedUnits: true },
        }),
      ],
    );
    return {
      ...campus,
      monthCompletedLessonCount,
      ...summarizeLessonBalances([
        {
          mainBalanceUnits: totalMain._sum.mainBalanceUnits ?? 0,
          giftBalanceUnits: totalGift._sum.giftBalanceUnits ?? 0,
          mainReservedUnits: totalMain._sum.mainReservedUnits ?? 0,
          giftReservedUnits: totalGift._sum.giftReservedUnits ?? 0,
        },
      ]),
    };
  }

  async updateCampusMapLocation(
    user: AuthenticatedUser,
    campusId: string,
    dto: ManagementUpdateCampusMapLocationDto,
    idempotencyKey: string,
  ) {
    const route = campusMapRoute(campusId);
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId,
        actorUserId: user.userId,
      });
      if (claim.replayed) return claim.responseBody;

      const rows = await transaction.$queryRaw<LockedCampusMapLocation[]>`
        SELECT "id", "address", "latitude", "longitude", "mapVisible", "version"
        FROM "Campus"
        WHERE "id" = ${campusId}::uuid
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current) {
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Campus not found',
          404,
        );
      }
      if (current.version !== dto.expectedVersion) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'Campus map configuration version changed',
          409,
          { currentVersion: current.version },
        );
      }
      const updatedCount = await transaction.campus.updateMany({
        where: { id: campusId, version: current.version },
        data: {
          address: dto.address,
          latitude: dto.latitude,
          longitude: dto.longitude,
          mapVisible: dto.mapVisible,
          version: { increment: 1 },
        },
      });
      if (updatedCount.count !== 1) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'Campus map configuration version changed',
          409,
        );
      }
      const response = {
        id: campusId,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        mapVisible: dto.mapVisible,
        version: current.version + 1,
      };
      await transaction.auditLog.create({
        data: {
          campusId,
          actorUserId: user.userId,
          action: 'CAMPUS_MAP_LOCATION_UPDATE',
          resourceType: 'Campus',
          resourceId: campusId,
          outcome: 'SUCCESS',
          details: {
            before: {
              address: current.address,
              latitude:
                current.latitude === null ? null : Number(current.latitude),
              longitude:
                current.longitude === null ? null : Number(current.longitude),
              mapVisible: current.mapVisible,
              version: current.version,
            },
            after: response,
          },
        },
      });
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: response,
      });
      return response;
    });
  }

  async uploadCampusCustomerServiceQr(
    user: AuthenticatedUser,
    campusId: string,
    dto: ManagementUploadCampusCustomerServiceQrDto,
    file: UploadedStoredFile | undefined,
    idempotencyKey: string,
  ) {
    const stored = await this.storedFileService.store(
      user,
      file,
      CUSTOMER_SERVICE_QR_OPTIONS,
    );
    let attached = false;
    try {
      const outcome = await this.prisma.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<
          LockedCampusCustomerServiceQr[]
        >`
          SELECT "id", "customerServiceQrFileId", "version"
          FROM "Campus"
          WHERE "id" = ${campusId}::uuid
          FOR UPDATE
        `;
        const current = rows[0];
        if (!current) {
          throw new DomainError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Campus not found',
            404,
          );
        }
        const route = campusCustomerServiceQrRoute(campusId);
        const claim = await this.idempotency.claim(transaction, {
          key: idempotencyKey,
          route,
          request: {
            expectedVersion: dto.expectedVersion,
            sha256: stored.sha256,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
          },
          campusId,
          actorUserId: user.userId,
        });
        if (claim.replayed) {
          return {
            replayed: true as const,
            response: claim.responseBody,
            previousFileId: null,
          };
        }
        if (current.version !== dto.expectedVersion) {
          throw new DomainError(
            ErrorCode.CONFLICT,
            'Campus customer service QR version changed',
            409,
            { currentVersion: current.version },
          );
        }
        const updatedCount = await transaction.campus.updateMany({
          where: { id: campusId, version: current.version },
          data: {
            customerServiceQrFileId: stored.id,
            version: { increment: 1 },
          },
        });
        if (updatedCount.count !== 1) {
          throw new DomainError(
            ErrorCode.CONFLICT,
            'Campus customer service QR version changed',
            409,
          );
        }
        const response = {
          id: campusId,
          customerServiceQrCodeUrl:
            this.storedFileService.toCustomerServiceQrUrl(stored),
          version: current.version + 1,
        };
        await transaction.auditLog.create({
          data: {
            campusId,
            actorUserId: user.userId,
            action: 'CUSTOMER_SERVICE_QR_UPDATE',
            resourceType: 'Campus',
            resourceId: campusId,
            outcome: 'SUCCESS',
            details: {
              previousStoredFileId: current.customerServiceQrFileId,
              storedFileId: stored.id,
              previousVersion: current.version,
              version: response.version,
            },
          },
        });
        await this.idempotency.complete(transaction, {
          key: idempotencyKey,
          route,
          responseBody: response,
        });
        return {
          replayed: false as const,
          response,
          previousFileId: current.customerServiceQrFileId,
        };
      });
      if (outcome.replayed) {
        await this.storedFileService.discard(stored.id).catch(() => undefined);
      } else {
        attached = true;
        if (outcome.previousFileId) {
          await this.storedFileService
            .discard(outcome.previousFileId)
            .catch(() => undefined);
        }
      }
      return outcome.response;
    } catch (error: unknown) {
      if (!attached) {
        await this.storedFileService.discard(stored.id).catch(() => undefined);
      }
      throw error;
    }
  }

  async listStudents(query: ManagementStudentsQueryDto) {
    const keyword = query.query?.trim();
    const where: Prisma.StudentWhereInput = {
      isActive: true,
      campusId: query.campusId,
      ...(keyword
        ? { displayName: { contains: keyword, mode: 'insensitive' } }
        : {}),
    };
    const [total, students] = await Promise.all([
      this.prisma.student.count({ where }),
      this.prisma.student.findMany({
        where,
        orderBy: [
          { campus: { code: 'asc' } },
          { displayName: 'asc' },
          { id: 'asc' },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: this.studentSelect(),
      }),
    ]);
    const now = new Date();
    return {
      data: students.map((student) => this.toStudentSummary(student, now)),
      meta: this.meta(query.page, query.pageSize, total),
    };
  }

  async getStudent(studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, isActive: true },
      select: this.studentSelect(),
    });
    if (!student) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Student not found',
        404,
      );
    }
    const now = new Date();
    return {
      ...this.toStudentSummary(student, now),
      coursePackages: student.coursePackages.map((coursePackage) => ({
        id: coursePackage.id,
        name: coursePackage.name,
        ...summarizeLessonBalances([coursePackage]),
        validFrom: coursePackage.validFrom.toISOString(),
        expiresAt: coursePackage.expiresAt?.toISOString() ?? null,
        status: this.packageStatus(coursePackage, now),
        version: coursePackage.version,
      })),
    };
  }

  async updateCoursePackageValidity(
    user: AuthenticatedUser,
    coursePackageId: string,
    dto: ManagementUpdateCoursePackageValidityDto,
    idempotencyKey: string,
  ) {
    const validFrom = new Date(dto.validFrom);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (
      Number.isNaN(validFrom.getTime()) ||
      (expiresAt &&
        (Number.isNaN(expiresAt.getTime()) || expiresAt <= validFrom))
    ) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        'expiresAt must be later than validFrom',
        400,
      );
    }
    const route = validityRoute(coursePackageId);
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: null,
        actorUserId: user.userId,
      });
      if (claim.replayed) return claim.responseBody;

      const rows = await transaction.$queryRaw<LockedValidityPackage[]>`
        SELECT "id", "campusId", "studentId", "name", "mainBalanceUnits",
               "giftBalanceUnits", "mainReservedUnits", "giftReservedUnits",
               "version", "validFrom", "expiresAt", "isActive"
        FROM "CoursePackage"
        WHERE "id" = ${coursePackageId}::uuid
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current) {
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Course package not found',
          404,
        );
      }
      if (!current.isActive) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'Inactive course packages cannot be changed',
          409,
        );
      }
      if (current.version !== dto.expectedVersion) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'Course package version changed',
          409,
        );
      }
      const updated = await transaction.coursePackage.updateMany({
        where: { id: current.id, version: current.version },
        data: {
          validFrom,
          expiresAt,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'Course package version changed',
          409,
        );
      }
      const response = {
        id: current.id,
        name: current.name,
        ...summarizeLessonBalances([current]),
        validFrom: validFrom.toISOString(),
        expiresAt: expiresAt?.toISOString() ?? null,
        status: this.packageStatus(
          { isActive: current.isActive, validFrom, expiresAt },
          new Date(),
        ),
        version: current.version + 1,
      };
      await transaction.auditLog.create({
        data: {
          campusId: current.campusId,
          actorUserId: user.userId,
          action: 'COURSE_PACKAGE_VALIDITY_UPDATE',
          resourceType: 'CoursePackage',
          resourceId: current.id,
          outcome: 'SUCCESS',
          details: {
            validFromBefore: current.validFrom.toISOString(),
            expiresAtBefore: current.expiresAt?.toISOString() ?? null,
            validFromAfter: response.validFrom,
            expiresAtAfter: response.expiresAt,
            versionBefore: current.version,
            versionAfter: response.version,
            reason: dto.reason,
          },
        },
      });
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: response,
      });
      return response;
    });
  }

  async listLessonLedger(query: ManagementLessonLedgerQueryDto) {
    const where: Prisma.LessonLedgerEntryWhereInput = {
      campusId: query.campusId,
      studentId: query.studentId,
      entryType: query.entryType,
      bucket: query.bucket,
    };
    const [total, entries] = await Promise.all([
      this.prisma.lessonLedgerEntry.count({ where }),
      this.prisma.lessonLedgerEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          campusId: true,
          studentId: true,
          coursePackageId: true,
          lessonSessionId: true,
          entryType: true,
          bucket: true,
          deltaUnits: true,
          balanceBeforeUnits: true,
          balanceAfterUnits: true,
          reason: true,
          createdAt: true,
          campus: { select: { name: true } },
          student: { select: { displayName: true } },
          coursePackage: { select: { name: true } },
          actor: { select: { displayName: true } },
        },
      }),
    ]);
    return {
      data: entries.map((entry) => ({
        ...entry,
        campusName: entry.campus.name,
        studentName: entry.student.displayName,
        coursePackageName: entry.coursePackage.name,
        actorName: entry.actor.displayName,
        createdAt: entry.createdAt.toISOString(),
        campus: undefined,
        student: undefined,
        coursePackage: undefined,
        actor: undefined,
      })),
      meta: this.meta(query.page, query.pageSize, total),
    };
  }

  async adjustLessonLedger(
    user: AuthenticatedUser,
    dto: ManagementAdjustLessonLedgerDto,
    idempotencyKey: string,
  ) {
    if (dto.deltaUnits === 0) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        'deltaUnits must not be zero',
        400,
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route: ADJUST_ROUTE,
        request: dto,
        campusId: null,
        actorUserId: user.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }
      const rows = await transaction.$queryRaw<LockedPackage[]>`
        SELECT "id", "campusId", "studentId", "mainBalanceUnits",
               "giftBalanceUnits", "mainReservedUnits", "giftReservedUnits",
               "version", "isActive"
        FROM "CoursePackage"
        WHERE "id" = ${dto.coursePackageId}::uuid
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current) {
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Course package not found',
          404,
        );
      }
      if (!current.isActive) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'Inactive course packages cannot be adjusted',
          409,
        );
      }
      const balanceBeforeUnits =
        dto.bucket === 'MAIN'
          ? current.mainBalanceUnits
          : current.giftBalanceUnits;
      const balanceAfterUnits = balanceBeforeUnits + dto.deltaUnits;
      const reservedUnits =
        dto.bucket === 'MAIN'
          ? current.mainReservedUnits
          : current.giftReservedUnits;
      if (balanceAfterUnits < reservedUnits) {
        throw new DomainError(
          ErrorCode.INSUFFICIENT_LESSON_BALANCE,
          'The adjustment exceeds the available unreserved lesson balance',
          409,
        );
      }
      const updated = await transaction.coursePackage.updateMany({
        where: { id: current.id, version: current.version },
        data: {
          ...(dto.bucket === 'MAIN'
            ? { mainBalanceUnits: balanceAfterUnits }
            : { giftBalanceUnits: balanceAfterUnits }),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'Course package version changed',
          409,
        );
      }
      const entry = await transaction.lessonLedgerEntry.create({
        data: {
          campusId: current.campusId,
          studentId: current.studentId,
          coursePackageId: current.id,
          entryType: 'ADJUSTMENT',
          bucket: dto.bucket,
          deltaUnits: dto.deltaUnits,
          balanceBeforeUnits,
          balanceAfterUnits,
          idempotencyKey,
          actorUserId: user.userId,
          reason: dto.reason,
        },
        select: {
          id: true,
          campusId: true,
          studentId: true,
          coursePackageId: true,
          entryType: true,
          bucket: true,
          deltaUnits: true,
          balanceBeforeUnits: true,
          balanceAfterUnits: true,
          reason: true,
          createdAt: true,
        },
      });
      const response = { ...entry, createdAt: entry.createdAt.toISOString() };
      await transaction.auditLog.create({
        data: {
          campusId: current.campusId,
          actorUserId: user.userId,
          action: 'LESSON_LEDGER_ADJUST',
          resourceType: 'CoursePackage',
          resourceId: current.id,
          outcome: 'SUCCESS',
          details: {
            bucket: dto.bucket,
            deltaUnits: dto.deltaUnits,
            balanceBeforeUnits,
            balanceAfterUnits,
            reason: dto.reason,
          },
        },
      });
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route: ADJUST_ROUTE,
        responseBody: response,
      });
      return response;
    });
  }

  getSystemSettings() {
    return {
      reportingTimeZone: 'Asia/Shanghai' as const,
      paymentMode: '模拟/人工',
      payoutMode: '线下人工打款',
      fileStorageMode:
        process.env.FILE_STORAGE_DRIVER === 'local'
          ? '本地存储适配器'
          : '存储适配器',
      realPaymentEnabled: false,
      automaticPayoutEnabled: false,
      automaticProfitSharingEnabled: false,
      roleCount: 6,
    };
  }

  getRolePermissions() {
    return (Object.keys(ROLE_PERMISSION_MATRIX) as RoleCode[]).map(
      (roleCode) => ({
        roleCode,
        roleLabel: ROLE_LABELS[roleCode],
        permissions: [...ROLE_PERMISSION_MATRIX[roleCode]],
      }),
    );
  }

  async listAuditLogs(query: ManagementAuditLogsQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      campusId: query.campusId,
      ...(query.action
        ? { action: { contains: query.action, mode: 'insensitive' } }
        : {}),
    };
    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          outcome: true,
          details: true,
          createdAt: true,
          actor: { select: { displayName: true } },
          campus: { select: { name: true } },
        },
      }),
    ]);
    return {
      data: logs.map((log) => ({
        id: log.id,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        outcome: log.outcome,
        details: log.details,
        actorName: log.actor?.displayName ?? '系统',
        campusName: log.campus?.name ?? '全部校区',
        createdAt: log.createdAt.toISOString(),
      })),
      meta: this.meta(query.page, query.pageSize, total),
    };
  }

  private studentSelect() {
    return {
      id: true,
      campusId: true,
      displayName: true,
      birthDate: true,
      campus: {
        select: { name: true, lessonWarningThresholdUnits: true },
      },
      classMemberships: {
        where: {
          leftAt: null,
          classGroup: { status: 'ACTIVE' as const },
        },
        select: { classGroup: { select: { name: true } } },
      },
      coursePackages: {
        orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
        select: {
          id: true,
          name: true,
          ...lessonBalanceSelect,
          validFrom: true,
          expiresAt: true,
          isActive: true,
          version: true,
        },
      },
    };
  }

  private toStudentSummary(
    student: {
      id: string;
      campusId: string;
      displayName: string;
      birthDate: Date | null;
      campus: { name: string; lessonWarningThresholdUnits: number };
      classMemberships: Array<{ classGroup: { name: string } }>;
      coursePackages: Array<{
        id: string;
        name: string;
        mainBalanceUnits: number;
        giftBalanceUnits: number;
        mainReservedUnits?: number;
        giftReservedUnits?: number;
        validFrom: Date;
        expiresAt: Date | null;
        isActive: boolean;
        version: number;
      }>;
    },
    now: Date,
  ) {
    const currentPackages = student.coursePackages.filter(
      (coursePackage) => this.packageStatus(coursePackage, now) === 'ACTIVE',
    );
    const balances = summarizeLessonBalances(currentPackages);
    return {
      id: student.id,
      campusId: student.campusId,
      campusName: student.campus.name,
      displayName: student.displayName,
      birthDate: student.birthDate?.toISOString().slice(0, 10) ?? null,
      classNames: student.classMemberships
        .map(({ classGroup }) => classGroup.name)
        .sort(),
      ...balances,
      warningThresholdUnits: student.campus.lessonWarningThresholdUnits,
      lowBalance:
        balances.availableTotalUnits <=
        student.campus.lessonWarningThresholdUnits,
    };
  }

  private packageStatus(
    coursePackage: {
      isActive: boolean;
      validFrom: Date;
      expiresAt: Date | null;
    },
    now: Date,
  ): 'ACTIVE' | 'UPCOMING' | 'EXPIRED' | 'INACTIVE' {
    if (!coursePackage.isActive) return 'INACTIVE';
    if (coursePackage.validFrom > now) return 'UPCOMING';
    if (coursePackage.expiresAt && coursePackage.expiresAt < now) {
      return 'EXPIRED';
    }
    return 'ACTIVE';
  }

  private meta(page: number, pageSize: number, total: number) {
    return {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }
}
