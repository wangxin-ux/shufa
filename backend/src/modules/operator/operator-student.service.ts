import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { OperatorScopeService } from '../../common/auth/operator-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  lessonBalanceSelect,
  summarizeLessonBalances,
} from '../lesson-ledger/lesson-balance';
import { calculateStudentAge } from '../parent-portal/parent-student-age';
import type {
  OperatorCreateStudentDto,
  OperatorStudentsQueryDto,
} from './dto/operator-student.dto';

const CREATE_ROUTE = '/operators/me/students';

@Injectable()
export class OperatorStudentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: OperatorScopeService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async list(user: AuthenticatedUser, query: OperatorStudentsQueryDto) {
    const scope = this.scopeService.require(user);
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
        select: this.summarySelect(),
      }),
    ]);

    return {
      data: students.map((student) => this.toSummary(student)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  async detail(user: AuthenticatedUser, studentId: string) {
    const scope = this.scopeService.require(user);
    const now = new Date();
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        campusId: scope.campusId,
        isActive: true,
      },
      select: this.summarySelect(),
    });
    if (!student) {
      this.notFound();
    }

    const [packages, recentAttendanceCount, consumed] = await Promise.all([
      this.prisma.coursePackage.aggregate({
        where: {
          campusId: scope.campusId,
          studentId,
          isActive: true,
          validFrom: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
        },
        _sum: lessonBalanceSelect,
      }),
      this.prisma.attendanceRecord.count({
        where: {
          includedInFinalRoster: true,
          campusId: scope.campusId,
          studentId,
          lessonSession: { status: 'COMPLETED' },
        },
      }),
      this.prisma.lessonLedgerEntry.aggregate({
        where: {
          campusId: scope.campusId,
          studentId,
          entryType: 'CONSUME',
        },
        _sum: { deltaUnits: true },
      }),
    ]);

    return {
      ...this.toSummary(student),
      ...summarizeLessonBalances([
        {
          mainBalanceUnits: packages._sum.mainBalanceUnits ?? 0,
          giftBalanceUnits: packages._sum.giftBalanceUnits ?? 0,
          mainReservedUnits: packages._sum.mainReservedUnits ?? 0,
          giftReservedUnits: packages._sum.giftReservedUnits ?? 0,
        },
      ]),
      recentAttendanceCount,
      recentConsumedUnits: Math.abs(consumed._sum.deltaUnits ?? 0),
    };
  }

  async listClassOptions(user: AuthenticatedUser) {
    const scope = this.scopeService.require(user);
    const classes = await this.prisma.classGroup.findMany({
      where: {
        campusId: scope.campusId,
        status: 'ACTIVE',
        teacher: { isActive: true, user: { status: 'ACTIVE' } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        courseName: true,
        defaultLessonUnits: true,
        teacher: {
          select: {
            id: true,
            user: { select: { displayName: true } },
          },
        },
      },
    });
    return {
      classes: classes.map((classGroup) => ({
        classGroupId: classGroup.id,
        className: classGroup.name,
        courseName: classGroup.courseName,
        teacherId: classGroup.teacher.id,
        teacherName: classGroup.teacher.user.displayName,
        defaultLessonUnits: classGroup.defaultLessonUnits,
      })),
    };
  }

  async create(
    user: AuthenticatedUser,
    dto: OperatorCreateStudentDto,
    idempotencyKey: string,
  ) {
    const scope = this.scopeService.require(user);
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route: CREATE_ROUTE,
        request: dto,
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }

      const classGroup = dto.classGroupId
        ? await transaction.classGroup.findFirst({
            where: {
              id: dto.classGroupId,
              campusId: scope.campusId,
              status: 'ACTIVE',
            },
            select: { id: true, name: true },
          })
        : null;
      if (dto.classGroupId && !classGroup) {
        this.notFound('The selected class is unavailable in this campus');
      }

      const created = await transaction.student.create({
        data: {
          campusId: scope.campusId,
          displayName: dto.displayName,
          birthDate: dto.birthDate
            ? new Date(`${dto.birthDate}T00:00:00.000Z`)
            : null,
          isActive: true,
        },
        select: {
          id: true,
          campusId: true,
          displayName: true,
          birthDate: true,
        },
      });
      if (classGroup) {
        await transaction.classMember.create({
          data: {
            campusId: scope.campusId,
            classGroupId: classGroup.id,
            studentId: created.id,
          },
        });
      }

      const result = {
        id: created.id,
        campusId: created.campusId,
        displayName: created.displayName,
        ageYears: created.birthDate
          ? calculateStudentAge(created.birthDate)
          : null,
        classNames: classGroup ? [classGroup.name] : [],
      };
      await transaction.auditLog.create({
        data: {
          campusId: scope.campusId,
          actorUserId: scope.userId,
          action: 'OPERATOR_STUDENT_CREATE',
          resourceType: 'Student',
          resourceId: created.id,
          outcome: 'SUCCESS',
          details: {
            displayName: created.displayName,
            classGroupId: classGroup?.id ?? null,
          },
        },
      });
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route: CREATE_ROUTE,
        responseBody: this.asJson(result),
      });
      return result;
    });
  }

  private summarySelect() {
    return {
      id: true,
      campusId: true,
      displayName: true,
      birthDate: true,
      classMemberships: {
        where: {
          leftAt: null,
          classGroup: { status: 'ACTIVE' as const },
        },
        select: { classGroup: { select: { name: true } } },
      },
    };
  }

  private toSummary(student: {
    id: string;
    campusId: string;
    displayName: string;
    birthDate: Date | null;
    classMemberships: Array<{ classGroup: { name: string } }>;
  }) {
    return {
      id: student.id,
      campusId: student.campusId,
      displayName: student.displayName,
      ageYears: student.birthDate
        ? calculateStudentAge(student.birthDate)
        : null,
      classNames: student.classMemberships
        .map(({ classGroup }) => classGroup.name)
        .sort(),
    };
  }

  private asJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private notFound(
    message = 'The student was not found in the authenticated campus',
  ): never {
    throw new DomainError(ErrorCode.RESOURCE_NOT_FOUND, message, 404);
  }
}
