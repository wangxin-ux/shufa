import { Injectable } from '@nestjs/common';
import type { AttendanceStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PartnerScopeService } from '../../common/auth/partner-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  PartnerPageQueryDto,
  PartnerLessonQueryDto,
  PartnerPeriodQueryDto,
  PartnerSearchQueryDto,
  PartnerStudentQueryDto,
} from './dto/partner-query.dto';
import { resolvePartnerPeriodRange } from './partner-period';
import {
  lessonBalanceSelect,
  summarizeLessonBalances,
  type PackageBalance,
} from '../lesson-ledger/lesson-balance';
import {
  PartnerStudentQueryService,
  partnerCompletedAttendanceWhere as completedAttendanceWhere,
} from './partner-student-query.service';
import { StoredFileService } from '../file/stored-file.service';
import {
  partnerPhotoSelect,
  toPartnerPhoto,
} from './partner-student-growth.service';
import { readPartnerEnrollmentSummary } from './partner-enrollment-summary';
import {
  partnerLedgerPackageSelect,
  toPartnerLedgerPayment,
} from './partner-ledger-payment';

const activePackageWhere = (now: Date): Prisma.CoursePackageWhereInput => ({
  isActive: true,
  validFrom: { lte: now },
  OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
});

const ledgerTeachingSelect = {
  campusId: true,
  startsAt: true,
  classGroup: { select: { campusId: true, courseName: true } },
  teacher: {
    select: { campusId: true, user: { select: { displayName: true } } },
  },
} satisfies Prisma.LessonSessionSelect;

@Injectable()
export class PartnerReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: PartnerScopeService,
    private readonly studentQuery: PartnerStudentQueryService,
    private readonly files: StoredFileService,
  ) {}

  async getDashboard(user: AuthenticatedUser) {
    const scope = this.scopeService.require(user);
    const serverTime = new Date();
    const [partner, campus] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: scope.userId, status: 'ACTIVE' },
        select: { displayName: true },
      }),
      this.prisma.campus.findUnique({
        where: { id: scope.campusId },
        select: {
          id: true,
          code: true,
          name: true,
          timezone: true,
          lessonWarningThresholdUnits: true,
        },
      }),
    ]);
    if (!partner || !campus) {
      this.forbidden();
    }

    const { start: monthStart, end: monthEnd } = resolvePartnerPeriodRange(
      'MONTH',
      undefined,
      campus.timezone,
      serverTime,
    );
    const packageWhere = activePackageWhere(serverTime);
    const [
      activeStudentCount,
      activeClassCount,
      activeTeacherCount,
      packages,
      consumed,
      attendanceGroups,
      warningPage,
    ] = await Promise.all([
      this.prisma.student.count({
        where: { campusId: scope.campusId, isActive: true },
      }),
      this.prisma.classGroup.count({
        where: { campusId: scope.campusId, status: 'ACTIVE' },
      }),
      this.prisma.teacherProfile.count({
        where: { campusId: scope.campusId, isActive: true },
      }),
      this.prisma.coursePackage.findMany({
        where: { campusId: scope.campusId, ...packageWhere },
        select: lessonBalanceSelect,
      }),
      this.prisma.lessonLedgerEntry.aggregate({
        where: {
          campusId: scope.campusId,
          createdAt: { gte: monthStart, lt: monthEnd },
          entryType: { in: ['CONSUME', 'REVERSAL'] },
        },
        _sum: { deltaUnits: true },
      }),
      this.prisma.attendanceRecord.groupBy({
        by: ['status'],
        where: completedAttendanceWhere(scope.campusId),
        _count: { _all: true },
      }),
      this.studentQuery.highlight(
        scope.campusId,
        campus.lessonWarningThresholdUnits,
        serverTime,
      ),
    ]);

    const balances = this.sumBalances(packages);
    const attendance = this.attendanceCounts(attendanceGroups);
    const highlight = warningPage.students[0];
    const personalAttendance = this.attendanceCounts(
      warningPage.attendanceGroups,
    );

    return {
      partner: { displayName: partner.displayName },
      campus,
      activeStudentCount,
      activeClassCount,
      activeTeacherCount,
      remainingMainUnits: balances.mainAvailableUnits,
      remainingGiftUnits: balances.giftAvailableUnits,
      monthConsumedUnits: Math.max(0, -(consumed._sum.deltaUnits ?? 0)),
      attendanceRateBasisPoints: this.attendanceRate(attendance),
      highlight: highlight
        ? {
            ...this.toWarning(highlight, campus.lessonWarningThresholdUnits),
            classNames: warningPage.classes.map((item) => item.className),
            classes: warningPage.classes,
            enrollmentSummary: warningPage.enrollmentSummary,
            attendance: {
              presentCount: personalAttendance.PRESENT,
              absentCount: personalAttendance.ABSENT,
              leaveCount: personalAttendance.LEAVE,
              recordedCount: personalAttendance.total,
              attendanceRateBasisPoints:
                this.attendanceRate(personalAttendance),
            },
          }
        : null,
      serverTime: serverTime.toISOString(),
    };
  }

  async getProfile(user: AuthenticatedUser) {
    const scope = this.scopeService.require(user);
    const partner = await this.prisma.user.findFirst({
      where: { id: scope.userId, status: 'ACTIVE' },
      select: {
        displayName: true,
        roles: {
          where: { roleCode: 'PARTNER', campusId: scope.campusId },
          select: {
            campus: {
              select: {
                id: true,
                code: true,
                name: true,
                timezone: true,
                contactPhone: true,
                address: true,
                lessonWarningThresholdUnits: true,
              },
            },
          },
        },
      },
    });
    const campus = partner?.roles[0]?.campus;
    if (!partner || !campus || partner.roles.length !== 1) {
      this.forbidden();
    }
    const activeStudentCount = await this.prisma.student.count({
      where: { campusId: scope.campusId, isActive: true },
    });
    return {
      displayName: partner.displayName,
      roleCode: 'PARTNER' as const,
      activeStudentCount,
      campus,
    };
  }

  async listStudents(user: AuthenticatedUser, query: PartnerStudentQueryDto) {
    const scope = this.scopeService.require(user);
    const { students, total } = await this.studentQuery.list(
      scope.campusId,
      query,
    );
    return this.page(
      students.map((student) => this.toStudent(student)),
      total,
      query,
    );
  }

  async getStudent(user: AuthenticatedUser, studentId: string) {
    const scope = this.scopeService.require(user);
    const now = new Date();
    const [student, attendanceGroups, enrollmentSummary] =
      await this.prisma.$transaction(
        async (tx) => {
          const student = await tx.student.findFirst({
            where: { id: studentId, campusId: scope.campusId, isActive: true },
            select: {
              id: true,
              displayName: true,
              birthDate: true,
              profilePhotoFile: { select: partnerPhotoSelect },
              classMemberships: {
                where: {
                  campusId: scope.campusId,
                  leftAt: null,
                  classGroup: { campusId: scope.campusId, status: 'ACTIVE' },
                },
                orderBy: [{ classGroup: { name: 'asc' } }],
                select: {
                  classGroup: {
                    select: {
                      id: true,
                      name: true,
                      courseName: true,
                      teacher: {
                        select: { user: { select: { displayName: true } } },
                      },
                    },
                  },
                },
              },
              coursePackages: {
                where: { campusId: scope.campusId, ...activePackageWhere(now) },
                select: lessonBalanceSelect,
              },
              attendanceRecords: {
                where: completedAttendanceWhere(scope.campusId),
                orderBy: [
                  { lessonSession: { startsAt: 'desc' } },
                  { id: 'desc' },
                ],
                take: 5,
                select: {
                  id: true,
                  status: true,
                  recordedAt: true,
                  lessonSession: {
                    select: {
                      startsAt: true,
                      classGroup: { select: { courseName: true } },
                      teacher: {
                        select: { user: { select: { displayName: true } } },
                      },
                    },
                  },
                },
              },
              lessonLedger: {
                where: {
                  campusId: scope.campusId,
                  entryType: { in: ['CONSUME', 'REVERSAL'] },
                },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: 5,
                select: {
                  id: true,
                  entryType: true,
                  bucket: true,
                  deltaUnits: true,
                  balanceBeforeUnits: true,
                  balanceAfterUnits: true,
                  reason: true,
                  createdAt: true,
                  coursePackage: { select: partnerLedgerPackageSelect },
                  lessonSession: { select: ledgerTeachingSelect },
                },
              },
            },
          });
          const attendanceGroups = await tx.attendanceRecord.groupBy({
            by: ['status'],
            where: { ...completedAttendanceWhere(scope.campusId), studentId },
            _count: { _all: true },
          });
          const enrollmentSummary = student
            ? await readPartnerEnrollmentSummary(tx, scope.campusId, studentId)
            : null;
          return [student, attendanceGroups, enrollmentSummary] as const;
        },
        { isolationLevel: 'RepeatableRead' },
      );
    if (!student) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'The partner student was not found',
        404,
      );
    }
    const balances = this.sumBalances(student.coursePackages);
    const attendance = this.attendanceCounts(attendanceGroups);
    const classes = student.classMemberships.map(({ classGroup }) => ({
      id: classGroup.id,
      className: classGroup.name,
      courseName: classGroup.courseName,
      teacherName: classGroup.teacher.user.displayName,
    }));
    return {
      id: student.id,
      displayName: student.displayName,
      birthDate: student.birthDate?.toISOString().slice(0, 10) ?? null,
      photo: toPartnerPhoto(this.files, student),
      enrollmentSummary,
      classNames: classes.map(({ className }) => className),
      ...balances,
      totalBalanceUnits: balances.mainBalanceUnits + balances.giftBalanceUnits,
      classes,
      attendance: {
        presentCount: attendance.PRESENT,
        absentCount: attendance.ABSENT,
        leaveCount: attendance.LEAVE,
        recordedCount: attendance.total,
        attendanceRateBasisPoints: this.attendanceRate(attendance),
      },
      recentAttendance: student.attendanceRecords.map((record) => ({
        id: record.id,
        studentId: student.id,
        studentName: student.displayName,
        courseName: record.lessonSession.classGroup.courseName,
        teacherName: record.lessonSession.teacher.user.displayName,
        startsAt: record.lessonSession.startsAt.toISOString(),
        status: record.status,
        recordedAt: record.recordedAt.toISOString(),
      })),
      recentLessonLedger: student.lessonLedger.map((entry) => ({
        id: entry.id,
        studentId: student.id,
        studentName: student.displayName,
        packageName: entry.coursePackage.name,
        entryType: entry.entryType,
        bucket: entry.bucket,
        deltaUnits: entry.deltaUnits,
        balanceBeforeUnits: entry.balanceBeforeUnits,
        balanceAfterUnits: entry.balanceAfterUnits,
        reason: entry.reason,
        createdAt: entry.createdAt.toISOString(),
        paymentContext: toPartnerLedgerPayment(
          scope.campusId,
          student.id,
          entry.coursePackage,
        ),
        teachingContext: this.toLedgerTeachingContext(
          scope.campusId,
          entry.lessonSession,
        ),
      })),
    };
  }

  async getOperationsSummary(
    user: AuthenticatedUser,
    query: PartnerPeriodQueryDto,
  ) {
    const scope = this.scopeService.require(user);
    const campus = await this.prisma.campus.findUnique({
      where: { id: scope.campusId },
      select: { timezone: true },
    });
    if (!campus) this.forbidden();
    const range = resolvePartnerPeriodRange(
      query.period,
      query.anchorDate,
      campus.timezone,
    );
    const [consumed, attendanceGroups, teacherGroups] = await Promise.all([
      this.prisma.lessonLedgerEntry.aggregate({
        where: {
          campusId: scope.campusId,
          createdAt: { gte: range.start, lt: range.end },
          entryType: { in: ['CONSUME', 'REVERSAL'] },
        },
        _sum: { deltaUnits: true },
      }),
      this.prisma.attendanceRecord.groupBy({
        by: ['status'],
        where: {
          ...completedAttendanceWhere(scope.campusId),
          recordedAt: { gte: range.start, lt: range.end },
        },
        _count: { _all: true },
      }),
      this.prisma.teachingRecord.groupBy({
        by: ['teacherId'],
        where: {
          campusId: scope.campusId,
          status: 'COMPLETED',
          completedAt: { gte: range.start, lt: range.end },
        },
        _count: { _all: true },
        _sum: { attendeeCount: true },
      }),
    ]);
    const teachers = teacherGroups.length
      ? await this.prisma.teacherProfile.findMany({
          where: {
            id: { in: teacherGroups.map(({ teacherId }) => teacherId) },
          },
          select: { id: true, user: { select: { displayName: true } } },
        })
      : [];
    const teacherNames = new Map(
      teachers.map((teacher) => [teacher.id, teacher.user.displayName]),
    );
    const attendance = this.attendanceCounts(attendanceGroups);
    const teacherMetrics = teacherGroups
      .map((group) => ({
        teacherId: group.teacherId,
        displayName: teacherNames.get(group.teacherId) ?? '未知教师',
        completedLessonCount: group._count._all,
        attendeeCount: group._sum.attendeeCount ?? 0,
      }))
      .sort(
        (left, right) =>
          right.completedLessonCount - left.completedLessonCount ||
          left.displayName.localeCompare(right.displayName, 'zh-CN'),
      );
    return {
      period: range.period,
      anchorDate: range.anchorDate,
      rangeStart: range.start.toISOString(),
      rangeEnd: range.end.toISOString(),
      consumedLessonUnits: Math.max(0, -(consumed._sum.deltaUnits ?? 0)),
      completedLessonCount: teacherMetrics.reduce(
        (total, item) => total + item.completedLessonCount,
        0,
      ),
      presentCount: attendance.PRESENT,
      absentCount: attendance.ABSENT,
      leaveCount: attendance.LEAVE,
      recordedCount: attendance.total,
      attendanceRateBasisPoints: this.attendanceRate(attendance),
      teacherMetrics,
    };
  }

  async listWarnings(user: AuthenticatedUser, query: PartnerSearchQueryDto) {
    const scope = this.scopeService.require(user);
    const now = new Date();
    const campus = await this.prisma.campus.findUnique({
      where: { id: scope.campusId },
      select: { lessonWarningThresholdUnits: true },
    });
    if (!campus) {
      this.forbidden();
    }
    const { students, total } = await this.studentQuery.warnings(
      scope.campusId,
      campus.lessonWarningThresholdUnits,
      query,
      now,
    );
    const warnings = students.map((student) =>
      this.toWarning(student, campus.lessonWarningThresholdUnits),
    );
    return this.page(warnings, total, query);
  }

  async getAttendance(user: AuthenticatedUser, query: PartnerPageQueryDto) {
    const scope = this.scopeService.require(user);
    const where: Prisma.AttendanceRecordWhereInput = {
      ...completedAttendanceWhere(scope.campusId),
    };
    const [groups, total, records] = await this.prisma.$transaction(
      async (tx) => {
        const groups = await tx.attendanceRecord.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
        });
        const total = await tx.attendanceRecord.count({ where });
        const records = await tx.attendanceRecord.findMany({
          where,
          orderBy: [{ lessonSession: { startsAt: 'desc' } }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            studentId: true,
            status: true,
            recordedAt: true,
            student: { select: { displayName: true } },
            lessonSession: {
              select: {
                startsAt: true,
                classGroup: { select: { courseName: true } },
                teacher: {
                  select: { user: { select: { displayName: true } } },
                },
              },
            },
          },
        });
        return [groups, total, records] as const;
      },
      { isolationLevel: 'RepeatableRead' },
    );
    const counts = this.attendanceCounts(groups);
    return {
      presentCount: counts.PRESENT,
      absentCount: counts.ABSENT,
      leaveCount: counts.LEAVE,
      recordedCount: counts.total,
      attendanceRateBasisPoints: this.attendanceRate(counts),
      items: records.map((record) => ({
        id: record.id,
        studentId: record.studentId,
        studentName: record.student.displayName,
        courseName: record.lessonSession.classGroup.courseName,
        teacherName: record.lessonSession.teacher.user.displayName,
        startsAt: record.lessonSession.startsAt.toISOString(),
        status: record.status,
        recordedAt: record.recordedAt.toISOString(),
      })),
      meta: this.meta(total, query),
    };
  }

  async listTeachers(user: AuthenticatedUser, query: PartnerSearchQueryDto) {
    const scope = this.scopeService.require(user);
    const now = new Date();
    const campus = await this.prisma.campus.findUnique({
      where: { id: scope.campusId },
      select: { timezone: true },
    });
    if (!campus) {
      this.forbidden();
    }
    const { start, end } = resolvePartnerPeriodRange(
      'MONTH',
      undefined,
      campus.timezone,
      now,
    );
    const keyword = query.query?.trim();
    const where: Prisma.TeacherProfileWhereInput = {
      campusId: scope.campusId,
      isActive: true,
      ...(keyword
        ? { user: { displayName: { contains: keyword, mode: 'insensitive' } } }
        : {}),
    };
    const [total, teachers] = await this.prisma.$transaction(
      async (tx) => {
        const total = await tx.teacherProfile.count({ where });
        const teachers = await tx.teacherProfile.findMany({
          where,
          orderBy: [{ user: { displayName: 'asc' } }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            employeeCode: true,
            specialties: true,
            user: { select: { displayName: true } },
            classGroups: {
              where: { campusId: scope.campusId, status: 'ACTIVE' },
              orderBy: [{ name: 'asc' }, { id: 'asc' }],
              select: {
                name: true,
                members: {
                  where: {
                    campusId: scope.campusId,
                    leftAt: null,
                    student: { campusId: scope.campusId, isActive: true },
                  },
                  select: { studentId: true },
                },
              },
            },
            lessonSessions: {
              where: {
                campusId: scope.campusId,
                classGroup: { campusId: scope.campusId },
                status: 'COMPLETED',
                completedAt: { gte: start, lt: end },
              },
              select: { id: true },
            },
          },
        });
        return [total, teachers] as const;
      },
      { isolationLevel: 'RepeatableRead' },
    );
    return this.page(
      teachers.map((teacher) => ({
        id: teacher.id,
        displayName: teacher.user.displayName,
        employeeCode: teacher.employeeCode,
        specialties: teacher.specialties,
        classNames: teacher.classGroups.map(({ name }) => name),
        activeStudentCount: new Set(
          teacher.classGroups.flatMap(({ members }) =>
            members.map(({ studentId }) => studentId),
          ),
        ).size,
        monthCompletedLessonCount: teacher.lessonSessions.length,
      })),
      total,
      query,
    );
  }

  async getLessonAccount(
    user: AuthenticatedUser,
    query: PartnerLessonQueryDto,
  ) {
    const scope = this.scopeService.require(user);
    const now = new Date();
    const packageWhere: Prisma.CoursePackageWhereInput = {
      campusId: scope.campusId,
      student: { campusId: scope.campusId },
      ...activePackageWhere(now),
    };
    const ledgerWhere: Prisma.LessonLedgerEntryWhereInput = {
      campusId: scope.campusId,
      student: { campusId: scope.campusId },
      coursePackage: { campusId: scope.campusId },
      ...(query.entryType ? { entryType: query.entryType } : {}),
      ...(query.subjectId
        ? {
            subjectId:
              query.subjectId === 'UNCLASSIFIED' ? null : query.subjectId,
          }
        : {}),
    };
    const [packages, total, entries] = await this.prisma.$transaction(
      async (tx) => {
        if (
          query.subjectId &&
          query.subjectId !== 'UNCLASSIFIED' &&
          !(await tx.campusSubject.findFirst({
            where: { id: query.subjectId, campusId: scope.campusId },
            select: { id: true },
          }))
        ) {
          throw new DomainError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Subject not found',
            404,
          );
        }
        const packages = await tx.coursePackage.findMany({
          where: packageWhere,
          select: lessonBalanceSelect,
        });
        const total = await tx.lessonLedgerEntry.count({ where: ledgerWhere });
        const entries = await tx.lessonLedgerEntry.findMany({
          where: ledgerWhere,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            studentId: true,
            subjectId: true,
            subjectName: true,
            entryType: true,
            bucket: true,
            deltaUnits: true,
            balanceBeforeUnits: true,
            balanceAfterUnits: true,
            reason: true,
            createdAt: true,
            student: { select: { displayName: true } },
            coursePackage: { select: partnerLedgerPackageSelect },
            lessonSession: { select: ledgerTeachingSelect },
          },
        });
        return [packages, total, entries] as const;
      },
      { isolationLevel: 'RepeatableRead' },
    );
    const balances = this.sumBalances(packages);
    return {
      ...balances,
      totalBalanceUnits: balances.mainBalanceUnits + balances.giftBalanceUnits,
      items: entries.map((entry) => ({
        id: entry.id,
        subject:
          entry.subjectId && entry.subjectName
            ? { id: entry.subjectId, name: entry.subjectName }
            : null,
        studentId: entry.studentId,
        studentName: entry.student.displayName,
        packageName: entry.coursePackage.name,
        entryType: entry.entryType,
        bucket: entry.bucket,
        deltaUnits: entry.deltaUnits,
        balanceBeforeUnits: entry.balanceBeforeUnits,
        balanceAfterUnits: entry.balanceAfterUnits,
        reason: entry.reason,
        createdAt: entry.createdAt.toISOString(),
        paymentContext: toPartnerLedgerPayment(
          scope.campusId,
          entry.studentId,
          entry.coursePackage,
        ),
        teachingContext: this.toLedgerTeachingContext(
          scope.campusId,
          entry.lessonSession,
        ),
      })),
      meta: this.meta(total, query),
    };
  }

  private toLedgerTeachingContext(
    campusId: string,
    lesson: Prisma.LessonSessionGetPayload<{
      select: typeof ledgerTeachingSelect;
    }> | null,
  ) {
    if (
      !lesson ||
      lesson.campusId !== campusId ||
      lesson.classGroup.campusId !== campusId ||
      lesson.teacher.campusId !== campusId
    ) {
      return null;
    }
    return {
      courseName: lesson.classGroup.courseName,
      teacherName: lesson.teacher.user.displayName,
      lessonStartsAt: lesson.startsAt.toISOString(),
    };
  }

  private toStudent(student: {
    id: string;
    displayName: string;
    birthDate: Date | null;
    classMemberships: Array<{ classGroup: { name: string } }>;
    coursePackages: PackageBalance[];
  }) {
    const balances = this.sumBalances(student.coursePackages);
    return {
      id: student.id,
      displayName: student.displayName,
      birthDate: student.birthDate?.toISOString().slice(0, 10) ?? null,
      classNames: student.classMemberships.map(
        ({ classGroup }) => classGroup.name,
      ),
      ...balances,
      totalBalanceUnits: balances.mainBalanceUnits + balances.giftBalanceUnits,
    };
  }

  private toWarning(
    student: Parameters<PartnerReadService['toStudent']>[0],
    thresholdUnits: number,
  ) {
    const view = this.toStudent(student);
    return {
      studentId: view.id,
      studentName: view.displayName,
      classNames: view.classNames,
      mainBalanceUnits: view.mainBalanceUnits,
      giftBalanceUnits: view.giftBalanceUnits,
      totalBalanceUnits: view.totalBalanceUnits,
      mainReservedUnits: view.mainReservedUnits,
      giftReservedUnits: view.giftReservedUnits,
      mainAvailableUnits: view.mainAvailableUnits,
      giftAvailableUnits: view.giftAvailableUnits,
      availableTotalUnits: view.availableTotalUnits,
      reservedTotalUnits: view.reservedTotalUnits,
      thresholdUnits,
    };
  }

  private sumBalances(packages: PackageBalance[]) {
    return summarizeLessonBalances(packages);
  }

  private attendanceCounts(
    groups: Array<{ status: AttendanceStatus; _count: { _all: number } }>,
  ) {
    const counts: Record<AttendanceStatus, number> = {
      PRESENT: 0,
      LEAVE: 0,
      ABSENT: 0,
    };
    for (const group of groups) {
      counts[group.status] = group._count._all;
    }
    return { ...counts, total: counts.PRESENT + counts.LEAVE + counts.ABSENT };
  }

  private attendanceRate(counts: { PRESENT: number; total: number }) {
    return counts.total === 0
      ? null
      : Math.round((counts.PRESENT * 10000) / counts.total);
  }

  private page<T>(data: T[], total: number, query: PartnerPageQueryDto) {
    return { data, meta: this.meta(total, query) };
  }

  private meta(total: number, query: PartnerPageQueryDto) {
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    };
  }

  private forbidden(): never {
    throw new DomainError(
      ErrorCode.FORBIDDEN,
      'The partner profile is outside the authenticated campus scope',
      403,
    );
  }
}
