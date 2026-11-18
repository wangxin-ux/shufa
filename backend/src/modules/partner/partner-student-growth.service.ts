import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PartnerScopeService } from '../../common/auth/partner-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StoredFileService } from '../file/stored-file.service';
import { toParentLessonReviewView } from '../parent-portal/parent-growth.models';
import type { PartnerPageQueryDto } from './dto/partner-query.dto';

export const partnerPhotoSelect = {
  id: true,
  mimeType: true,
  sizeBytes: true,
  purpose: true,
  photoTargetStudentId: true,
} as const satisfies Prisma.StoredFileSelect;

export function toPartnerPhoto(
  files: StoredFileService,
  student: {
    id: string;
    profilePhotoFile: Prisma.StoredFileGetPayload<{
      select: typeof partnerPhotoSelect;
    }> | null;
  },
) {
  const photo = student.profilePhotoFile;
  if (
    !photo ||
    photo.purpose !== 'STUDENT_PROFILE_PHOTO' ||
    photo.photoTargetStudentId !== student.id
  ) {
    return null;
  }
  return files.toStudentPhotoView({
    id: photo.id,
    mimeType: photo.mimeType,
    sizeBytes: photo.sizeBytes,
  });
}

@Injectable()
export class PartnerStudentGrowthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: PartnerScopeService,
    private readonly files: StoredFileService,
  ) {}

  async getGrowth(
    user: AuthenticatedUser,
    studentId: string,
    query: PartnerPageQueryDto,
  ) {
    const { campusId } = this.scopeService.require(user);
    return this.prisma.$transaction(
      async (tx) => {
        const student = await tx.student.findFirst({
          where: { id: studentId, campusId, isActive: true },
          select: {
            id: true,
            displayName: true,
            profilePhotoFile: { select: partnerPhotoSelect },
          },
        });
        if (!student) {
          throw new DomainError(
            ErrorCode.RESOURCE_NOT_FOUND,
            'The partner student was not found',
            404,
          );
        }
        const association = { campusId, studentId };
        const where: Prisma.LessonSessionWhereInput = {
          campusId,
          classGroup: { campusId },
          teacher: { campusId },
          AND: [
            {
              OR: [
                {
                  status: 'COMPLETED',
                  teachingRecord: { is: { campusId, status: 'COMPLETED' } },
                },
                {
                  status: 'REVERSED',
                  teachingRecord: { is: { campusId, status: 'REVERSED' } },
                },
              ],
            },
            {
              OR: [
                { attendanceRecords: { some: { ...association, includedInFinalRoster: true } } },
                { feedback: { some: association } },
              ],
            },
          ],
        };
        const total = await tx.lessonSession.count({ where });
        const lessons = await tx.lessonSession.findMany({
          where,
          orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            startsAt: true,
            status: true,
            campus: { select: { name: true } },
            classGroup: { select: { courseName: true } },
            teacher: { select: { user: { select: { displayName: true } } } },
            attendanceRecords: {
              where: { ...association, includedInFinalRoster: true },
              take: 1,
              select: { status: true },
            },
            parentLessonReviews: {
              where: association,
              take: 1,
              select: {
                id: true,
                lessonSessionId: true,
                studentId: true,
                teaching: true,
                communication: true,
                environment: true,
                overall: true,
                note: true,
                createdAt: true,
              },
            },
            feedback: {
              where: association,
              take: 1,
              select: {
                content: true,
                performanceRating: true,
                updatedAt: true,
                images: {
                  where: { storedFile: { purpose: 'STUDENT_FEEDBACK_IMAGE' } },
                  orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                  take: 3,
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
          student: {
            id: student.id,
            displayName: student.displayName,
            photo: toPartnerPhoto(this.files, student),
          },
          items: lessons.map((lesson) => {
            const feedback = lesson.feedback[0];
            const review = lesson.parentLessonReviews[0];
            return {
              lessonSessionId: lesson.id,
              studentId,
              courseName: lesson.classGroup.courseName,
              campusName: lesson.campus.name,
              teacherName: lesson.teacher.user.displayName,
              startsAt: lesson.startsAt.toISOString(),
              lessonStatus: lesson.status,
              attendanceStatus: lesson.attendanceRecords[0]?.status ?? null,
              feedback: feedback?.content ?? null,
              performanceRating: feedback?.performanceRating ?? null,
              review: review
                ? toParentLessonReviewView(review, lesson.status)
                : null,
              feedbackImages:
                feedback?.images.map(({ storedFile }) =>
                  this.files.toFeedbackImageView(storedFile),
                ) ?? [],
              feedbackUpdatedAt: feedback?.updatedAt.toISOString() ?? null,
            };
          }),
          meta: {
            page: query.page,
            pageSize: query.pageSize,
            total,
            totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
