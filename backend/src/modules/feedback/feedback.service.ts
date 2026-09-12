import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { TeacherScope } from '../../common/auth/teacher-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  loadActiveRoster,
  lockAssignedLesson,
} from '../attendance/lesson-mutation.helper';
import {
  StoredFileService,
  STUDENT_FEEDBACK_IMAGE_OPTIONS,
  type UploadedStoredFile,
} from '../file/stored-file.service';
import type { FeedbackUpsertDto } from './dto/feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencyService: IdempotencyService,
    private readonly storedFileService: StoredFileService,
  ) {}

  async uploadImage(
    scope: TeacherScope,
    actor: AuthenticatedUser,
    lessonSessionId: string,
    studentId: string,
    file: UploadedStoredFile | undefined,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      const lesson = await lockAssignedLesson(
        transaction,
        scope,
        lessonSessionId,
      );
      if (lesson.status !== 'COMPLETED') {
        throw new DomainError(
          ErrorCode.FEEDBACK_NOT_ALLOWED,
          'Feedback images can only be uploaded for a completed lesson',
          409,
        );
      }
      const roster = await loadActiveRoster(transaction, lesson);
      if (!roster.some((member) => member.studentId === studentId)) {
        throw new DomainError(
          ErrorCode.FORBIDDEN,
          'The student is outside the assigned lesson roster',
          403,
        );
      }
    });

    const stored = await this.storedFileService.store(
      actor,
      file,
      STUDENT_FEEDBACK_IMAGE_OPTIONS,
    );
    return this.storedFileService.toFeedbackImageView(stored);
  }

  async upsert(
    scope: TeacherScope,
    lessonSessionId: string,
    studentId: string,
    dto: FeedbackUpsertDto,
    idempotencyKey: string,
  ) {
    const route = `/teachers/me/lesson-sessions/${lessonSessionId}/students/${studentId}/feedback`;
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
      if (lesson.status !== 'COMPLETED') {
        throw new DomainError(
          ErrorCode.FEEDBACK_NOT_ALLOWED,
          'Feedback can only be written for a completed lesson',
          409,
        );
      }
      const roster = await loadActiveRoster(transaction, lesson);
      if (!roster.some((member) => member.studentId === studentId)) {
        throw new DomainError(
          ErrorCode.FORBIDDEN,
          'The student is outside the assigned lesson roster',
          403,
        );
      }

      const existingFeedback = await transaction.studentFeedback.findUnique({
        where: {
          lessonSessionId_studentId: { lessonSessionId, studentId },
        },
        select: { id: true },
      });
      const imageFiles = dto.imageFileIds.length
        ? await transaction.storedFile.findMany({
            where: {
              id: { in: dto.imageFileIds },
              purpose: 'STUDENT_FEEDBACK_IMAGE',
              createdByUserId: scope.userId,
            },
            select: {
              id: true,
              mimeType: true,
              sizeBytes: true,
              studentFeedbackImage: { select: { feedbackId: true } },
            },
          })
        : [];
      if (imageFiles.length !== dto.imageFileIds.length) {
        throw new DomainError(
          ErrorCode.FEEDBACK_IMAGE_INVALID,
          'One or more feedback images are unavailable',
          400,
        );
      }
      if (
        imageFiles.some(
          ({ studentFeedbackImage }) =>
            studentFeedbackImage &&
            studentFeedbackImage.feedbackId !== existingFeedback?.id,
        )
      ) {
        throw new DomainError(
          ErrorCode.FEEDBACK_IMAGE_CONFLICT,
          'A feedback image is already attached to another feedback',
          409,
        );
      }

      const feedback = await transaction.studentFeedback.upsert({
        where: {
          lessonSessionId_studentId: { lessonSessionId, studentId },
        },
        update: {
          content: dto.content,
          teacherId: scope.teacherProfileId,
        },
        create: {
          campusId: scope.campusId,
          lessonSessionId,
          studentId,
          teacherId: scope.teacherProfileId,
          content: dto.content,
        },
        select: {
          id: true,
          lessonSessionId: true,
          studentId: true,
          content: true,
          updatedAt: true,
        },
      });
      await transaction.studentFeedbackImage.deleteMany({
        where: { feedbackId: feedback.id },
      });
      if (dto.imageFileIds.length) {
        await transaction.studentFeedbackImage.createMany({
          data: dto.imageFileIds.map((storedFileId, sortOrder) => ({
            feedbackId: feedback.id,
            storedFileId,
            sortOrder,
          })),
        });
      }
      const imageById = new Map(imageFiles.map((image) => [image.id, image]));
      const result = {
        lessonSessionId: feedback.lessonSessionId,
        studentId: feedback.studentId,
        content: feedback.content,
        images: dto.imageFileIds.map((id) =>
          this.storedFileService.toFeedbackImageView(
            imageById.get(id) as {
              id: string;
              mimeType: string;
              sizeBytes: number;
            },
          ),
        ),
        updatedAt: feedback.updatedAt.toISOString(),
      };
      await transaction.auditLog.create({
        data: {
          campusId: scope.campusId,
          actorUserId: scope.userId,
          action: 'TEACHER_FEEDBACK_UPSERT',
          resourceType: 'StudentFeedback',
          resourceId: `${lessonSessionId}:${studentId}`,
          outcome: 'SUCCESS',
          details: { lessonSessionId, studentId },
        },
      });
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: JSON.parse(
          JSON.stringify(result),
        ) as Prisma.InputJsonValue,
      });
      return result;
    });
  }
}
