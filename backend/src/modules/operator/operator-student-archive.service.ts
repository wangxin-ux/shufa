import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { OperatorScopeService } from '../../common/auth/operator-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  StoredFileService,
  STUDENT_FEEDBACK_IMAGE_OPTIONS,
  STUDENT_PROFILE_PHOTO_OPTIONS,
} from '../file/stored-file.service';
import {
  lessonBalanceSelect,
  summarizeLessonBalances,
} from '../lesson-ledger/lesson-balance';
import { readPartnerEnrollmentSummary } from '../partner/partner-enrollment-summary';
import { toParentLessonReviewView } from '../parent-portal/parent-growth.models';
import { calculateStudentAge } from '../parent-portal/parent-student-age';
import type { OperatorStudentGrowthQueryDto } from './dto/operator-student.dto';

const mediaSelect = {
  id: true,
  mimeType: true,
  sizeBytes: true,
} satisfies Prisma.StoredFileSelect;

function historyWhere(
  campusId: string,
  studentId: string,
): Prisma.LessonSessionWhereInput {
  return {
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
          { attendanceRecords: { some: { campusId, studentId, includedInFinalRoster: true } } },
          { feedback: { some: { campusId, studentId } } },
        ],
      },
    ],
  };
}

@Injectable()
export class OperatorStudentArchiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: OperatorScopeService,
    private readonly files: StoredFileService,
  ) {}

  async getArchive(user: AuthenticatedUser, studentId: string) {
    const { campusId } = this.scopeService.require(user);
    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const student = await tx.student.findFirst({
          where: { id: studentId, campusId, isActive: true },
          select: {
            id: true,
            displayName: true,
            birthDate: true,
            profilePhotoFile: {
              select: {
                ...mediaSelect,
                purpose: true,
                photoTargetStudentId: true,
              },
            },
            campus: { select: { lessonWarningThresholdUnits: true } },
            classMemberships: {
              where: {
                campusId,
                leftAt: null,
                classGroup: {
                  campusId,
                  status: 'ACTIVE',
                  teacher: { campusId },
                },
              },
              orderBy: [{ classGroup: { name: 'asc' } }, { id: 'asc' }],
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
              where: {
                campusId,
                isActive: true,
                validFrom: { lte: now },
                OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
              },
              select: lessonBalanceSelect,
            },
          },
        });
        if (!student) this.notFound();
        const groups = await tx.attendanceRecord.groupBy({
          by: ['status'],
          where: {
            includedInFinalRoster: true,
            campusId,
            studentId,
            lessonSession: {
              ...historyWhere(campusId, studentId),
              status: 'COMPLETED',
              teachingRecord: { is: { campusId, status: 'COMPLETED' } },
            },
          },
          _count: { _all: true },
        });
        const enrollmentSummary = await readPartnerEnrollmentSummary(
          tx,
          campusId,
          studentId,
        );
        const balances = summarizeLessonBalances(student.coursePackages);
        const count = (status: string) =>
          groups.find((group) => group.status === status)?._count._all ?? 0;
        const presentCount = count('PRESENT');
        const absentCount = count('ABSENT');
        const leaveCount = count('LEAVE');
        const recordedCount = presentCount + absentCount + leaveCount;
        const photo = student.profilePhotoFile;
        return {
          id: student.id,
          displayName: student.displayName,
          ageYears: student.birthDate
            ? calculateStudentAge(student.birthDate, now)
            : null,
          photo:
            photo?.purpose === 'STUDENT_PROFILE_PHOTO' &&
            photo.photoTargetStudentId === studentId
              ? this.mediaView(studentId, photo)
              : null,
          classes: student.classMemberships.map(({ classGroup }) => ({
            id: classGroup.id,
            className: classGroup.name,
            courseName: classGroup.courseName,
            teacherName: classGroup.teacher.user.displayName,
          })),
          enrollmentSummary,
          ...balances,
          warningThresholdUnits: student.campus.lessonWarningThresholdUnits,
          lowBalance:
            balances.availableTotalUnits <=
            student.campus.lessonWarningThresholdUnits,
          attendance: {
            presentCount,
            absentCount,
            leaveCount,
            recordedCount,
            attendanceRateBasisPoints:
              recordedCount === 0
                ? null
                : Math.round((presentCount * 10_000) / recordedCount),
          },
          serverTime: now.toISOString(),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async getGrowth(
    user: AuthenticatedUser,
    studentId: string,
    query: OperatorStudentGrowthQueryDto,
  ) {
    const { campusId } = this.scopeService.require(user);
    return this.prisma.$transaction(
      async (tx) => {
        await this.requireStudent(tx, campusId, studentId);
        const association = { campusId, studentId };
        const where = historyWhere(campusId, studentId);
        const total = await tx.lessonSession.count({ where });
        const rows = await tx.lessonSession.findMany({
          where,
          orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            teacherId: true,
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
            feedback: {
              where: { ...association, teacher: { campusId } },
              take: 1,
              select: {
                teacherId: true,
                content: true,
                performanceRating: true,
                teacherRatings: true,
                version: true,
                updatedAt: true,
                teacher: {
                  select: { user: { select: { displayName: true } } },
                },
                images: {
                  where: { storedFile: { purpose: 'STUDENT_FEEDBACK_IMAGE' } },
                  orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                  take: 3,
                  select: { storedFile: { select: mediaSelect } },
                },
              },
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
                parentUser: { select: { displayName: true } },
              },
            },
          },
        });
        return {
          data: {
            items: rows.map((lesson) => {
              const feedback = lesson.feedback.find(
                (item) => item.teacherId === lesson.teacherId,
              );
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
                teacherRatings: feedback?.teacherRatings ?? null,
                feedbackVersion: feedback?.version ?? 0,
                feedbackAuthorName: feedback?.teacher.user.displayName ?? null,
                feedbackValid: !!feedback && lesson.status === 'COMPLETED',
                review: review
                  ? toParentLessonReviewView(review, lesson.status)
                  : null,
                reviewAuthorName: review?.parentUser.displayName ?? null,
                feedbackImages:
                  feedback?.images.map(({ storedFile }) =>
                    this.mediaView(studentId, storedFile),
                  ) ?? [],
                feedbackUpdatedAt: feedback?.updatedAt.toISOString() ?? null,
              };
            }),
          },
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

  async readMedia(
    user: AuthenticatedUser,
    studentId: string,
    storedFileId: string,
  ) {
    const { campusId } = this.scopeService.require(user);
    const purpose = await this.prisma.$transaction(
      async (tx) => {
        await this.requireStudent(tx, campusId, studentId);
        const photo = await tx.storedFile.findFirst({
          where: {
            id: storedFileId,
            purpose: 'STUDENT_PROFILE_PHOTO',
            photoTargetStudentId: studentId,
            profilePhotoStudent: {
              is: { id: studentId, campusId, isActive: true },
            },
          },
          select: { id: true },
        });
        if (photo) return 'STUDENT_PROFILE_PHOTO' as const;
        const feedback = await tx.studentFeedback.findFirst({
          where: {
            campusId,
            studentId,
            teacher: { campusId },
            lessonSession: historyWhere(campusId, studentId),
            images: {
              some: {
                storedFileId,
                storedFile: { purpose: 'STUDENT_FEEDBACK_IMAGE' },
              },
            },
          },
          select: {
            teacherId: true,
            lessonSession: { select: { teacherId: true } },
          },
        });
        if (
          !feedback ||
          feedback.teacherId !== feedback.lessonSession.teacherId
        ) {
          this.notFound();
        }
        return 'STUDENT_FEEDBACK_IMAGE' as const;
      },
      { isolationLevel: 'RepeatableRead' },
    );
    return this.files.readPrivateFile(
      storedFileId,
      purpose === 'STUDENT_PROFILE_PHOTO'
        ? STUDENT_PROFILE_PHOTO_OPTIONS
        : STUDENT_FEEDBACK_IMAGE_OPTIONS,
    );
  }

  private async requireStudent(
    tx: Prisma.TransactionClient,
    campusId: string,
    studentId: string,
  ) {
    const student = await tx.student.findFirst({
      where: { id: studentId, campusId, isActive: true },
      select: { id: true },
    });
    if (!student) this.notFound();
  }

  private mediaView(
    studentId: string,
    file: { id: string; mimeType: string; sizeBytes: number },
  ) {
    return {
      id: file.id,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      accessUrl: `/operators/me/students/${studentId}/archive/media/${file.id}`,
    };
  }

  private notFound(): never {
    throw new DomainError(
      'RESOURCE_NOT_FOUND',
      'Student archive resource was not found',
      404,
    );
  }
}
