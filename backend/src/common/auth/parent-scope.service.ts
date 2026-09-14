import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from './authenticated-user';
import { DomainError } from '../errors/domain-error';
import { ErrorCode } from '../errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface ParentScope {
  userId: string;
  campusId: string;
}

export interface BoundParentStudent {
  id: string;
  campusId: string;
  displayName: string;
  birthDate: Date | null;
  profileAge: number | null;
  homeAddress: string | null;
  profileVersion: number;
}

@Injectable()
export class ParentScopeService {
  constructor(private readonly prisma: PrismaService) {}

  resolve(user: AuthenticatedUser): ParentScope {
    const campusIds = new Set(
      user.roles
        .filter(({ code, campusId }) => code === 'PARENT' && campusId)
        .map(({ campusId }) => campusId as string),
    );
    if (campusIds.size !== 1) {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        'The parent role must resolve to exactly one campus',
        403,
      );
    }
    return { userId: user.userId, campusId: [...campusIds][0] };
  }

  async resolveStudent(
    scope: ParentScope,
    requestedStudentId?: string,
  ): Promise<BoundParentStudent | null> {
    const binding = await this.prisma.parentStudentBinding.findFirst({
      where: {
        parentUserId: scope.userId,
        campusId: scope.campusId,
        ...(requestedStudentId ? { studentId: requestedStudentId } : {}),
        student: { isActive: true, campusId: scope.campusId },
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: {
        student: {
          select: {
            id: true,
            campusId: true,
            displayName: true,
            birthDate: true,
            profileAge: true,
            homeAddress: true,
            profileVersion: true,
          },
        },
      },
    });
    if (!binding && requestedStudentId) {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        'The student is outside the authenticated parent scope',
        403,
      );
    }
    return binding?.student ?? null;
  }

  async listStudents(scope: ParentScope): Promise<BoundParentStudent[]> {
    const bindings = await this.prisma.parentStudentBinding.findMany({
      where: {
        parentUserId: scope.userId,
        campusId: scope.campusId,
        student: { isActive: true, campusId: scope.campusId },
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: {
        student: {
          select: {
            id: true,
            campusId: true,
            displayName: true,
            birthDate: true,
            profileAge: true,
            homeAddress: true,
            profileVersion: true,
          },
        },
      },
    });
    return bindings.map(({ student }) => student);
  }
}
