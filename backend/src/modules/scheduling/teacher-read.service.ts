import { readPartnerEnrollmentSummary } from '../partner/partner-enrollment-summary';
import { toTeacherFeedbackRatings } from '../feedback/feedback.models';
import {
  lessonBalanceSelect,
  summarizeLessonBalances,
} from '../lesson-ledger/lesson-balance';
import { Injectable } from '@nestjs/common';
import { toParentLessonReviewView } from '../parent-portal/parent-growth.models';
import { Prisma } from '@prisma/client';
import type { TeacherScope } from '../../common/auth/teacher-scope.service';
import { TeacherScopeService } from '../../common/auth/teacher-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StoredFileService } from '../file/stored-file.service';
import { REVERSAL_WINDOW_MS } from '../attendance/lesson-reversal-window';
import type {
  DateRangeQueryDto,
  LessonSessionsQueryDto,
  StudentsQueryDto,
  StudentDetailQueryDto,
} from './dto/teacher-read-query.dto';
import type {
  PageView,
  TeacherIdentityView,
  TeacherLessonSummaryView,
} from './teacher-read.models';
import {
  summarizeTeacherLessonRoster,
  teacherRosterSummarySelect,
  activeApprovedLeaveStudentIds,
} from './teacher-roster-summary';
import type { TeacherRosterSummaryRow } from './teacher-roster-summary';

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
    return this.prisma.$transaction(
      async (tx) => {
        const teacher = await this.readTeacherIdentity(scope, tx);
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
          this.countResponsibleStudents(scope, tx),
          tx.lessonSession.findFirst({
            where: {
              ...baseWhere,
              startsAt: { gte: serverTime },
              status: { notIn: ['COMPLETED', 'REVERSED', 'CANCELLED'] },
            },
            orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
            select: teacherRosterSummarySelect(scope.campusId, serverTime),
          }),
          tx.lessonSession.count({
            where: {
              ...baseWhere,
              startsAt: { gte: start, lt: end },
              status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
            },
          }),
          tx.lessonSession.count({
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
            ? this.toRosterLessonSummary(nextLesson, serverTime)
            : null,
          todayPendingCount,
          todayCompletedCount,
          responsibleStudentCount,
          serverTime: serverTime.toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
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
    const asOf = new Date();
    return this.prisma.$transaction(
      async (tx) => {
        const [rows, total] = await Promise.all([
          tx.lessonSession.findMany({
            where,
            orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
            select: teacherRosterSummarySelect(scope.campusId, asOf),
          }),
          tx.lessonSession.count({ where }),
        ]);
        return this.page(
          rows.map((row) => this.toRosterLessonSummary(row, asOf)),
          query.page,
          query.pageSize,
          total,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async getLessonSession(scope: TeacherScope, lessonSessionId: string) {
    await this.teacherScopeService.assertLessonSessionInScope(
      scope,
      lessonSessionId,
    );
    const asOf = new Date();
    return this.prisma.$transaction(
      async (tx) => {
        const summarySelect = teacherRosterSummarySelect(scope.campusId, asOf);
        const rosterStudentSelect = {
          ...summarySelect.classGroup.select.members.select.student.select,
          displayName: true,
          profilePhotoFile: {
            select: { id: true, mimeType: true, sizeBytes: true },
          },
        } satisfies Prisma.StudentSelect;
        const lesson = await tx.lessonSession.findFirst({
          where: {
            id: lessonSessionId,
            campusId: scope.campusId,
            teacherId: scope.teacherProfileId,
          },
          select: {
            ...summarySelect,
            completedAt: true,
            earningBases: {
              where: {
                entries: { some: { entryType: 'ACCRUAL', status: 'AVAILABLE' } },
              },
              select: { id: true },
              take: 1,
            },
            classGroup: {
              select: {
                ...summarySelect.classGroup.select,
                members: {
                  ...summarySelect.classGroup.select.members,
                  select: { student: { select: rosterStudentSelect } },
                },
              },
            },
            attendanceRecords: {
              ...summarySelect.attendanceRecords,
              select: {
                studentId: true,
                status: true,
                student: { select: rosterStudentSelect },
              },
            },
            temporaryMembers: {
              ...summarySelect.temporaryMembers,
              select: { id: true, student: { select: rosterStudentSelect } },
            },
            feedback: {
              where: { campusId: scope.campusId },
              select: {
                studentId: true,
                teacherId: true,
                content: true,
                performanceRating: true,
                teacherRatings: true,
                version: true,
                teacher: { select: { user: { select: { displayName: true } } } },
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
            parentLessonReviews: { where: { campusId: scope.campusId } },
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
        const approvedLeaveStudents = activeApprovedLeaveStudentIds(lesson);
        const feedbackByStudent = new Map(
          lesson.feedback
            .filter((feedback) => feedback.teacherId === scope.teacherProfileId)
            .map((feedback) => [feedback.studentId, feedback]),
        );
        const feedbackOwnerByStudent = new Map(
          lesson.feedback.map(({ studentId, teacherId }) => [studentId, teacherId]),
        );
        const activeStudentIds = new Set(
          [...lesson.classGroup.members, ...lesson.temporaryMembers]
            .map(({ student }) => student.id),
        );
        const photoStudentIds = new Set(
          lesson.classGroup.members.map(({ student }) => student.id),
        );
        const historical = ['COMPLETED', 'REVERSED'].includes(lesson.status);
        const acceptsLeave = ['SCHEDULED', 'IN_PROGRESS'].includes(lesson.status);
        const members = [
          ...new Map(
            (historical ? lesson.attendanceRecords : [...lesson.classGroup.members, ...lesson.temporaryMembers])
              .map(({ student }) => [student.id, student]),
          ).values(),
        ].sort(
          (left, right) =>
            left.displayName.localeCompare(right.displayName) ||
            left.id.localeCompare(right.id),
        );
        const canReverse =
          lesson.status === 'COMPLETED' &&
          lesson.completedAt !== null &&
          lesson.earningBases.length === 0 &&
          asOf.getTime() - lesson.completedAt.getTime() <= REVERSAL_WINDOW_MS;
        return {
          ...this.toRosterLessonSummary(lesson, asOf),
          attendancePolicy: {
            PRESENT: { consumesLessonUnits: true as const },
            LEAVE: { consumesLessonUnits: false },
            ABSENT: { consumesLessonUnits: false },
          },
          students: members.map((student) => {
            const attendanceStatus =
              attendanceByStudent.get(student.id) ??
              (acceptsLeave && approvedLeaveStudents.has(student.id)
                ? 'LEAVE'
                : null);
            const feedback = feedbackByStudent.get(student.id);
            return {
              id: student.id,
              displayName: student.displayName,
              canEditFeedback:
                lesson.status === 'COMPLETED' &&
                activeStudentIds.has(student.id) &&
                (!feedbackOwnerByStudent.has(student.id) ||
                  feedbackOwnerByStudent.get(student.id) ===
                    scope.teacherProfileId),
              attendanceStatus,
              expectedConsumeUnits:
                attendanceStatus === 'PRESENT' ? lesson.lessonUnits : 0,
              feedback: feedback?.content ?? null,
              photo: photoStudentIds.has(student.id) && student.profilePhotoFile
                ? this.storedFileService.toStudentPhotoView(
                    student.profilePhotoFile,
                  )
                : null,
              parentReview: lesson.parentLessonReviews.find(
                ({ studentId }) => studentId === student.id,
              )
                ? toParentLessonReviewView(
                    lesson.parentLessonReviews.find(
                      ({ studentId }) => studentId === student.id,
                    )!,
                    lesson.status,
                  )
                : null,
              performanceRating: feedback?.performanceRating ?? null,
              teacherRatings: toTeacherFeedbackRatings(
                feedback?.teacherRatings ?? null,
              ),
              feedbackVersion: feedback?.version ?? 0,
              feedbackAuthorName: feedback?.teacher.user.displayName ?? null,
              feedbackImages:
                feedback?.images.map(({ storedFile }) =>
                  this.storedFileService.toFeedbackImageView(storedFile),
                ) ?? [],
            };
          }),
          canComplete: ['SCHEDULED', 'IN_PROGRESS'].includes(lesson.status),
          canReverse,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
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

  async getStudent(
    scope: TeacherScope,
    studentId: string,
    query: StudentDetailQueryDto = { feedbackPage: 1, feedbackPageSize: 10 },
  ) {
    return this.prisma.$transaction(
      async (tx) => {
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
        const student = await tx.student.findFirst({
          where: {
            id: studentId,
            campusId: scope.campusId,
            isActive: true,
            classMemberships: { some: membershipWhere },
          },
          select: {
            id: true,
            displayName: true,
            profileAge: true,
            birthDate: true,
            campus: {
              select: { timezone: true, lessonWarningThresholdUnits: true },
            },
            profilePhotoFile: {
              select: { id: true, mimeType: true, sizeBytes: true },
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
          includedInFinalRoster: true,
          lessonSession: {
            campusId: scope.campusId,
            teacherId: scope.teacherProfileId,
            status: 'COMPLETED',
          },
        };
        const feedbackWhere: Prisma.StudentFeedbackWhereInput = {
          campusId: scope.campusId,
          studentId,
          teacherId: scope.teacherProfileId,
          lessonSession: {
            campusId: scope.campusId,
            teacherId: scope.teacherProfileId,
            status: { in: ['COMPLETED', 'REVERSED'] },
          },
        };
        const [
          nextLesson,
          attendanceGroups,
          recentAttendance,
          latestFeedback,
          enrollment,
          history,
          feedbackTotal,
        ] = await Promise.all([
          tx.lessonSession.findFirst({
            where: {
              campusId: scope.campusId,
              teacherId: scope.teacherProfileId,
              startsAt: { gte: now },
              status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
              classGroup: {
                campusId: scope.campusId,
                status: 'ACTIVE',
                members: {
                  some: { campusId: scope.campusId, studentId, leftAt: null },
                },
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
          tx.attendanceRecord.groupBy({
            by: ['status'],
            where: attendanceWhere,
            _count: { _all: true },
          }),
          tx.attendanceRecord.findMany({
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
          tx.studentFeedback.findFirst({
            where: feedbackWhere,
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            select: {
              content: true,
              updatedAt: true,
              lessonSession: {
                select: { classGroup: { select: { courseName: true } } },
              },
            },
          }),
          readPartnerEnrollmentSummary(tx, scope.campusId, studentId),
          tx.studentFeedback.findMany({
            where: feedbackWhere,
            orderBy: [{ lessonSession: { startsAt: 'desc' } }, { id: 'desc' }],
            skip: (query.feedbackPage - 1) * query.feedbackPageSize,
            take: query.feedbackPageSize,
            select: {
              id: true,
              lessonSessionId: true,
              content: true,
              performanceRating: true,
              teacherRatings: true,
              version: true,
              teacher: { select: { user: { select: { displayName: true } } } },
              updatedAt: true,
              lessonSession: {
                select: {
                  startsAt: true,
                  status: true,
                  classGroup: { select: { name: true, courseName: true } },
                },
              },
              images: {
                orderBy: { sortOrder: 'asc' },
                select: {
                  storedFile: {
                    select: { id: true, mimeType: true, sizeBytes: true },
                  },
                },
              },
            },
          }),
          tx.studentFeedback.count({ where: feedbackWhere }),
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

        const balances = summarizeLessonBalances(student.coursePackages);
        const local = this.zonedParts(now, student.campus.timezone);
        const birthday = student.birthDate;
        const age =
          student.profileAge ??
          (birthday
            ? Math.max(
                0,
                local.year -
                  birthday.getUTCFullYear() -
                  (local.month < birthday.getUTCMonth() + 1 ||
                  (local.month === birthday.getUTCMonth() + 1 &&
                    local.day < birthday.getUTCDate())
                    ? 1
                    : 0),
              )
            : null);
        return {
          id: student.id,
          displayName: student.displayName,
          archive: {
            age,
            photo: student.profilePhotoFile
              ? this.storedFileService.toStudentPhotoView(
                  student.profilePhotoFile,
                )
              : null,
            enrollment: {
              initialMainUnits: enrollment.initialMainUnits,
              initialGiftUnits: enrollment.initialGiftUnits,
              receivedAmountFen: enrollment.receivedAmountFen,
              pendingIssuanceCount: enrollment.pendingIssuanceCount,
            },
            balance: {
              mainAvailableUnits: balances.mainAvailableUnits,
              giftAvailableUnits: balances.giftAvailableUnits,
              availableTotalUnits: balances.availableTotalUnits,
              thresholdUnits: student.campus.lessonWarningThresholdUnits,
              isWarning:
                balances.availableTotalUnits <=
                student.campus.lessonWarningThresholdUnits,
              asOf: now.toISOString(),
            },
          },
          feedbackHistory: this.page(
            history.map((record) => ({
              id: record.id,
              lessonSessionId: record.lessonSessionId,
              courseName: record.lessonSession.classGroup.courseName,
              className: record.lessonSession.classGroup.name,
              startsAt: record.lessonSession.startsAt.toISOString(),
              updatedAt: record.updatedAt.toISOString(),
              lessonStatus: record.lessonSession.status,
              content: record.content,
              performanceRating: record.performanceRating,
              teacherRatings: toTeacherFeedbackRatings(record.teacherRatings),
              feedbackVersion: record.version,
              feedbackAuthorName: record.teacher.user.displayName,
              images: record.images.map(({ storedFile }) =>
                this.storedFileService.toFeedbackImageView(storedFile),
              ),
            })),
            query.feedbackPage,
            query.feedbackPageSize,
            feedbackTotal,
          ),
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
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
                  attendanceRecords: { where: { includedInFinalRoster: true } },
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
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<TeacherIdentityRecord> {
    const teacher = await client.teacherProfile.findFirst({
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

  private countResponsibleStudents(
    scope: TeacherScope,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    return client.student.count({
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

  private toRosterLessonSummary(
    row: TeacherRosterSummaryRow,
    at: Date,
  ): TeacherLessonSummaryView {
    const rosterSummary = summarizeTeacherLessonRoster(row, at);
    return {
      ...this.toLessonSummary({
        ...row,
        studentCount: rosterSummary.expectedCount,
      }),
      rosterSummary,
    };
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
