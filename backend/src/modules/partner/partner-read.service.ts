import { Injectable } from '@nestjs/common';
import type { AttendanceStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PartnerScopeService } from '../../common/auth/partner-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  PartnerPageQueryDto,
  PartnerPeriodQueryDto,
  PartnerSearchQueryDto,
} from './dto/partner-query.dto';
import { resolvePartnerPeriodRange } from './partner-period';
import { lessonBalanceSelect, summarizeLessonBalances, type PackageBalance } from '../lesson-ledger/lesson-balance';

const activePackageWhere = (now: Date): Prisma.CoursePackageWhereInput => ({
  isActive: true,
  validFrom: { lte: now },
  OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
});

@Injectable()
export class PartnerReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: PartnerScopeService,
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
      students,
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
        where: { campusId: scope.campusId },
        _count: { _all: true },
      }),
      this.prisma.student.findMany({
        where: { campusId: scope.campusId, isActive: true },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        select: this.studentSelect(serverTime),
      }),
    ]);

    const balances = this.sumBalances(packages);
    const attendance = this.attendanceCounts(attendanceGroups);
    const candidates = students
      .map((student) =>
        this.toWarning(student, campus.lessonWarningThresholdUnits),
      )
      .sort(
        (left, right) =>
          left.availableTotalUnits - right.availableTotalUnits ||
          left.studentName.localeCompare(right.studentName, 'zh-CN'),
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
      highlight: candidates[0] ?? null,
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
    return {
      displayName: partner.displayName,
      roleCode: 'PARTNER' as const,
      campus,
    };
  }

  async listStudents(user: AuthenticatedUser, query: PartnerSearchQueryDto) {
    const scope = this.scopeService.require(user);
    const now = new Date();
    const keyword = query.query?.trim();
    const where: Prisma.StudentWhereInput = {
      campusId: scope.campusId,
      isActive: true,
      ...(keyword
        ? { displayName: { contains: keyword, mode: 'insensitive' } }
        : {}),
    };
    const [total, students] = await Promise.all([
      this.prisma.student.count({ where }),
      this.prisma.student.findMany({
        where,
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: this.studentSelect(now),
      }),
    ]);
    return this.page(
      students.map((student) => this.toStudent(student)),
      total,
      query,
    );
  }

  async getStudent(user: AuthenticatedUser, studentId: string) {
    const scope = this.scopeService.require(user);
    const now = new Date();
    const [student, attendanceGroups] = await Promise.all([
      this.prisma.student.findFirst({
        where: { id: studentId, campusId: scope.campusId, isActive: true },
        select: {
          id: true,
          displayName: true,
          birthDate: true,
          classMemberships: {
            where: { leftAt: null, classGroup: { status: 'ACTIVE' } },
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
            where: activePackageWhere(now),
            select: lessonBalanceSelect,
          },
          attendanceRecords: {
            orderBy: [{ lessonSession: { startsAt: 'desc' } }, { id: 'desc' }],
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
            where: { entryType: { in: ['CONSUME', 'REVERSAL'] } },
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
              coursePackage: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.attendanceRecord.groupBy({
        by: ['status'],
        where: { campusId: scope.campusId, studentId },
        _count: { _all: true },
      }),
    ]);
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
      classNames: classes.map(({ className }) => className),
      ...balances,
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
          campusId: scope.campusId,
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
          where: { id: { in: teacherGroups.map(({ teacherId }) => teacherId) } },
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
    const keyword = query.query?.trim();
    const students = await this.prisma.student.findMany({
      where: {
        campusId: scope.campusId,
        isActive: true,
        ...(keyword
          ? { displayName: { contains: keyword, mode: 'insensitive' } }
          : {}),
      },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      select: this.studentSelect(now),
    });
    const warnings = students
      .map((student) =>
        this.toWarning(student, campus.lessonWarningThresholdUnits),
      )
      .filter(
        ({ availableTotalUnits, thresholdUnits }) =>
          availableTotalUnits <= thresholdUnits,
      )
      .sort(
        (left, right) =>
          left.availableTotalUnits - right.availableTotalUnits ||
          left.studentName.localeCompare(right.studentName, 'zh-CN'),
      );
    const start = (query.page - 1) * query.pageSize;
    return this.page(
      warnings.slice(start, start + query.pageSize),
      warnings.length,
      query,
    );
  }

  async getAttendance(user: AuthenticatedUser, query: PartnerPageQueryDto) {
    const scope = this.scopeService.require(user);
    const where: Prisma.AttendanceRecordWhereInput = {
      campusId: scope.campusId,
    };
    const [groups, total, records] = await Promise.all([
      this.prisma.attendanceRecord.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.attendanceRecord.count({ where }),
      this.prisma.attendanceRecord.findMany({
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
      }),
    ]);
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
    const [total, teachers] = await Promise.all([
      this.prisma.teacherProfile.count({ where }),
      this.prisma.teacherProfile.findMany({
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
            where: { status: 'ACTIVE' },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            select: {
              name: true,
              members: {
                where: { leftAt: null, student: { isActive: true } },
                select: { studentId: true },
              },
            },
          },
          lessonSessions: {
            where: {
              status: 'COMPLETED',
              completedAt: { gte: start, lt: end },
            },
            select: { id: true },
          },
        },
      }),
    ]);
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

  async getLessonAccount(user: AuthenticatedUser, query: PartnerPageQueryDto) {
    const scope = this.scopeService.require(user);
    const now = new Date();
    const packageWhere: Prisma.CoursePackageWhereInput = {
      campusId: scope.campusId,
      ...activePackageWhere(now),
    };
    const ledgerWhere: Prisma.LessonLedgerEntryWhereInput = {
      campusId: scope.campusId,
    };
    const [packages, total, entries] = await Promise.all([
      this.prisma.coursePackage.findMany({
        where: packageWhere,
        select: lessonBalanceSelect,
      }),
      this.prisma.lessonLedgerEntry.count({ where: ledgerWhere }),
      this.prisma.lessonLedgerEntry.findMany({
        where: ledgerWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          studentId: true,
          entryType: true,
          bucket: true,
          deltaUnits: true,
          balanceBeforeUnits: true,
          balanceAfterUnits: true,
          reason: true,
          createdAt: true,
          student: { select: { displayName: true } },
          coursePackage: { select: { name: true } },
        },
      }),
    ]);
    const balances = this.sumBalances(packages);
    return {
      ...balances,
      totalBalanceUnits: balances.mainBalanceUnits + balances.giftBalanceUnits,
      items: entries.map((entry) => ({
        id: entry.id,
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
      })),
      meta: this.meta(total, query),
    };
  }

  private studentSelect(now: Date) {
    return {
      id: true,
      displayName: true,
      birthDate: true,
      classMemberships: {
        where: { leftAt: null, classGroup: { status: 'ACTIVE' as const } },
        orderBy: [{ classGroup: { name: 'asc' as const } }],
        select: { classGroup: { select: { name: true } } },
      },
      coursePackages: {
        where: activePackageWhere(now),
        select: lessonBalanceSelect,
      },
    } satisfies Prisma.StudentSelect;
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

  private sumBalances(
    packages: PackageBalance[],
  ) {
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
