import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DomainError } from '../errors/domain-error';
import { ErrorCode } from '../errors/error-codes';
import type { AuthenticatedUser } from './authenticated-user';

export interface TeacherScope {
  userId: string;
  teacherProfileId: string;
  campusId: string;
}

@Injectable()
export class TeacherScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(user: AuthenticatedUser): Promise<TeacherScope> {
    const campusIds = user.roles
      .filter(({ code, campusId }) => code === 'TEACHER' && campusId)
      .map(({ campusId }) => campusId as string);
    if (campusIds.length !== 1) {
      this.forbidden();
    }

    const teacher = await this.prisma.teacherProfile.findFirst({
      where: {
        userId: user.userId,
        campusId: campusIds[0],
        isActive: true,
      },
      select: { id: true, campusId: true },
    });
    if (!teacher) {
      this.forbidden();
    }

    return {
      userId: user.userId,
      teacherProfileId: teacher.id,
      campusId: teacher.campusId,
    };
  }

  async assertLessonSessionInScope(
    scope: TeacherScope,
    lessonSessionId: string,
  ): Promise<void> {
    const lesson = await this.prisma.lessonSession.findUnique({
      where: { id: lessonSessionId },
      select: { campusId: true, teacherId: true },
    });
    if (!lesson) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lesson session was not found',
        404,
      );
    }
    if (
      lesson.campusId !== scope.campusId ||
      lesson.teacherId !== scope.teacherProfileId
    ) {
      this.forbidden();
    }
  }

  async assertStudentInScope(
    scope: TeacherScope,
    studentId: string,
  ): Promise<void> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: {
        campusId: true,
        classMemberships: {
          where: {
            campusId: scope.campusId,
            leftAt: null,
            classGroup: {
              teacherId: scope.teacherProfileId,
              status: 'ACTIVE',
            },
          },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!student) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Student was not found',
        404,
      );
    }
    if (
      student.campusId !== scope.campusId ||
      student.classMemberships.length === 0
    ) {
      this.forbidden();
    }
  }

  private forbidden(): never {
    throw new DomainError(
      ErrorCode.FORBIDDEN,
      'The resource is outside the teacher scope',
      403,
    );
  }
}
