import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  ParentScopeService,
  type ParentScope,
} from '../../common/auth/parent-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  StoredFileService,
  STUDENT_PROFILE_PHOTO_OPTIONS,
  type UploadedStoredFile,
} from '../file/stored-file.service';
import type {
  ParentLessonReviewDto,
  ParentProfileSetupDto,
  StudentPhotoReplaceDto,
} from './dto/parent-growth.dto';
import { toParentLessonReviewView } from './parent-growth.models';
import { calculateStudentAge } from './parent-student-age';

@Injectable()
export class ParentGrowthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: ParentScopeService,
    private readonly files: StoredFileService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async getProfileSetup(scope: ParentScope) {
    const student = await this.scopeService.resolveStudent(scope);
    if (!student) return { required: false, student: null };
    const current = await this.prisma.student.findUniqueOrThrow({
      where: { id: student.id },
      include: { profilePhotoFile: true },
    });
    return this.toSetupView(current);
  }

  async completeProfileSetup(
    scope: ParentScope,
    studentId: string,
    dto: ParentProfileSetupDto,
    key: string,
  ) {
    const route = `/parents/me/students/${studentId}/profile-setup`;
    return this.prisma.$transaction(async (tx) => {
      await this.lockStudent(tx, scope, studentId);
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: dto,
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) return claim.responseBody;
      const student = await tx.student.findUniqueOrThrow({
        where: { id: studentId },
      });
      if (student.parentProfileCompletedAt) {
        throw new DomainError(
          'PARENT_PROFILE_ALREADY_COMPLETED',
          'Student profile is already complete',
          409,
        );
      }
      if (student.profileVersion !== dto.expectedVersion) {
        throw new DomainError(
          'STUDENT_PROFILE_VERSION_CONFLICT',
          'Student profile version changed',
          409,
          { currentVersion: student.profileVersion },
        );
      }
      const now = new Date();
      const today = new Date(now.getTime() + 8 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const birthDate = new Date(`${dto.birthDate}T00:00:00.000Z`);
      if (dto.birthDate > today || calculateStudentAge(birthDate, now) > 120) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'Birth date is outside the allowed range',
          400,
        );
      }
      const file = await tx.storedFile.findFirst({
        where: {
          id: dto.fileId,
          purpose: 'STUDENT_PROFILE_PHOTO',
          OR: [
            { profilePhotoStudent: { is: { id: studentId } } },
            { createdByUserId: scope.userId, photoTargetStudentId: studentId },
          ],
        },
      });
      if (!file)
        throw new DomainError(
          'STUDENT_PHOTO_INVALID',
          'Photo is unavailable for this student',
          400,
        );
      const updated = await tx.student.update({
        where: { id: studentId },
        data: {
          displayName: dto.name,
          birthDate,
          profileAge: null,
          profilePhotoFileId: file.id,
          parentProfileCompletedAt: now,
          profileVersion: { increment: 1 },
        },
        include: { profilePhotoFile: true },
      });
      const result = this.toSetupView(updated);
      await tx.auditLog.create({
        data: {
          campusId: scope.campusId,
          actorUserId: scope.userId,
          action: 'PARENT_PROFILE_SETUP_COMPLETE',
          resourceType: 'Student',
          resourceId: studentId,
          outcome: 'SUCCESS',
          details: {
            fileId: file.id,
            previousVersion: student.profileVersion,
            currentVersion: updated.profileVersion,
          },
        },
      });
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: JSON.parse(
          JSON.stringify(result),
        ) as Prisma.InputJsonValue,
      });
      return result;
    });
  }

  private toSetupView(student: {
    id: string;
    displayName: string;
    birthDate: Date | null;
    profileAge: number | null;
    parentProfileCompletedAt: Date | null;
    profileVersion: number;
    profilePhotoFile: {
      id: string;
      mimeType: string;
      sizeBytes: number;
    } | null;
  }) {
    return {
      required: !student.parentProfileCompletedAt,
      student: {
        id: student.id,
        name: student.displayName,
        age: student.profileAge ?? calculateStudentAge(student.birthDate),
        birthDate: student.birthDate?.toISOString().slice(0, 10) ?? null,
        profileVersion: student.profileVersion,
        photo: student.profilePhotoFile
          ? this.files.toStudentPhotoView(student.profilePhotoFile)
          : null,
      },
    };
  }

  async uploadPhoto(
    scope: ParentScope,
    actor: AuthenticatedUser,
    studentId: string,
    file?: UploadedStoredFile,
  ) {
    await this.scopeService.resolveStudent(scope, studentId);
    const stored = await this.files.store(
      actor,
      file,
      STUDENT_PROFILE_PHOTO_OPTIONS,
    );
    await this.prisma.$transaction(async (tx) => {
      await this.lockStudent(tx, scope, studentId);
      await tx.storedFile.update({
        where: { id: stored.id },
        data: { photoTargetStudentId: studentId },
      });
    });
    return {
      id: stored.id,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
    };
  }

  async replacePhoto(
    scope: ParentScope,
    studentId: string,
    dto: StudentPhotoReplaceDto,
    key: string,
  ) {
    const route = `/parents/me/students/${studentId}/photo`;
    return this.prisma.$transaction(async (tx) => {
      const student = await this.lockStudent(tx, scope, studentId);
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: dto,
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) return claim.responseBody;
      if (student.profileVersion !== dto.expectedVersion) {
        throw new DomainError(
          'STUDENT_PROFILE_VERSION_CONFLICT',
          'Student profile version changed',
          409,
          { currentVersion: student.profileVersion },
        );
      }
      const file = await tx.storedFile.findFirst({
        where: {
          id: dto.fileId,
          purpose: 'STUDENT_PROFILE_PHOTO',
          createdByUserId: scope.userId,
          photoTargetStudentId: studentId,
        },
        select: { id: true, mimeType: true, sizeBytes: true },
      });
      if (!file)
        throw new DomainError(
          'STUDENT_PHOTO_INVALID',
          'Photo is unavailable for this student',
          400,
        );
      const updated = await tx.student.update({
        where: { id: studentId },
        data: {
          profilePhotoFileId: file.id,
          profileVersion: { increment: 1 },
        },
      });
      const age = updated.profileAge ?? calculateStudentAge(updated.birthDate);
      const result = {
        id: updated.id,
        name: updated.displayName,
        age,
        profileVersion: updated.profileVersion,
        photo: this.files.toStudentPhotoView(file),
      };
      await tx.auditLog.create({
        data: {
          campusId: scope.campusId,
          actorUserId: scope.userId,
          action: 'PARENT_STUDENT_PHOTO_REPLACE',
          resourceType: 'Student',
          resourceId: studentId,
          outcome: 'SUCCESS',
          details: {
            fileId: file.id,
            previousVersion: student.profileVersion,
            currentVersion: updated.profileVersion,
          },
        },
      });
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: JSON.parse(
          JSON.stringify(result),
        ) as Prisma.InputJsonValue,
      });
      return result;
    });
  }

  async submitReview(
    scope: ParentScope,
    lessonSessionId: string,
    studentId: string,
    dto: ParentLessonReviewDto,
    key: string,
  ) {
    const route = `/parents/me/lesson-sessions/${lessonSessionId}/students/${studentId}/review`;
    return this.prisma.$transaction(async (tx) => {
      // The same row lock is used by teacher completion/reversal and feedback writes.
      const lessons = await tx.$queryRaw<
        Array<{ id: string; campusId: string; status: string }>
      >`
        SELECT "id", "campusId", "status" FROM "LessonSession"
        WHERE "id" = ${lessonSessionId}::uuid FOR UPDATE
      `;
      const lesson = lessons[0];
      if (!lesson)
        throw new DomainError(
          'RESOURCE_NOT_FOUND',
          'Lesson was not found',
          404,
        );
      if (lesson.campusId !== scope.campusId)
        throw new DomainError(
          'FORBIDDEN',
          'Lesson is outside parent campus',
          403,
        );
      await this.lockStudent(tx, scope, studentId, true);
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: dto,
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) {
        const original = claim.responseBody as Prisma.JsonObject;
        return { ...original, valid: lesson.status === 'COMPLETED' };
      }
      const attendance = await tx.attendanceRecord.findFirst({
        where: {
          includedInFinalRoster: true,
          campusId: scope.campusId,
          lessonSessionId,
          studentId,
          status: 'PRESENT',
        },
        select: { id: true },
      });
      if (lesson.status !== 'COMPLETED' || !attendance) {
        throw new DomainError(
          'PARENT_REVIEW_NOT_ALLOWED',
          'Only a completed attended lesson can be reviewed',
          409,
        );
      }
      const existing = await tx.parentLessonReview.findUnique({
        where: { lessonSessionId_studentId: { lessonSessionId, studentId } },
        select: { id: true },
      });
      if (existing)
        throw new DomainError(
          'PARENT_REVIEW_ALREADY_EXISTS',
          'This student lesson has already been reviewed',
          409,
        );
      const review = await tx.parentLessonReview.create({
        data: {
          campusId: scope.campusId,
          lessonSessionId,
          studentId,
          parentUserId: scope.userId,
          teaching: dto.teaching,
          communication: dto.communication,
          environment: dto.environment,
          overall: dto.overall,
          note: dto.note ?? '',
        },
      });
      const result = toParentLessonReviewView(review, lesson.status);
      await tx.auditLog.create({
        data: {
          campusId: scope.campusId,
          actorUserId: scope.userId,
          action: 'PARENT_LESSON_REVIEW_CREATE',
          resourceType: 'ParentLessonReview',
          resourceId: review.id,
          outcome: 'SUCCESS',
          details: { studentId, lessonSessionId },
        },
      });
      await this.idempotency.complete(tx, { key, route, responseBody: result });
      return result;
    });
  }

  private async lockStudent(
    tx: Prisma.TransactionClient,
    scope: ParentScope,
    studentId: string,
    shared = false,
  ) {
    const rows = shared
      ? await tx.$queryRaw<Array<{ id: string; profileVersion: number }>>`
          SELECT s."id", s."profileVersion" FROM "Student" s
          JOIN "ParentStudentBinding" b ON b."studentId" = s."id"
          WHERE s."id" = ${studentId}::uuid AND s."campusId" = ${scope.campusId}::uuid
            AND s."isActive" = true AND b."campusId" = ${scope.campusId}::uuid AND b."parentUserId" = ${scope.userId}::uuid
          FOR SHARE OF s, b`
      : await tx.$queryRaw<Array<{ id: string; profileVersion: number }>>`
          SELECT s."id", s."profileVersion" FROM "Student" s
          JOIN "ParentStudentBinding" b ON b."studentId" = s."id"
          WHERE s."id" = ${studentId}::uuid AND s."campusId" = ${scope.campusId}::uuid
            AND s."isActive" = true AND b."campusId" = ${scope.campusId}::uuid AND b."parentUserId" = ${scope.userId}::uuid
          FOR UPDATE OF s FOR SHARE OF b`;
    if (!rows[0])
      throw new DomainError(
        'FORBIDDEN',
        'Student is outside parent scope',
        403,
      );
    return rows[0];
  }
}
