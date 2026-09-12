import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  BoundParentStudent,
  ParentScope,
} from '../../common/auth/parent-scope.service';
import { ParentScopeService } from '../../common/auth/parent-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StoredFileService } from '../file/stored-file.service';
import { lessonBalanceSelect, summarizeLessonBalances } from '../lesson-ledger/lesson-balance';
import type {
  ParentCampusesQueryDto,
  ParentLeaveRequestDto,
  ParentProfileUpdateDto,
} from './dto/parent-portal.dto';

const LEAVE_CUTOFF_HOURS = 2;

@Injectable()
export class ParentPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parentScopeService: ParentScopeService,
    private readonly idempotencyService: IdempotencyService,
    private readonly storedFileService: StoredFileService,
  ) {}

  async listCampuses(query: ParentCampusesQueryDto) {
    const hasLatitude = query.latitude !== undefined;
    const hasLongitude = query.longitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        'latitude and longitude must be provided together',
        400,
      );
    }

    const campuses = await this.prisma.campus.findMany({
      where: {
        mapVisible: true,
        address: { not: null },
        latitude: { not: null },
        longitude: { not: null },
      },
      select: {
        id: true,
        name: true,
        address: true,
        contactPhone: true,
        latitude: true,
        longitude: true,
      },
    });
    const withDistance = campuses.map((campus) => {
      const latitude = Number(campus.latitude);
      const longitude = Number(campus.longitude);
      return {
        id: campus.id,
        name: campus.name,
        address: campus.address as string,
        contactPhone: campus.contactPhone,
        latitude,
        longitude,
        distanceMeters:
          query.latitude === undefined || query.longitude === undefined
            ? null
            : haversineMeters(
                query.latitude,
                query.longitude,
                latitude,
                longitude,
              ),
      };
    });
    withDistance.sort(
      (left, right) =>
        compareNullableDistance(left.distanceMeters, right.distanceMeters) ||
        left.name.localeCompare(right.name, 'zh-CN') ||
        left.id.localeCompare(right.id),
    );
    const offset = (query.page - 1) * query.pageSize;
    return {
      data: withDistance.slice(offset, offset + query.pageSize),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: withDistance.length,
        totalPages:
          withDistance.length === 0
            ? 0
            : Math.ceil(withDistance.length / query.pageSize),
      },
    };
  }

  async getHome(scope: ParentScope, requestedStudentId?: string) {
    const student = await this.parentScopeService.resolveStudent(
      scope,
      requestedStudentId,
    );
    if (!student) {
      return {
        student: null,
        nextLesson: null,
        remainingUnits: 0,
        attendanceRatePercent: null,
      };
    }

    const now = new Date();
    const [packages, nextLesson, attendanceTotal, attendancePresent] =
      await Promise.all([
        this.prisma.coursePackage.findMany({
          where: activePackageWhere(scope, student.id, now),
          select: lessonBalanceSelect,
        }),
        this.prisma.lessonSession.findFirst({
          where: {
            campusId: scope.campusId,
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
            classGroup: {
              members: { some: { studentId: student.id, leftAt: null } },
            },
          },
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            campus: { select: { name: true } },
            classGroup: { select: { courseName: true } },
            teacher: { select: { user: { select: { displayName: true } } } },
          },
        }),
        this.prisma.attendanceRecord.count({
          where: {
            campusId: scope.campusId,
            studentId: student.id,
            lessonSession: { status: 'COMPLETED' },
          },
        }),
        this.prisma.attendanceRecord.count({
          where: {
            campusId: scope.campusId,
            studentId: student.id,
            status: 'PRESENT',
            lessonSession: { status: 'COMPLETED' },
          },
        }),
      ]);

    return {
      student: toStudentView(student),
      nextLesson: nextLesson
        ? {
            id: nextLesson.id,
            startsAt: nextLesson.startsAt.toISOString(),
            endsAt: nextLesson.endsAt.toISOString(),
            campusName: nextLesson.campus.name,
            courseName: nextLesson.classGroup.courseName,
            teacherName: nextLesson.teacher.user.displayName,
          }
        : null,
      remainingUnits: summarizeLessonBalances(packages).availableTotalUnits,
      attendanceRatePercent:
        attendanceTotal === 0
          ? null
          : Math.round((attendancePresent / attendanceTotal) * 100),
    };
  }

  async getHours(scope: ParentScope, requestedStudentId?: string) {
    const student = await this.parentScopeService.resolveStudent(
      scope,
      requestedStudentId,
    );
    if (!student) {
      return {
        remainingTotalUnits: 0,
        ...summarizeLessonBalances([]),
        paidAmountFen: 0,
        validUntil: null,
        entries: [],
      };
    }

    const now = new Date();
    const [packages, entries] = await this.prisma.$transaction([
      this.prisma.coursePackage.findMany({
        where: activePackageWhere(scope, student.id, now),
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        select: {
          ...lessonBalanceSelect,
          paidAmountFen: true,
          expiresAt: true,
        },
      }),
      this.prisma.lessonLedgerEntry.findMany({
        where: { campusId: scope.campusId, studentId: student.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: {
          id: true,
          lessonSessionId: true,
          entryType: true,
          bucket: true,
          deltaUnits: true,
          reason: true,
          createdAt: true,
          actor: { select: { displayName: true } },
          coursePackage: { select: { name: true } },
          lessonSession: {
            select: {
              classGroup: { select: { courseName: true } },
              teacher: {
                select: { user: { select: { displayName: true } } },
              },
              attendanceRecords: {
                where: { studentId: student.id },
                take: 1,
                select: { status: true },
              },
            },
          },
        },
      }),
    ], { isolationLevel: 'RepeatableRead' });
    const balances = summarizeLessonBalances(packages);
    const validUntil = packages
      .map(({ expiresAt }) => expiresAt)
      .filter((value): value is Date => value !== null)
      .sort((left, right) => left.getTime() - right.getTime())[0];

    return {
      remainingTotalUnits: balances.totalBalanceUnits,
      ...balances,
      paidAmountFen: packages.reduce(
        (total, item) => total + item.paidAmountFen,
        0,
      ),
      validUntil: validUntil?.toISOString().slice(0, 10) ?? null,
      entries: entries.map((entry) => ({
        id: entry.id,
        lessonSessionId: entry.lessonSessionId,
        courseName:
          entry.lessonSession?.classGroup.courseName ??
          entry.coursePackage.name,
        teacherName:
          entry.lessonSession?.teacher.user.displayName ??
          entry.actor.displayName,
        attendanceStatus:
          entry.lessonSession?.attendanceRecords[0]?.status ?? null,
        entryType: entry.entryType,
        bucket: entry.bucket,
        deltaUnits: entry.deltaUnits,
        occurredAt: entry.createdAt.toISOString(),
        reason: entry.reason,
      })),
    };
  }

  async getLeavePage(scope: ParentScope, requestedStudentId?: string) {
    const students = await this.parentScopeService.listStudents(scope);
    const selected = await this.parentScopeService.resolveStudent(
      scope,
      requestedStudentId,
    );
    if (!selected) {
      return {
        students: [],
        lessons: [],
        records: [],
        cutoffHours: LEAVE_CUTOFF_HOURS,
      };
    }

    const [lessons, records] = await Promise.all([
      this.prisma.lessonSession.findMany({
        where: {
          campusId: scope.campusId,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          classGroup: {
            members: { some: { studentId: selected.id, leftAt: null } },
          },
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: 50,
        select: {
          id: true,
          startsAt: true,
          classGroup: { select: { courseName: true } },
        },
      }),
      this.prisma.parentLeaveRequest.findMany({
        where: {
          parentUserId: scope.userId,
          campusId: scope.campusId,
          studentId: selected.id,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: {
          id: true,
          studentId: true,
          lessonSessionId: true,
          reason: true,
          status: true,
          reviewedAt: true,
          reviewReason: true,
          reviewer: { select: { displayName: true } },
          lessonSession: {
            select: {
              startsAt: true,
              classGroup: { select: { courseName: true } },
            },
          },
        },
      }),
    ]);

    return {
      students: students.map(toStudentView),
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.classGroup.courseName,
        startsAt: lesson.startsAt.toISOString(),
      })),
      records: records.map((record) => ({
        id: record.id,
        studentId: record.studentId,
        lessonSessionId: record.lessonSessionId,
        courseName: record.lessonSession.classGroup.courseName,
        lessonStartsAt: record.lessonSession.startsAt.toISOString(),
        reason: record.reason,
        status: record.status,
        reviewerName: record.reviewer?.displayName ?? null,
        reviewedAt: record.reviewedAt?.toISOString() ?? null,
        reviewReason: record.reviewReason,
      })),
      cutoffHours: LEAVE_CUTOFF_HOURS,
    };
  }

  async submitLeave(
    scope: ParentScope,
    dto: ParentLeaveRequestDto,
    idempotencyKey: string,
  ) {
    await this.parentScopeService.resolveStudent(scope, dto.studentId);
    const route = '/parents/me/leave-requests';

    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }

      const lesson = await transaction.lessonSession.findFirst({
        where: {
          id: dto.lessonSessionId,
          campusId: scope.campusId,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          classGroup: {
            members: { some: { studentId: dto.studentId, leftAt: null } },
          },
        },
        select: {
          id: true,
          startsAt: true,
          classGroup: { select: { courseName: true } },
        },
      });
      if (!lesson) {
        throw new DomainError(
          ErrorCode.FORBIDDEN,
          'The lesson is outside the authenticated parent scope',
          403,
        );
      }
      const cutoffAt =
        lesson.startsAt.getTime() - LEAVE_CUTOFF_HOURS * 60 * 60 * 1000;
      if (Date.now() > cutoffAt) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          `Leave must be submitted at least ${LEAVE_CUTOFF_HOURS} hours before class`,
          409,
        );
      }
      const duplicate = await transaction.parentLeaveRequest.findUnique({
        where: {
          parentUserId_studentId_lessonSessionId: {
            parentUserId: scope.userId,
            studentId: dto.studentId,
            lessonSessionId: dto.lessonSessionId,
          },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'A leave request already exists for this lesson',
          409,
        );
      }

      const created = await transaction.parentLeaveRequest.create({
        data: {
          campusId: scope.campusId,
          parentUserId: scope.userId,
          studentId: dto.studentId,
          lessonSessionId: dto.lessonSessionId,
          reason: dto.reason,
        },
        select: {
          id: true,
          studentId: true,
          lessonSessionId: true,
          reason: true,
          status: true,
        },
      });
      const result = {
        ...created,
        courseName: lesson.classGroup.courseName,
        lessonStartsAt: lesson.startsAt.toISOString(),
        reviewerName: null,
        reviewedAt: null,
        reviewReason: null,
      };
      await transaction.auditLog.create({
        data: {
          campusId: scope.campusId,
          actorUserId: scope.userId,
          action: 'PARENT_LEAVE_SUBMIT',
          resourceType: 'ParentLeaveRequest',
          resourceId: created.id,
          outcome: 'SUCCESS',
          details: {
            studentId: dto.studentId,
            lessonSessionId: dto.lessonSessionId,
          },
        },
      });
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: result,
      });
      return result;
    });
  }

  async getProfile(scope: ParentScope) {
    const student = await this.parentScopeService.resolveStudent(scope);
    return {
      student: student ? toProfileStudentView(student) : null,
      unreadMessageCount: 0,
    };
  }

  async updateProfile(
    scope: ParentScope,
    dto: ParentProfileUpdateDto,
    idempotencyKey: string,
  ) {
    const student = await this.parentScopeService.resolveStudent(scope);
    if (!student) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'No bound student profile was found',
        404,
      );
    }
    const route = '/parents/me/profile';

    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }

      const current = await transaction.student.findFirst({
        where: {
          id: student.id,
          campusId: scope.campusId,
          isActive: true,
          parentBindings: {
            some: { parentUserId: scope.userId, campusId: scope.campusId },
          },
        },
        select: { profileVersion: true },
      });
      if (!current) {
        throw new DomainError(
          ErrorCode.FORBIDDEN,
          'The student is outside the authenticated parent scope',
          403,
        );
      }
      if (current.profileVersion !== dto.expectedVersion) {
        this.profileVersionConflict(current.profileVersion);
      }

      const updatedCount = await transaction.student.updateMany({
        where: {
          id: student.id,
          campusId: scope.campusId,
          profileVersion: dto.expectedVersion,
        },
        data: {
          profileAge: dto.age,
          homeAddress: dto.homeAddress || null,
          profileVersion: { increment: 1 },
        },
      });
      if (updatedCount.count !== 1) {
        const latest = await transaction.student.findUnique({
          where: { id: student.id },
          select: { profileVersion: true },
        });
        this.profileVersionConflict(
          latest?.profileVersion ?? dto.expectedVersion,
        );
      }

      const updated = await transaction.student.findUniqueOrThrow({
        where: { id: student.id },
        select: {
          id: true,
          campusId: true,
          displayName: true,
          birthDate: true,
          profileAge: true,
          homeAddress: true,
          profileVersion: true,
        },
      });
      const result = {
        student: toProfileStudentView(updated),
        unreadMessageCount: 0,
      };
      await transaction.auditLog.create({
        data: {
          campusId: scope.campusId,
          actorUserId: scope.userId,
          action: 'PARENT_PROFILE_UPDATE',
          resourceType: 'Student',
          resourceId: updated.id,
          outcome: 'SUCCESS',
          details: {
            age: dto.age,
            homeAddressUpdated: true,
            previousVersion: dto.expectedVersion,
            currentVersion: updated.profileVersion,
          },
        },
      });
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: result,
      });
      return result;
    });
  }

  async getUpdates(scope: ParentScope, requestedStudentId?: string) {
    const student = await this.parentScopeService.resolveStudent(
      scope,
      requestedStudentId,
    );
    if (!student) {
      return { records: [] };
    }

    const lessons = await this.prisma.lessonSession.findMany({
      where: {
        campusId: scope.campusId,
        status: { in: ['COMPLETED', 'REVERSED'] },
        OR: [
          { attendanceRecords: { some: { studentId: student.id } } },
          { feedback: { some: { studentId: student.id } } },
        ],
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: {
        id: true,
        startsAt: true,
        status: true,
        classGroup: { select: { courseName: true } },
        teacher: { select: { user: { select: { displayName: true } } } },
        attendanceRecords: {
          where: { studentId: student.id },
          take: 1,
          select: { status: true },
        },
        feedback: {
          where: { studentId: student.id },
          take: 1,
          select: {
            content: true,
            updatedAt: true,
            images: {
              orderBy: { sortOrder: 'asc' },
              select: {
                storedFile: {
                  select: { id: true, mimeType: true, sizeBytes: true },
                },
              },
            },
          },
        },
      },
    });

    return {
      records: lessons.map((lesson) => {
        const feedback = lesson.feedback[0];
        return {
          lessonSessionId: lesson.id,
          studentId: student.id,
          courseName: lesson.classGroup.courseName,
          teacherName: lesson.teacher.user.displayName,
          startsAt: lesson.startsAt.toISOString(),
          lessonStatus: lesson.status,
          attendanceStatus: lesson.attendanceRecords[0]?.status ?? null,
          feedback: feedback?.content ?? null,
          feedbackImages:
            feedback?.images.map(({ storedFile }) =>
              this.storedFileService.toFeedbackImageView(storedFile),
            ) ?? [],
          feedbackUpdatedAt: feedback?.updatedAt.toISOString() ?? null,
        };
      }),
    };
  }

  private profileVersionConflict(currentVersion: number): never {
    throw new DomainError(
      ErrorCode.STUDENT_PROFILE_VERSION_CONFLICT,
      'The student profile version has changed',
      409,
      { currentVersion },
    );
  }
}

function activePackageWhere(
  scope: ParentScope,
  studentId: string,
  now: Date,
): Prisma.CoursePackageWhereInput {
  return {
    campusId: scope.campusId,
    studentId,
    isActive: true,
    validFrom: { lte: now },
    OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
  };
}

function toStudentView(student: BoundParentStudent) {
  return {
    id: student.id,
    name: student.displayName,
    age: student.profileAge ?? calculateAge(student.birthDate),
  };
}

function toProfileStudentView(student: BoundParentStudent) {
  return {
    ...toStudentView(student),
    homeAddress: student.homeAddress,
    profileVersion: student.profileVersion,
  };
}

function calculateAge(birthDate: Date | null, now = new Date()): number {
  if (!birthDate) {
    return 0;
  }
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() &&
      now.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) {
    age -= 1;
  }
  return Math.max(0, age);
}

function haversineMeters(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(toLatitude - fromLatitude);
  const longitudeDelta = toRadians(toLongitude - fromLongitude);
  const fromLatitudeRadians = toRadians(fromLatitude);
  const toLatitudeRadians = toRadians(toLatitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitudeRadians) *
      Math.cos(toLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(
    6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)),
  );
}

function compareNullableDistance(
  left: number | null,
  right: number | null,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}
