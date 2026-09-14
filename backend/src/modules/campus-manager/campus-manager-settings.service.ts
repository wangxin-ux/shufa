import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CampusManagerScopeService } from '../../common/auth/campus-manager-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { lessonBalanceSelect, summarizeLessonBalances } from '../lesson-ledger/lesson-balance';
import type {
  CampusManagerUpdateCampusDto,
  CampusManagerWarningsQueryDto,
} from './dto/campus-manager-settings.dto';

const SETTINGS_ROUTE = '/campus-managers/me/campus';

const campusViewSelect = {
  id: true,
  code: true,
  name: true,
  timezone: true,
  contactPhone: true,
  address: true,
  lessonWarningThresholdUnits: true,
  version: true,
} satisfies Prisma.CampusSelect;

type CampusViewRecord = Prisma.CampusGetPayload<{
  select: typeof campusViewSelect;
}>;

type LockedCampus = CampusViewRecord & {
  latitude: unknown;
  longitude: unknown;
  mapVisible: boolean;
};

@Injectable()
export class CampusManagerSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: CampusManagerScopeService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async listWarnings(
    user: AuthenticatedUser,
    query: CampusManagerWarningsQueryDto,
  ) {
    const scope = this.scopeService.require(user);
    const now = new Date();
    const keyword = query.query?.trim();
    const [campus, students] = await Promise.all([
      this.prisma.campus.findUnique({
        where: { id: scope.campusId },
        select: { lessonWarningThresholdUnits: true },
      }),
      this.prisma.student.findMany({
        where: {
          campusId: scope.campusId,
          isActive: true,
          ...(keyword
            ? { displayName: { contains: keyword, mode: 'insensitive' } }
            : {}),
        },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          displayName: true,
          classMemberships: {
            where: { leftAt: null, classGroup: { status: 'ACTIVE' } },
            select: { classGroup: { select: { name: true } } },
          },
          coursePackages: {
            where: {
              campusId: scope.campusId,
              isActive: true,
              validFrom: { lte: now },
              OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
            },
            select: lessonBalanceSelect,
          },
        },
      }),
    ]);
    if (!campus) {
      this.forbidden();
    }

    const thresholdUnits = campus.lessonWarningThresholdUnits;
    const warnings = students.flatMap((student) => {
      const balances = summarizeLessonBalances(student.coursePackages);
      if (balances.availableTotalUnits > thresholdUnits) {
        return [];
      }
      return [
        {
          studentId: student.id,
          studentName: student.displayName,
          classNames: student.classMemberships
            .map(({ classGroup }) => classGroup.name)
            .sort(),
          ...balances,
          thresholdUnits,
        },
      ];
    });
    warnings.sort(
      (left, right) =>
        left.availableTotalUnits - right.availableTotalUnits ||
        left.studentName.localeCompare(right.studentName, 'zh-CN') ||
        left.studentId.localeCompare(right.studentId),
    );
    const offset = (query.page - 1) * query.pageSize;

    return {
      data: warnings.slice(offset, offset + query.pageSize),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: warnings.length,
        totalPages:
          warnings.length === 0
            ? 0
            : Math.ceil(warnings.length / query.pageSize),
      },
    };
  }

  async getCampus(user: AuthenticatedUser) {
    const scope = this.scopeService.require(user);
    const campus = await this.prisma.campus.findUnique({
      where: { id: scope.campusId },
      select: campusViewSelect,
    });
    if (!campus) {
      this.forbidden();
    }
    return campus;
  }

  async updateCampus(
    user: AuthenticatedUser,
    dto: CampusManagerUpdateCampusDto,
    idempotencyKey: string,
  ) {
    const scope = this.scopeService.require(user);

    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route: SETTINGS_ROUTE,
        request: dto,
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }

      const locked = await transaction.$queryRaw<LockedCampus[]>`
        SELECT
          "id", "code", "name", "timezone", "contactPhone", "address",
          "lessonWarningThresholdUnits", "version", "latitude", "longitude",
          "mapVisible"
        FROM "Campus"
        WHERE "id" = ${scope.campusId}::uuid
        FOR UPDATE
      `;
      const current = locked[0];
      if (!current) {
        this.forbidden();
      }
      if (current.version !== dto.version) {
        this.versionConflict(current.version);
      }
      const addressChanged = current.address !== dto.address;

      const updatedCount = await transaction.campus.updateMany({
        where: { id: scope.campusId, version: dto.version },
        data: {
          name: dto.name,
          contactPhone: dto.contactPhone,
          address: dto.address,
          ...(addressChanged
            ? { latitude: null, longitude: null, mapVisible: false }
            : {}),
          lessonWarningThresholdUnits: dto.lessonWarningThresholdUnits,
          version: { increment: 1 },
        },
      });
      if (updatedCount.count !== 1) {
        const latest = await transaction.campus.findUnique({
          where: { id: scope.campusId },
          select: { version: true },
        });
        if (!latest) {
          this.forbidden();
        }
        this.versionConflict(latest.version);
      }

      const updated = await transaction.campus.findUniqueOrThrow({
        where: { id: scope.campusId },
        select: campusViewSelect,
      });
      await transaction.auditLog.create({
        data: {
          campusId: scope.campusId,
          actorUserId: scope.userId,
          action: 'CAMPUS_SETTINGS_UPDATE',
          resourceType: 'Campus',
          resourceId: scope.campusId,
          outcome: 'SUCCESS',
          details: {
            before: this.toEditableSnapshot(current),
            after: this.toEditableSnapshot(updated),
          },
        },
      });
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route: SETTINGS_ROUTE,
        responseBody: this.asJson(updated),
      });
      return updated;
    });
  }

  private toEditableSnapshot(campus: CampusViewRecord) {
    return {
      name: campus.name,
      contactPhone: campus.contactPhone,
      address: campus.address,
      lessonWarningThresholdUnits: campus.lessonWarningThresholdUnits,
      version: campus.version,
    };
  }

  private versionConflict(currentVersion: number): never {
    throw new DomainError(
      ErrorCode.CONFLICT,
      'The campus settings version has changed',
      409,
      { currentVersion },
    );
  }

  private forbidden(): never {
    throw new DomainError(
      ErrorCode.FORBIDDEN,
      'The campus settings are outside the authenticated scope',
      403,
    );
  }

  private asJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
