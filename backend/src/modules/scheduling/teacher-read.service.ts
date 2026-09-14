import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TeacherScope } from '../../common/auth/teacher-scope.service';
import { TeacherScopeService } from '../../common/auth/teacher-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StoredFileService } from '../file/stored-file.service';
import type {
  DateRangeQueryDto,
  LessonSessionsQueryDto,
  StudentsQueryDto,
} from './dto/teacher-read-query.dto';
import type {
  PageView,
  TeacherIdentityView,
  TeacherLessonSummaryView,
} from './teacher-read.models';

type LessonSummaryRow = Prisma.LessonSessionGetPayload<{
  select: {
    id: true;
    version: true;
    startsAt: true;
    endsAt: true;
    lessonUnits: true;
    status: true;
    campus: { select: { name: true } };
    classGroup: { select: { name: true; courseName: true } };
  };
}> & { studentCount: number };

interface TeacherIdentityRecord extends TeacherIdentityView {
  timezone: string;
}

@Injectable()
export class TeacherReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teacherScopeService: TeacherScopeService,
    private readonly storedFileService: StoredFileService,
  ) {}

  async getDashboard(scope: TeacherScope) {
    const serverTime = new Date();
    const teacher = await this.readTeacherIdentity(scope);
    const { start, end } = this.zonedDayBounds(serverTime, teacher.timezone);
    const baseWhere: Prisma.LessonSessionWhereInput = {
      campusId: scope.campusId,
      teacherId: scope.teacherProfileId,
    };
    const [
      responsibleStudentCount,
      nextLesson,
      todayPendingCount,
      todayCompletedCount,
    ] = await Promise.all([
      this.countResponsibleStudents(scope),
      this.prisma.lessonSession.findFirst({
        where: {
          ...baseWhere,
          startsAt: { gte: serverTime },
          status: { notIn: ['COMPLETED', 'REVERSED', 'CANCELLED'] },
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          version: true,
          startsAt: true,
          endsAt: true,
          lessonUnits: true,
          status: true,
          campus: { select: { name: true } },
          classGroup: {
            select: {
              name: true,
              courseName: true,
              _count: {
                select: { members: { where: { leftAt: null } } },
              },
            },
          },
        },
      }),
      this.prisma.lessonSession.count({
        where: {
          ...baseWhere,
          startsAt: { gte: start, lt: end },
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        },
      }),
      this.prisma.lessonSession.count({
        where: {
          ...baseWhere,
          startsAt: { gte: start, lt: end },
          status: 'COMPLETED',
        },
      }),
    ]);

    return {
      teacher: this.publicIdentity(teacher),
      nextLesson: nextLesson
        ? this.toLessonSummary({
            ...nextLesson,
            studentCount: nextLesson.classGroup._count.members,
          })
        : null,
      todayPendingCount,
      todayCompletedCount,
      responsibleStudentCount,
      serverTime: serverTime.toISOString(),
    };
  }

  async getProfile(scope: TeacherScope) {
    const [teacher, responsibleStudentCount] = await Promise.all([
      this.readTeacherIdentity(scope),
      this.countResponsibleStudents(scope),
    ]);

    return {
      ...this.publicIdentity(teacher),
      responsibleStudentCount,
      roleCode: 'TEACHER' as const,
    };
  }

  async listLessonSessions(
    scope: TeacherScope,
    query: LessonSessionsQueryDto,
  ): Promise<PageView<TeacherLessonSummaryView>> {
    const startsAt = this.dateRange(query.from, query.to);
    const where: Prisma.LessonSessionWhereInput = {
      campusId: scope.campusId,
      teacherId: scope.teacherProfileId,
      ...(startsAt ? { startsAt } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.lessonSession.findMany({
        where,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          version: true,
          startsAt: true,
          endsAt: true,
          lessonUnits: true,
          status: true,
          campus: { select: { name: true } },
          classGroup: {
            select: {
              name: true,
              courseName: true,
              _count: {
                select: { members: { where: { leftAt: null } } },
              },
            },
          },
        },
      }),
      this.prisma.lessonSession.count({ where }),
    ]);

    return this.page(
      rows.map((row) =>
        this.toLessonSummary({
          ...row,
          studentCount: row.classGroup._count.members,
        }),
      ),
      query.page,
      query.pageSize,
      total,
    );
  }

  async getLessonSession(scope: TeacherScope, lessonSessionId: string) {
    await this.teacherScopeService.assertLessonSessionInScope(
      scope,
      lessonSessionId,
    );
    const lesson = await this.prisma.lessonSession.findFirst({
      where: {
        id: lessonSessionId,
        campusId: scope.campusId,
        teacherId: scope.teacherProfileId,
      },
      select: {
        id: true,
        version: true,
        startsAt: true,
        endsAt: true,
        lessonUnits: true,
        status: true,
        completedAt: true,
        campus: { select: { name: true } },
        classGroup: {
          select: {
            name: true,
            courseName: true,
            members: {
              where: { leftAt: null },
              select: {
                student: { select: { id: true, displayName: true } },
              },
            },
          },
        },
        attendanceRecords: {
          select: { studentId: true, status: true },
        },
        parentLeaveRequests: {
          where: { status: 'APPROVED' },
          select: { studentId: true },
        },
        feedback: {
          where: { teacherId: scope.teacherProfileId },
          select: {
            studentId: true,
            content: true,
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
    if (!lesson) {
      this.forbidden();
    }

    const attendanceByStudent = new Map(
      lesson.attendanceRecords.map(({ studentId, status }) => [
        studentId,
        status,
      ]),
    );
    const approvedLeaveStudents = new Set(
      lesson.parentLeaveRequests.map(({ studentId }) => studentId),
    );
    const feedbackByStudent = new Map(
      lesson.feedback.map((feedback) => [feedback.studentId, feedback]),
    );
    const members = [...lesson.classGroup.members].sort((left, right) =>
      left.student.displayName.localeCompare(right.student.displayName),
    );
    const canReverse =
      lesson.status === 'COMPLETED' &&
      lesson.completedAt !== null &&
      Date.now() - lesson.completedAt.getTime() <= 24 * 60 * 60 * 1_000;

    return {
      ...this.toLessonSummary({
        ...lesson,
        studentCount: members.length,
      }),
      attendancePolicy: {
        PRESENT: { consumesLessonUnits: true as const },
        LEAVE: { consumesLessonUnits: false },
        ABSENT: { consumesLessonUnits: false },
      },
      students: members.map(({ student }) => {
        const attendanceStatus =
          attendanceByStudent.get(student.id) ??
          (approvedLeaveStudents.has(student.id) ? 'LEAVE' : null);
        const feedback = feedbackByStudent.get(student.id);
        return {
          id: student.id,
          displayName: student.displayName,
          attendanceStatus,
          expectedConsumeUnits:
            attendanceStatus === 'PRESENT' ? lesson.lessonUnits : 0,
          feedback: feedback?.content ?? null,
          feedbackImages:
            feedback?.images.map(({ storedFile }) =>
              this.storedFileService.toFeedbackImageView(storedFile),
            ) ?? [],
        };
      }),
      canComplete: ['SCHEDULED', 'IN_PROGRESS'].includes(lesson.status),
      canReverse,
    };
  }

  async listStudents(scope: TeacherScope, query: StudentsQueryDto) {
    const now = new Date();
    const membershipWhere: Prisma.ClassMemberWhereInput = {
      campusId: scope.campusId,
      leftAt: null,
      classGroup: {
        campusId: scope.campusId,
        teacherId: scope.teacherProfileId,
        status: 'ACTIVE',
      },
    };
    const normalizedQuery = query.query?.trim();
    const where: Prisma.StudentWhereInput = {
      campusId: scope.campusId,
      isActive: true,
      classMemberships: { some: membershipWhere },
      ...(normalizedQuery
        ? { displayName: { contains: normalizedQuery, mode: 'insensitive' } }
        : {}),
    };
    const [students, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          displayName: true,
          classMemberships: {
            where: membershipWhere,
            select: {
              classGroup: {
                select: {
                  name: true,
                  lessonSessions: {
                    where: {
                      campusId: scope.campusId,
                      teacherId: scope.teacherProfileId,
                      startsAt: { gte: now },
                      status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
                    },
                    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
                    take: 1,
                    select: { startsAt: true },
                  },
                },
              },
            },
          },
          feedback: {
            where: {
              campusId: scope.campusId,
              teacherId: scope.teacherProfileId,
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { updatedAt: true },
          },
        },
      }),
      this.prisma.student.count({ where }),
    ]);

    return this.page(
      students.map((student) => {
        const nextStarts = student.classMemberships
          .flatMap(({ classGroup }) => classGroup.lessonSessions)
          .map(({ startsAt }) => startsAt)
          .sort((left, right) => left.getTime() - right.getTime())[0];

        return {
          id: student.id,
          displayName: student.displayName,
          classNames: [
            ...new Set(
              student.classMemberships.map(({ classGroup }) => classGroup.name),
            ),
          ].sort(),
          nextLessonAt: nextStarts?.toISOString() ?? null,
          latestFeedbackAt:
            student.feedback[0]?.updatedAt.toISOString() ?? null,
        };
      }),
      query.page,
      query.pageSize,
      total,
    );
  }

  async getStudent(scope: TeacherScope, studentId: string) {
    const membershipWhere: Prisma.ClassMemberWhereInput = {
      campusId: scope.campusId,
      leftAt: null,
      classGroup: {
        campusId: scope.campusId,
        teacherId: scope.teacherProfileId,
        status: 'ACTIVE',
      },
    };
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        campusId: scope.campusId,
        isActive: true,
        classMemberships: { some: membershipWhere },
      },
      select: {
        id: true,
        displayName: true,
        classMemberships: {
          where: membershipWhere,
          select: {
            classGroup: {
              select: { id: true, name: true, courseName: true },
            },
          },
        },
      },
    });
    if (!student) {
      this.forbidden();
    }

    const attendanceWhere: Prisma.AttendanceRecordWhereInput = {
      campusId: scope.campusId,
      studentId,
      lessonSession: {
        campusId: scope.campusId,
        teacherId: scope.teacherProfileId,
      },
    };
    const [nextLesson, attendanceGroups, recentAttendance, latestFeedback] =
      await Promise.all([
        this.prisma.lessonSession.findFirst({
          where: {
            campusId: scope.campusId,
            teacherId: scope.teacherProfileId,
            startsAt: { gte: new Date() },
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
            classGroup: {
              members: { some: { studentId, leftAt: null } },
            },
          },
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            classGroup: {
              select: { name: true, courseName: true },
            },
          },
        }),
        this.prisma.attendanceRecord.groupBy({
          by: ['status'],
          where: attendanceWhere,
          _count: { _all: true },
        }),
        this.prisma.attendanceRecord.findMany({
          where: attendanceWhere,
          orderBy: [{ lessonSession: { startsAt: 'desc' } }, { id: 'desc' }],
          take: 5,
          select: {
            id: true,
            status: true,
            lessonSession: {
              select: {
                startsAt: true,
                classGroup: { select: { courseName: true } },
              },
            },
          },
        }),
        this.prisma.studentFeedback.findFirst({
          where: {
            campusId: scope.campusId,
            studentId,
            teacherId: scope.teacherProfileId,
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          select: {
            content: true,
            updatedAt: true,
            lessonSession: {
              select: { classGroup: { select: { courseName: true } } },
            },
          },
        }),
      ]);

    const attendanceCounts = new Map(
      attendanceGroups.map(({ status, _count }) => [status, _count._all]),
    );
    const presentCount = attendanceCounts.get('PRESENT') ?? 0;
    const leaveCount = attendanceCounts.get('LEAVE') ?? 0;
    const absentCount = attendanceCounts.get('ABSENT') ?? 0;
    const recordedCount = presentCount + leaveCount + absentCount;
    const classes = student.classMemberships
      .map(({ classGroup }) => ({
        id: classGroup.id,
        className: classGroup.name,
        courseName: classGroup.courseName,
      }))
      .sort((left, right) => left.className.localeCompare(right.className));

    return {
      id: student.id,
      displayName: student.displayName,
      classNames: classes.map(({ className }) => className),
      nextLessonAt: nextLesson?.startsAt.toISOString() ?? null,
      latestFeedbackAt: latestFeedback?.updatedAt.toISOString() ?? null,
      classes,
      nextLesson: nextLesson
        ? {
            id: nextLesson.id,
            className: nextLesson.classGroup.name,
            courseName: nextLesson.classGroup.courseName,
            startsAt: nextLesson.startsAt.toISOString(),
            endsAt: nextLesson.endsAt.toISOString(),
          }
        : null,
      attendance: {
        presentCount,
        leaveCount,
        absentCount,
        recordedCount,
        attendanceRateBasisPoints:
          recordedCount === 0
            ? 0
            : Math.round((presentCount / recordedCount) * 10_000),
      },
      recentAttendance: recentAttendance.map((record) => ({
        id: record.id,
        courseName: record.lessonSession.classGroup.courseName,
        startsAt: record.lessonSession.startsAt.toISOString(),
        status: record.status,
      })),
      latestFeedback: latestFeedback
        ? {
            content: latestFeedback.content,
            courseName: latestFeedback.lessonSession.classGroup.courseName,
            updatedAt: latestFeedback.updatedAt.toISOString(),
          }
        : null,
    };
  }

  async listTeachingRecords(scope: TeacherScope, query: DateRangeQueryDto) {
    const startsAt = this.dateRange(query.from, query.to);
    const where: Prisma.TeachingRecordWhereInput = {
      campusId: scope.campusId,
      teacherId: scope.teacherProfileId,
      lessonSession: {
        campusId: scope.campusId,
        teacherId: scope.teacherProfileId,
        ...(startsAt ? { startsAt } : {}),
      },
    };
    const [records, total] = await Promise.all([
      this.prisma.teachingRecord.findMany({
        where,
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          lessonSessionId: true,
          attendeeCount: true,
          lessonUnits: true,
          status: true,
          lessonSession: {
            select: {
              startsAt: true,
              endsAt: true,
              classGroup: { select: { name: true, courseName: true } },
              _count: {
                select: {
                  attendanceRecords: true,
                  feedback: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.teachingRecord.count({ where }),
    ]);

    return this.page(
      records.map((record) => ({
        id: record.id,
        lessonSessionId: record.lessonSessionId,
        className: record.lessonSession.classGroup.name,
        courseName: record.lessonSession.classGroup.courseName,
        startsAt: record.lessonSession.startsAt.toISOString(),
        endsAt: record.lessonSession.endsAt.toISOString(),
        attendeeCount: record.attendeeCount,
        lessonUnits: record.lessonUnits,
        feedbackCompletedCount: record.lessonSession._count.feedback,
        feedbackRequiredCount: record.lessonSession._count.attendanceRecords,
        status: record.status,
      })),
      query.page,
      query.pageSize,
      total,
    );
  }

  async listLessonLedger(scope: TeacherScope, query: DateRangeQueryDto) {
    const createdAt = this.dateRange(query.from, query.to);
    const where: Prisma.LessonLedgerEntryWhereInput = {
      campusId: scope.campusId,
      actorUserId: scope.userId,
      lessonSessionId: { not: null },
      lessonSession: {
        campusId: scope.campusId,
        teacherId: scope.teacherProfileId,
      },
      ...(createdAt ? { createdAt } : {}),
    };
    const [entries, total] = await Promise.all([
      this.prisma.lessonLedgerEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          lessonSessionId: true,
          studentId: true,
          entryType: true,
          bucket: true,
          deltaUnits: true,
          createdAt: true,
          student: { select: { displayName: true } },
        },
      }),
      this.prisma.lessonLedgerEntry.count({ where }),
    ]);

    return this.page(
      entries.map((entry) => ({
        id: entry.id,
        lessonSessionId: entry.lessonSessionId as string,
        studentId: entry.studentId,
        studentName: entry.student.displayName,
        occurredAt: entry.createdAt.toISOString(),
        entryType: entry.entryType,
        bucket: entry.bucket,
        deltaUnits: entry.deltaUnits,
      })),
      query.page,
      query.pageSize,
      total,
    );
  }

  private async readTeacherIdentity(
    scope: TeacherScope,
  ): Promise<TeacherIdentityRecord> {
    const teacher = await this.prisma.teacherProfile.findFirst({
      where: {
        id: scope.teacherProfileId,
        userId: scope.userId,
        campusId: scope.campusId,
        isActive: true,
      },
      select: {
        specialties: true,
        user: { select: { displayName: true } },
        campus: { select: { name: true, timezone: true } },
      },
    });
    if (!teacher) {
      this.forbidden();
    }

    return {
      displayName: teacher.user.displayName,
      subjectLabel: teacher.specialties.join(' / ') || 'Teacher',
      campusName: teacher.campus.name,
      timezone: teacher.campus.timezone,
    };
  }

  private countResponsibleStudents(scope: TeacherScope): Promise<number> {
    return this.prisma.student.count({
      where: {
        campusId: scope.campusId,
        isActive: true,
        classMemberships: {
          some: {
            campusId: scope.campusId,
            leftAt: null,
            classGroup: {
              campusId: scope.campusId,
              teacherId: scope.teacherProfileId,
              status: 'ACTIVE',
            },
          },
        },
      },
    });
  }

  private toLessonSummary(row: LessonSummaryRow): TeacherLessonSummaryView {
    return {
      id: row.id,
      version: row.version,
      className: row.classGroup.name,
      courseName: row.classGroup.courseName,
      campusName: row.campus.name,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      lessonUnits: row.lessonUnits,
      status: row.status,
      studentCount: row.studentCount,
    };
  }

  private publicIdentity(teacher: TeacherIdentityRecord): TeacherIdentityView {
    return {
      displayName: teacher.displayName,
      subjectLabel: teacher.subjectLabel,
      campusName: teacher.campusName,
    };
  }

  private page<T>(
    data: T[],
    page: number,
    pageSize: number,
    total: number,
  ): PageView<T> {
    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  private dateRange(
    from?: string,
    to?: string,
  ): Prisma.DateTimeFilter | undefined {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if (fromDate && toDate && fromDate >= toDate) {
      throw new DomainError(
        ErrorCode.BAD_REQUEST,
        'The from date-time must be earlier than the to date-time',
        400,
      );
    }

    return fromDate || toDate
      ? {
          ...(fromDate ? { gte: fromDate } : {}),
          ...(toDate ? { lt: toDate } : {}),
        }
      : undefined;
  }

  private zonedDayBounds(now: Date, timeZone: string) {
    const local = this.zonedParts(now, timeZone);
    const nextDate = new Date(
      Date.UTC(local.year, local.month - 1, local.day + 1),
    );

    return {
      start: this.zonedMidnightToUtc(
        local.year,
        local.month,
        local.day,
        timeZone,
      ),
      end: this.zonedMidnightToUtc(
        nextDate.getUTCFullYear(),
        nextDate.getUTCMonth() + 1,
        nextDate.getUTCDate(),
        timeZone,
      ),
    };
  }

  private zonedMidnightToUtc(
    year: number,
    month: number,
    day: number,
    timeZone: string,
  ): Date {
    const desired = Date.UTC(year, month - 1, day);
    let candidate = desired;
    for (let index = 0; index < 3; index += 1) {
      const observed = this.zonedParts(new Date(candidate), timeZone);
      candidate +=
        desired -
        Date.UTC(
          observed.year,
          observed.month - 1,
          observed.day,
          observed.hour,
          observed.minute,
          observed.second,
        );
    }
    return new Date(candidate);
  }

  private zonedParts(date: Date, timeZone: string) {
    const values = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(date)
        .map(({ type, value }) => [type, value]),
    );

    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
      second: Number(values.second),
    };
  }

  private forbidden(): never {
    throw new DomainError(
      ErrorCode.FORBIDDEN,
      'The teacher profile is outside the authenticated scope',
      403,
    );
  }
}
