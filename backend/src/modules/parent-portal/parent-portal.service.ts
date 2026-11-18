import { Injectable } from '@nestjs/common';
import { toParentLessonReviewView } from './parent-growth.models';
import { toTeacherFeedbackRatings } from '../feedback/feedback.models';
import { calculateStudentAge } from './parent-student-age';
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
import { savedOrFinalAttendanceWhere } from '../attendance/final-attendance';
import { activeLessonMemberWhere, lockRosterRelations } from '../attendance/lesson-membership';
import { lessonBalanceSelect, summarizeLessonBalances } from '../lesson-ledger/lesson-balance';
import { buildLeaveWeekWarnings, shanghaiNaturalWeek } from './parent-leave-hints';
import type {
  ParentCampusesQueryDto,
  ParentCourseCatalogQueryDto,
  ParentHoursQueryDto,
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

  async listCourseCatalog(query: ParentCourseCatalogQueryDto) {
    const products = await this.prisma.courseProduct.findMany({
      where: {
        status: 'ACTIVE',
        campus: {
          mapVisible: true, address: { not: null },
          latitude: { not: null }, longitude: { not: null },
        },
        ...(query.courseName ? { OR: [
          { courseName: query.courseName },
          { courseName: null, name: query.courseName },
        ] } : {}),
      },
      select: {
        id: true, name: true, courseName: true, classType: true,
        priceFen: true, mainUnits: true, giftUnits: true, validityDays: true,
        campus: { select: {
          id: true, name: true, address: true, contactPhone: true,
          latitude: true, longitude: true,
        } },
      },
    });
    type Quote = {
      productId: string; productName: string; classType: string; priceFen: number;
      mainUnits: number; giftUnits: number; validityDays: number;
      campus: { id: string; name: string; address: string; contactPhone: string | null; latitude: number; longitude: number };
    };
    const courses = new Map<string, Quote[]>();
    for (const product of products) {
      const courseName = product.courseName ?? product.name;
      const quotes = courses.get(courseName) ?? [];
      quotes.push({
        productId: product.id, productName: product.name, classType: product.classType ?? '常规班',
        priceFen: product.priceFen, mainUnits: product.mainUnits,
        giftUnits: product.giftUnits, validityDays: product.validityDays,
        campus: {
          ...product.campus, address: product.campus.address as string,
          latitude: Number(product.campus.latitude), longitude: Number(product.campus.longitude),
        },
      });
      courses.set(courseName, quotes);
    }
    const catalog = [...courses].sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
      .map(([courseName, quotes]) => {
        quotes.sort((left, right) =>
          classPriority(left.classType) - classPriority(right.classType) ||
          left.campus.name.localeCompare(right.campus.name, 'zh-CN') ||
          left.productId.localeCompare(right.productId));
        const types = new Map<string, Quote[]>();
        for (const quote of quotes) {
          const items = types.get(quote.classType) ?? [];
          items.push(quote);
          types.set(quote.classType, items);
        }
        return { courseName, primaryQuote: quotes[0], classTypes: [...types].map(([name, items]) => ({ name, quotes: items })) };
      });
    return {
      data: catalog.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      meta: {
        page: query.page, pageSize: query.pageSize, total: catalog.length,
        totalPages: catalog.length ? Math.ceil(catalog.length / query.pageSize) : 0,
      },
    };
  }

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
        profileSetupRequired: false,
        nextLesson: null,
        remainingUnits: 0,
        attendanceRatePercent: null,
        teachers: [],
        reminders: [],
      };
    }

    const now = new Date();
    const [packages, lessons, attendanceTotal, attendancePresent, teachers] =
      await Promise.all([
        this.prisma.coursePackage.findMany({
          where: activePackageWhere(scope, student.id, now),
          select: lessonBalanceSelect,
        }),
        this.prisma.lessonSession.findMany({
          where: {
            campusId: scope.campusId,
            AND: [{ OR: [
              { status: 'SCHEDULED', startsAt: { gte: now } },
              { status: 'IN_PROGRESS', endsAt: { gte: now } },
            ] }, activeLessonMemberWhere(scope.campusId, student.id)],
          },
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          take: 20,
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
            includedInFinalRoster: true,
            campusId: scope.campusId,
            studentId: student.id,
            lessonSession: { status: 'COMPLETED' },
          },
        }),
        this.prisma.attendanceRecord.count({
          where: {
            includedInFinalRoster: true,
            campusId: scope.campusId,
            studentId: student.id,
            status: 'PRESENT',
            lessonSession: { status: 'COMPLETED' },
          },
        }),
        this.prisma.teacherProfile.findMany({
          where: {
            campusId: scope.campusId,
            isActive: true,
            user: { status: 'ACTIVE' },
          },
          select: {
            id: true,
            specialties: true,
            user: { select: { displayName: true } },
          },
          orderBy: [{ user: { displayName: 'asc' } }, { id: 'asc' }],
        }),
      ]);

    const reminders = lessons.map((lesson) => ({
      id: lesson.id,
      startsAt: lesson.startsAt.toISOString(),
      endsAt: lesson.endsAt.toISOString(),
      campusName: lesson.campus.name,
      courseName: lesson.classGroup.courseName,
      teacherName: lesson.teacher.user.displayName,
    }));
    return {
      student: toStudentView(student),
      profileSetupRequired: !student.parentProfileCompletedAt,
      nextLesson: reminders[0] ?? null,
      reminders,
      teachers: teachers.map((teacher) => ({
        id: teacher.id,
        name: teacher.user.displayName,
        specialties: teacher.specialties,
      })),
      remainingUnits: summarizeLessonBalances(packages).availableTotalUnits,
      attendanceRatePercent:
        attendanceTotal === 0
          ? null
          : Math.round((attendancePresent / attendanceTotal) * 100),
    };
  }

  async getHours(
    scope: ParentScope,
    requestedStudentId?: string,
    query?: ParentHoursQueryDto,
  ) {
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;
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
        grantedMainUnits: 0,
        grantedGiftUnits: 0,
        courseNames: [],
        meta: { page, pageSize, total: 0, totalPages: 0 },
        entries: [],
      };
    }

    const now = new Date();
    const historyWhere = { campusId: scope.campusId, studentId: student.id };
    const entryWhere: Prisma.LessonLedgerEntryWhereInput = {
      ...historyWhere,
      ...(query?.courseName ? query.courseName === '未分类'
        ? { lessonSessionId: null }
        : { lessonSession: { classGroup: { courseName: query.courseName } } } : {}),
      ...(query?.direction === 'debit' ? { deltaUnits: { lt: 0 } } :
        query?.direction === 'credit' ? { deltaUnits: { gt: 0 } } : {}),
    };
    const [packages, entries, total, courses, unclassified] = await this.prisma.$transaction([
      this.prisma.coursePackage.findMany({
        where: activePackageWhere(scope, student.id, now),
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        select: {
          ...lessonBalanceSelect,
          paidAmountFen: true,
          expiresAt: true,
          lessonLedger: {
            where: { ...historyWhere, entryType: 'GRANT', deltaUnits: { gte: 0 } },
            select: { bucket: true, deltaUnits: true },
          },
        },
      }),
      this.prisma.lessonLedgerEntry.findMany({
        where: entryWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
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
                where: { studentId: student.id, includedInFinalRoster: true },
                take: 1,
                select: { status: true },
              },
            },
          },
        },
      }),
      this.prisma.lessonLedgerEntry.count({ where: entryWhere }),
      this.prisma.classGroup.findMany({
        where: { campusId: scope.campusId,
          lessonSessions: { some: { lessonLedger: { some: historyWhere } } } },
        distinct: ['courseName'],
        select: { courseName: true },
        orderBy: { courseName: 'asc' },
      }),
      this.prisma.lessonLedgerEntry.count({ where: { ...historyWhere, lessonSessionId: null } }),
    ], { isolationLevel: 'RepeatableRead' });
    const balances = summarizeLessonBalances(packages);
    const validUntil = packages
      .map(({ expiresAt }) => expiresAt)
      .filter((value): value is Date => value !== null)
      .sort((left, right) => left.getTime() - right.getTime())[0];
    const grantTotal = (bucket: 'MAIN' | 'GIFT'): number | null => {
      // A missing original bucket must not become a guessed zero or a balance-derived grant.
      if (packages.some((item) => !item.lessonLedger.some((entry) => entry.bucket === bucket))) return null;
      return packages.reduce((sum, item) => sum + item.lessonLedger
        .filter((entry) => entry.bucket === bucket)
        .reduce((units, entry) => units + entry.deltaUnits, 0), 0);
    };

    return {
      remainingTotalUnits: balances.totalBalanceUnits,
      ...balances,
      paidAmountFen: packages.reduce(
        (total, item) => total + item.paidAmountFen,
        0,
      ),
      validUntil: validUntil?.toISOString().slice(0, 10) ?? null,
      grantedMainUnits: grantTotal('MAIN'),
      grantedGiftUnits: grantTotal('GIFT'),
      courseNames: [...new Set([...courses.map((item) => item.courseName), ...(unclassified ? ['未分类'] : [])])],
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
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
        weeklyWarnings: [],
      };
    }

    const [lessons, records] = await Promise.all([
      this.prisma.lessonSession.findMany({
        where: {
          campusId: scope.campusId,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          startsAt: { gt: new Date(Date.now() + LEAVE_CUTOFF_HOURS * 60 * 60 * 1000) },
          ...activeLessonMemberWhere(scope.campusId, selected.id),
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
      weeklyWarnings: await this.getLeaveWeekWarnings(this.prisma, scope, selected.id, [
        new Date(), ...lessons.map((lesson) => lesson.startsAt),
        ...records.map((record) => record.lessonSession.startsAt),
      ]),
    };
  }

  private async getLeaveWeekWarnings(
    database: Prisma.TransactionClient,
    scope: ParentScope,
    studentId: string,
    dates: readonly Date[],
  ) {
    const weeks = [...new Map(dates.map((date) => {
      const week = shanghaiNaturalWeek(date);
      return [week.weekStart, week] as const;
    })).values()];
    const [campus, lessons] = await Promise.all([
      database.campus.findUniqueOrThrow({ where: { id: scope.campusId }, select: { name: true, contactPhone: true } }),
      database.lessonSession.findMany({
        where: {
          campusId: scope.campusId, status: { notIn: ['CANCELLED', 'REVERSED'] },
          AND: [
            { OR: weeks.map((week) => ({ startsAt: { gte: week.from, lt: week.to } })) },
            { OR: [
              { status: { not: 'COMPLETED' } },
              { attendanceRecords: { some: { studentId, campusId: scope.campusId, includedInFinalRoster: true } } },
            ] },
            { OR: [
              { classGroup: { members: { some: { studentId, campusId: scope.campusId } } } },
              { temporaryMembers: { some: { studentId, campusId: scope.campusId } } },
              { parentLeaveRequests: { some: { studentId, campusId: scope.campusId } } },
              { attendanceRecords: { some: { studentId, campusId: scope.campusId, ...savedOrFinalAttendanceWhere } } },
            ] },
          ],
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true, startsAt: true,
          classGroup: { select: { members: {
            where: { studentId, campusId: scope.campusId }, select: { joinedAt: true, leftAt: true },
          } } },
          temporaryMembers: {
            where: { studentId, campusId: scope.campusId },
            select: { joinedAt: true, removedAt: true },
          },
          parentLeaveRequests: { where: { studentId, campusId: scope.campusId }, select: { status: true } },
          attendanceRecords: { where: { studentId, campusId: scope.campusId, ...savedOrFinalAttendanceWhere }, select: { status: true }, take: 1 },
        },
      }),
    ]);
    const relevant = lessons.filter((lesson) => lesson.parentLeaveRequests.length > 0 ||
      lesson.attendanceRecords.length > 0 || lesson.classGroup.members.some((member) =>
        member.joinedAt <= lesson.startsAt && (member.leftAt === null || member.leftAt > lesson.startsAt)) ||
      lesson.temporaryMembers.some((member) =>
        member.joinedAt <= lesson.startsAt && (member.removedAt === null || member.removedAt > lesson.startsAt)));
    return buildLeaveWeekWarnings(relevant.map((lesson) => ({
      id: lesson.id, startsAt: lesson.startsAt,
      leaveStatuses: lesson.parentLeaveRequests.map((leave) => leave.status),
      attendanceStatus: lesson.attendanceRecords[0]?.status ?? null,
    }))).map((warning) => ({ ...warning, campusName: campus.name, contactPhone: campus.contactPhone }));
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

      const lockedLessons = await transaction.$queryRaw<Array<{ id: string; campusId: string; classGroupId: string }>>`
        SELECT "id", "campusId", "classGroupId" FROM "LessonSession"
        WHERE "id" = ${dto.lessonSessionId}::uuid AND "campusId" = ${scope.campusId}::uuid FOR UPDATE
      `;
      if (!lockedLessons[0])
        throw new DomainError(ErrorCode.FORBIDDEN, 'The lesson is outside the authenticated parent scope', 403);
      await lockRosterRelations(transaction, lockedLessons[0], false);
      // Serialize same-student requests so the second concurrent leave sees the first.
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT s."id" FROM "Student" s
        JOIN "ParentStudentBinding" b ON b."studentId" = s."id"
        WHERE s."id" = ${dto.studentId}::uuid AND s."campusId" = ${scope.campusId}::uuid
          AND s."isActive" = true AND b."parentUserId" = ${scope.userId}::uuid
          AND b."campusId" = ${scope.campusId}::uuid
        FOR UPDATE OF s FOR SHARE OF b
      `;
      if (!locked.length) throw new DomainError(ErrorCode.FORBIDDEN, 'The student is outside the parent scope', 403);

      const lesson = await transaction.lessonSession.findFirst({
        where: {
          id: dto.lessonSessionId,
          campusId: scope.campusId,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          ...activeLessonMemberWhere(scope.campusId, dto.studentId),
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

      const regular = await transaction.classMember.findFirst({
        where: { campusId: scope.campusId, classGroupId: lockedLessons[0].classGroupId,
          studentId: dto.studentId, leftAt: null },
        select: { id: true },
      });
      const temporary = regular ? null : await transaction.lessonTemporaryMember.findFirst({
        where: { campusId: scope.campusId, lessonSessionId: dto.lessonSessionId,
          studentId: dto.studentId, removedAt: null },
        select: { id: true },
      });
      if (!regular && !temporary)
        throw new DomainError(ErrorCode.FORBIDDEN, 'The lesson membership is unavailable', 403);
      const created = await transaction.parentLeaveRequest.create({
        data: {
          campusId: scope.campusId,
          parentUserId: scope.userId,
          studentId: dto.studentId,
          lessonSessionId: dto.lessonSessionId,
          temporaryMemberId: temporary?.id ?? null,
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
        contactWarning: (await this.getLeaveWeekWarnings(transaction, scope, dto.studentId, [lesson.startsAt]))[0] ?? null,
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
        select: { profileVersion: true, parentProfileCompletedAt: true },
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
      if (current.parentProfileCompletedAt && dto.age !== undefined) {
        throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Age is calculated from the student birth date', 400);
      }

      const updatedCount = await transaction.student.updateMany({
        where: {
          id: student.id,
          campusId: scope.campusId,
          profileVersion: dto.expectedVersion,
        },
        data: {
          ...(dto.age === undefined ? {} : { profileAge: dto.age }),
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
          parentProfileCompletedAt: true,
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
            ageUpdated: dto.age !== undefined,
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
      return { student: null, records: [] };
    }

    const lessons = await this.prisma.lessonSession.findMany({
      where: {
        campusId: scope.campusId,
        status: { in: ['COMPLETED', 'REVERSED'] },
        OR: [
          { attendanceRecords: { some: { studentId: student.id, includedInFinalRoster: true } } },
          { feedback: { some: { studentId: student.id } } },
        ],
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: {
        id: true,
        startsAt: true,
        status: true,
        campus: { select: { name: true } },
        parentLessonReviews: { where: { studentId: student.id, campusId: scope.campusId } },
        classGroup: { select: { courseName: true } },
        teacher: { select: { user: { select: { displayName: true } } } },
        attendanceRecords: {
          where: { studentId: student.id, includedInFinalRoster: true },
          take: 1,
          select: { status: true },
        },
        feedback: {
          where: { studentId: student.id },
          take: 1,
          select: {
            content: true,
            performanceRating: true,
            teacherRatings: true,
            version: true,
            teacher: { select: { user: { select: { displayName: true } } } },
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

    const photo = await this.prisma.student.findUniqueOrThrow({
      where: { id: student.id },
      select: { profilePhotoFile: { select: { id: true, mimeType: true, sizeBytes: true } } },
    });
    return {
      student: { ...toStudentView(student), profileVersion: student.profileVersion,
        photo: photo.profilePhotoFile ? this.storedFileService.toStudentPhotoView(photo.profilePhotoFile) : null },
      records: lessons.map((lesson) => {
        const feedback = lesson.feedback[0];
        const review = lesson.parentLessonReviews[0];
        return {
          lessonSessionId: lesson.id,
          studentId: student.id,
          courseName: lesson.classGroup.courseName,
          campusName: lesson.campus.name,
          teacherName: lesson.teacher.user.displayName,
          startsAt: lesson.startsAt.toISOString(),
          lessonStatus: lesson.status,
          attendanceStatus: lesson.attendanceRecords[0]?.status ?? null,
          feedback: feedback?.content ?? null,
          performanceRating: feedback?.performanceRating ?? null,
          teacherRatings: toTeacherFeedbackRatings(feedback?.teacherRatings ?? null),
          feedbackVersion: feedback?.version ?? 0,
          feedbackAuthorName: feedback?.teacher.user.displayName ?? null,
          review: review ? toParentLessonReviewView(review, lesson.status) : null,
          canReview: lesson.status === 'COMPLETED' && lesson.attendanceRecords[0]?.status === 'PRESENT' && !review,
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
    age: student.profileAge ?? calculateStudentAge(student.birthDate),
  };
}

function toProfileStudentView(student: BoundParentStudent) {
  return {
    ...toStudentView(student),
    homeAddress: student.homeAddress,
    profileVersion: student.profileVersion,
    profileSetupCompleted: !!student.parentProfileCompletedAt,
  };
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

function classPriority(name: string): number {
  return name === '学习班' || name === '常规班' ? 0 : 1;
}
