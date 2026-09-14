import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TeacherScope } from '../../common/auth/teacher-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  InsufficientLessonBalanceError,
  LessonLedgerService,
} from '../lesson-ledger/lesson-ledger.service';
import { EarningRecordingService } from '../earning/earning-recording.service';
import { StoredFileService } from '../file/stored-file.service';
import { PartnerEarningRecordingService } from '../partner-earning/partner-earning-recording.service';
import type {
  AttendanceDraftDto,
  AttendanceStatus,
  CompleteLessonDto,
  ReverseLessonDto,
} from './dto/attendance.dto';
import {
  assertLessonVersion,
  loadActiveRoster,
  lockAssignedLesson,
  validateAttendanceSnapshot,
} from './lesson-mutation.helper';
import type {
  ActiveRosterMember,
  LockedLessonSession,
} from './lesson-mutation.helper';

const REVERSAL_WINDOW_MS = 24 * 60 * 60 * 1_000;

export interface CompleteLessonResult {
  lessonSessionId: string;
  lessonVersion: number;
  status: 'COMPLETED' | 'REVERSED';
  teachingRecordId: string;
  consumed: Array<{
    studentId: string;
    mainUnits: number;
    giftUnits: number;
  }>;
}

interface LockedCoursePackage {
  id: string;
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  version: number;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencyService: IdempotencyService,
    private readonly lessonLedgerService: LessonLedgerService,
    private readonly earningRecordingService: EarningRecordingService,
    private readonly partnerEarningRecordingService: PartnerEarningRecordingService,
    private readonly storedFileService: StoredFileService,
  ) {}

  async saveAttendance(
    scope: TeacherScope,
    lessonSessionId: string,
    dto: AttendanceDraftDto,
    idempotencyKey: string,
  ) {
    const route = this.route(lessonSessionId, 'attendance');
    return this.prisma.$transaction(async (transaction) => {
      const lesson = await lockAssignedLesson(
        transaction,
        scope,
        lessonSessionId,
      );
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

      this.assertCompletable(lesson);
      assertLessonVersion(lesson, dto.lessonVersion);
      const roster = await loadActiveRoster(transaction, lesson);
      validateAttendanceSnapshot(roster, dto.attendance);
      await this.upsertAttendance(
        transaction,
        scope,
        lessonSessionId,
        dto.attendance,
      );
      const result = await this.readLessonDetail(
        transaction,
        scope,
        lesson,
        roster,
      );
      await this.writeAudit(transaction, scope, lessonSessionId, 'SAVE', {
        lessonVersion: dto.lessonVersion,
        attendanceCount: dto.attendance.length,
      });
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: this.asJson(result),
      });
      return result;
    });
  }

  async completeLesson(
    scope: TeacherScope,
    lessonSessionId: string,
    dto: CompleteLessonDto,
    idempotencyKey: string,
  ) {
    const route = this.route(lessonSessionId, 'complete');
    return this.prisma.$transaction(async (transaction) => {
      const lesson = await lockAssignedLesson(
        transaction,
        scope,
        lessonSessionId,
      );
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

      this.assertCompletable(lesson);
      assertLessonVersion(lesson, dto.lessonVersion);
      const roster = await loadActiveRoster(transaction, lesson);
      validateAttendanceSnapshot(roster, dto.attendance);
      const completedAt = new Date();
      await this.upsertAttendance(
        transaction,
        scope,
        lessonSessionId,
        dto.attendance,
        completedAt,
      );

      const consumed = [] as CompleteLessonResult['consumed'];
      try {
        for (const attendance of dto.attendance) {
          if (attendance.status !== 'PRESENT') {
            consumed.push({
              studentId: attendance.studentId,
              mainUnits: 0,
              giftUnits: 0,
            });
            continue;
          }
          consumed.push(
            await this.lessonLedgerService.consumeStudentLessonUnits(
              transaction,
              {
                scope,
                studentId: attendance.studentId,
                lessonSessionId,
                requestedUnits: lesson.lessonUnits,
                idempotencyKey,
                occurredAt: completedAt,
                reason: '教师确认完成课次',
              },
            ),
          );
        }
      } catch (error: unknown) {
        if (error instanceof InsufficientLessonBalanceError) {
          throw new DomainError(
            ErrorCode.INSUFFICIENT_LESSON_BALANCE,
            'A student has insufficient lesson balance',
            409,
            {
              requiredUnits: error.requiredUnits,
              availableUnits: error.availableUnits,
            },
          );
        }
        throw error;
      }

      const teachingRecord = await transaction.teachingRecord.create({
        data: {
          campusId: scope.campusId,
          lessonSessionId,
          teacherId: scope.teacherProfileId,
          status: 'COMPLETED',
          attendeeCount: dto.attendance.filter(
            ({ status }) => status === 'PRESENT',
          ).length,
          lessonUnits: lesson.lessonUnits,
          recordedByUserId: scope.userId,
          completedAt,
        },
        select: { id: true },
      });
      await this.earningRecordingService.recordCompletedLesson(transaction, {
        campusId: scope.campusId,
        teacherProfileId: scope.teacherProfileId,
        teachingRecordId: teachingRecord.id,
        lessonSessionId,
        lessonKind: lesson.kind,
        lessonUnits: lesson.lessonUnits,
        completedAt,
      });
      await this.partnerEarningRecordingService.recordCompletedLesson(
        transaction,
        {
          campusId: scope.campusId,
          teachingRecordId: teachingRecord.id,
          lessonSessionId,
          lessonKind: lesson.kind,
          lessonUnits: lesson.lessonUnits,
          completedAt,
        },
      );
      const updated = await transaction.lessonSession.updateMany({
        where: {
          id: lessonSessionId,
          campusId: scope.campusId,
          teacherId: scope.teacherProfileId,
          version: lesson.version,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        },
        data: {
          status: 'COMPLETED',
          completedAt,
          reversedAt: null,
          reversalReason: null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        this.versionConflict(lesson.version);
      }

      const result: CompleteLessonResult = {
        lessonSessionId,
        lessonVersion: lesson.version + 1,
        status: 'COMPLETED',
        teachingRecordId: teachingRecord.id,
        consumed,
      };
      await this.writeAudit(transaction, scope, lessonSessionId, 'COMPLETE', {
        lessonVersion: result.lessonVersion,
        consumed,
      });
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: this.asJson(result),
      });
      return result;
    });
  }

  async reverseLesson(
    scope: TeacherScope,
    lessonSessionId: string,
    dto: ReverseLessonDto,
    idempotencyKey: string,
  ) {
    const route = this.route(lessonSessionId, 'reverse');
    return this.prisma.$transaction(async (transaction) => {
      const lesson = await lockAssignedLesson(
        transaction,
        scope,
        lessonSessionId,
      );
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

      assertLessonVersion(lesson, dto.lessonVersion);
      if (lesson.status !== 'COMPLETED' || lesson.completedAt === null) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'Only a completed lesson session can be reversed',
          409,
        );
      }
      const reversedAt = new Date();
      if (
        reversedAt.getTime() - lesson.completedAt.getTime() >
        REVERSAL_WINDOW_MS
      ) {
        throw new DomainError(
          ErrorCode.LESSON_REVERSAL_WINDOW_EXPIRED,
          'The teacher reversal window has expired',
          409,
        );
      }

      const originals = await transaction.lessonLedgerEntry.findMany({
        where: {
          campusId: scope.campusId,
          lessonSessionId,
          entryType: 'CONSUME',
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const existingReversals = await transaction.lessonLedgerEntry.count({
        where: { reversalOfId: { in: originals.map(({ id }) => id) } },
      });
      if (existingReversals > 0) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'The lesson consumption has already been reversed',
          409,
        );
      }

      const packages = new Map<string, LockedCoursePackage>();
      for (const packageId of [
        ...new Set(originals.map(({ coursePackageId }) => coursePackageId)),
      ].sort()) {
        const rows = await transaction.$queryRaw<LockedCoursePackage[]>`
          SELECT
            "id",
            "mainBalanceUnits",
            "giftBalanceUnits",
            "version"
          FROM "CoursePackage"
          WHERE "id" = ${packageId}::uuid
            AND "campusId" = ${scope.campusId}::uuid
          FOR UPDATE
        `;
        if (!rows[0]) {
          throw new DomainError(
            ErrorCode.CONFLICT,
            'A consumed course package is no longer available',
            409,
          );
        }
        packages.set(packageId, rows[0]);
      }

      for (const original of originals) {
        const coursePackage = packages.get(original.coursePackageId);
        if (!coursePackage) {
          throw new Error('Locked course package was not retained');
        }
        const balanceKey =
          original.bucket === 'MAIN' ? 'mainBalanceUnits' : 'giftBalanceUnits';
        const balanceBeforeUnits = coursePackage[balanceKey];
        const balanceAfterUnits = balanceBeforeUnits - original.deltaUnits;
        const update = await transaction.coursePackage.updateMany({
          where: {
            id: coursePackage.id,
            campusId: scope.campusId,
            version: coursePackage.version,
            [balanceKey]: balanceBeforeUnits,
          },
          data: {
            [balanceKey]: balanceAfterUnits,
            version: { increment: 1 },
          },
        });
        if (update.count !== 1) {
          this.versionConflict(lesson.version);
        }
        coursePackage[balanceKey] = balanceAfterUnits;
        coursePackage.version += 1;
        await transaction.lessonLedgerEntry.create({
          data: {
            campusId: scope.campusId,
            studentId: original.studentId,
            coursePackageId: original.coursePackageId,
            lessonSessionId,
            entryType: 'REVERSAL',
            bucket: original.bucket,
            deltaUnits: -original.deltaUnits,
            balanceBeforeUnits,
            balanceAfterUnits,
            idempotencyKey,
            reversalOfId: original.id,
            actorUserId: scope.userId,
            reason: dto.reason,
            createdAt: reversedAt,
          },
        });
      }

      const teachingRecord = await transaction.teachingRecord.findUnique({
        where: { lessonSessionId },
        select: { id: true, status: true },
      });
      if (!teachingRecord || teachingRecord.status !== 'COMPLETED') {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'The completed teaching record was not found',
          409,
        );
      }
      await transaction.teachingRecord.update({
        where: { id: teachingRecord.id },
        data: {
          status: 'REVERSED',
          reversedAt,
          reversalReason: dto.reason,
        },
      });
      await this.earningRecordingService.recordReversedLesson(transaction, {
        teachingRecordId: teachingRecord.id,
        reversedAt,
      });
      await this.partnerEarningRecordingService.recordReversedLesson(
        transaction,
        {
          teachingRecordId: teachingRecord.id,
          reversedAt,
        },
      );
      const updated = await transaction.lessonSession.updateMany({
        where: {
          id: lessonSessionId,
          version: lesson.version,
          status: 'COMPLETED',
          campusId: scope.campusId,
          teacherId: scope.teacherProfileId,
        },
        data: {
          status: 'REVERSED',
          reversedAt,
          reversalReason: dto.reason,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        this.versionConflict(lesson.version);
      }

      const result: CompleteLessonResult = {
        lessonSessionId,
        lessonVersion: lesson.version + 1,
        status: 'REVERSED',
        teachingRecordId: teachingRecord.id,
        consumed: await this.reconstructConsumption(
          transaction,
          lessonSessionId,
          originals,
        ),
      };
      await this.writeAudit(transaction, scope, lessonSessionId, 'REVERSE', {
        lessonVersion: result.lessonVersion,
        reason: dto.reason,
      });
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: this.asJson(result),
      });
      return result;
    });
  }

  private async upsertAttendance(
    transaction: Prisma.TransactionClient,
    scope: TeacherScope,
    lessonSessionId: string,
    attendance: ReadonlyArray<{
      studentId: string;
      status: AttendanceStatus;
    }>,
    recordedAt = new Date(),
  ): Promise<void> {
    for (const item of attendance) {
      await transaction.attendanceRecord.upsert({
        where: {
          lessonSessionId_studentId: {
            lessonSessionId,
            studentId: item.studentId,
          },
        },
        update: {
          status: item.status,
          recordedByUserId: scope.userId,
          recordedAt,
        },
        create: {
          campusId: scope.campusId,
          lessonSessionId,
          studentId: item.studentId,
          status: item.status,
          recordedByUserId: scope.userId,
          recordedAt,
        },
      });
    }
  }

  private async readLessonDetail(
    transaction: Prisma.TransactionClient,
    scope: TeacherScope,
    lesson: LockedLessonSession,
    roster: readonly ActiveRosterMember[],
  ) {
    const [identity, attendance, feedback] = await Promise.all([
      transaction.lessonSession.findUniqueOrThrow({
        where: { id: lesson.id },
        select: {
          status: true,
          completedAt: true,
          campus: { select: { name: true } },
          classGroup: { select: { name: true, courseName: true } },
        },
      }),
      transaction.attendanceRecord.findMany({
        where: { lessonSessionId: lesson.id },
        select: { studentId: true, status: true },
      }),
      transaction.studentFeedback.findMany({
        where: {
          lessonSessionId: lesson.id,
          teacherId: scope.teacherProfileId,
        },
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
      }),
    ]);
    const attendanceByStudent = new Map(
      attendance.map(({ studentId, status }) => [studentId, status]),
    );
    const feedbackByStudent = new Map(
      feedback.map((item) => [item.studentId, item]),
    );
    const canReverse =
      identity.status === 'COMPLETED' &&
      identity.completedAt !== null &&
      Date.now() - identity.completedAt.getTime() <= REVERSAL_WINDOW_MS;

    return {
      id: lesson.id,
      version: lesson.version,
      className: identity.classGroup.name,
      courseName: identity.classGroup.courseName,
      campusName: identity.campus.name,
      startsAt: lesson.startsAt.toISOString(),
      endsAt: lesson.endsAt.toISOString(),
      lessonUnits: lesson.lessonUnits,
      status: identity.status,
      studentCount: roster.length,
      attendancePolicy: {
        PRESENT: { consumesLessonUnits: true as const },
        LEAVE: { consumesLessonUnits: false },
        ABSENT: { consumesLessonUnits: false },
      },
      students: roster.map(({ studentId, displayName }) => {
        const attendanceStatus = attendanceByStudent.get(studentId) ?? null;
        const feedbackItem = feedbackByStudent.get(studentId);
        return {
          id: studentId,
          displayName,
          attendanceStatus,
          expectedConsumeUnits:
            attendanceStatus === 'PRESENT' ? lesson.lessonUnits : 0,
          feedback: feedbackItem?.content ?? null,
          feedbackImages:
            feedbackItem?.images.map(({ storedFile }) =>
              this.storedFileService.toFeedbackImageView(storedFile),
            ) ?? [],
        };
      }),
      canComplete: ['SCHEDULED', 'IN_PROGRESS'].includes(identity.status),
      canReverse,
    };
  }

  private async reconstructConsumption(
    transaction: Prisma.TransactionClient,
    lessonSessionId: string,
    originals: ReadonlyArray<{
      studentId: string;
      bucket: 'MAIN' | 'GIFT';
      deltaUnits: number;
    }>,
  ): Promise<CompleteLessonResult['consumed']> {
    const attendance = await transaction.attendanceRecord.findMany({
      where: { lessonSessionId },
      orderBy: { studentId: 'asc' },
      select: { studentId: true },
    });
    return attendance.map(({ studentId }) => ({
      studentId,
      mainUnits: -originals
        .filter(
          (entry) => entry.studentId === studentId && entry.bucket === 'MAIN',
        )
        .reduce((sum, entry) => sum + entry.deltaUnits, 0),
      giftUnits: -originals
        .filter(
          (entry) => entry.studentId === studentId && entry.bucket === 'GIFT',
        )
        .reduce((sum, entry) => sum + entry.deltaUnits, 0),
    }));
  }

  private assertCompletable(lesson: LockedLessonSession): void {
    if (lesson.status === 'COMPLETED' || lesson.status === 'REVERSED') {
      throw new DomainError(
        ErrorCode.LESSON_ALREADY_COMPLETED,
        'The lesson session has already been completed',
        409,
      );
    }
    if (!['SCHEDULED', 'IN_PROGRESS'].includes(lesson.status)) {
      throw new DomainError(
        ErrorCode.CONFLICT,
        'The lesson session cannot accept attendance in its current state',
        409,
      );
    }
  }

  private versionConflict(currentVersion: number): never {
    throw new DomainError(
      ErrorCode.LESSON_VERSION_CONFLICT,
      'The lesson session version has changed',
      409,
      { currentVersion },
    );
  }

  private writeAudit(
    transaction: Prisma.TransactionClient,
    scope: TeacherScope,
    lessonSessionId: string,
    operation: 'SAVE' | 'COMPLETE' | 'REVERSE',
    details: Prisma.InputJsonValue,
  ) {
    return transaction.auditLog.create({
      data: {
        campusId: scope.campusId,
        actorUserId: scope.userId,
        action: `TEACHER_ATTENDANCE_${operation}`,
        resourceType: 'LessonSession',
        resourceId: lessonSessionId,
        outcome: 'SUCCESS',
        details,
      },
    });
  }

  private route(lessonSessionId: string, operation: string): string {
    return `/teachers/me/lesson-sessions/${lessonSessionId}/${operation}`;
  }

  private asJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }
}
