import { Injectable } from '@nestjs/common';
import type { ParentLeaveStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { OperatorScopeService } from '../../common/auth/operator-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { lockRosterRelations } from '../attendance/lesson-membership';
import { readReviewableLeaveIds } from './operator-leave-reviewability';
import type {
  OperatorLeaveRequestsQueryDto,
  OperatorRejectLeaveDto,
  OperatorReviewLeaveDto,
} from './dto/operator-leave.dto';

const leaveViewSelect = {
  id: true,
  studentId: true,
  lessonSessionId: true,
  reason: true,
  status: true,
  reviewedAt: true,
  reviewReason: true,
  version: true,
  createdAt: true,
  student: { select: { displayName: true } },
  lessonSession: {
    select: {
      startsAt: true,
      classGroup: { select: { courseName: true } },
    },
  },
  reviewer: { select: { displayName: true } },
} satisfies Prisma.ParentLeaveRequestSelect;

type LeaveViewRecord = Prisma.ParentLeaveRequestGetPayload<{
  select: typeof leaveViewSelect;
}>;

interface LockedLeaveRequest {
  id: string;
  campusId: string;
  status: ParentLeaveStatus;
  version: number;
}

@Injectable()
export class OperatorLeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: OperatorScopeService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async list(user: AuthenticatedUser, query: OperatorLeaveRequestsQueryDto) {
    const scope = this.scopeService.require(user);
    if (query.reviewedOnly !== undefined && query.status !== undefined) {
      throw new DomainError(
        ErrorCode.BAD_REQUEST,
        'reviewedOnly and status cannot be combined',
        400,
      );
    }
    const where: Prisma.ParentLeaveRequestWhereInput = {
      campusId: scope.campusId,
      ...(query.reviewedOnly
        ? { status: { in: ['APPROVED', 'REJECTED'] } }
        : query.status
          ? { status: query.status }
          : {}),
    };
    const orderBy: Prisma.ParentLeaveRequestOrderByWithRelationInput[] =
      query.reviewedOnly
        ? [{ reviewedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }];
    const [total, requests, reviewableIds] = await this.prisma.$transaction(
      async (transaction) => {
        const [total, requests] = await Promise.all([
          transaction.parentLeaveRequest.count({ where }),
          transaction.parentLeaveRequest.findMany({
            where,
            orderBy,
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
            select: leaveViewSelect,
          }),
        ]);
        const reviewableIds = await readReviewableLeaveIds(
          transaction, scope.campusId, requests.map(request => request.id),
        );
        return [total, requests, reviewableIds] as const;
      },
      { isolationLevel: 'RepeatableRead' },
    );

    return {
      data: requests.map((request) => this.toView(
        request, request.status === 'PENDING' && reviewableIds.has(request.id),
      )),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  approve(
    user: AuthenticatedUser,
    leaveRequestId: string,
    dto: OperatorReviewLeaveDto,
    idempotencyKey: string,
  ) {
    return this.review(user, leaveRequestId, 'APPROVED', dto, idempotencyKey);
  }

  reject(
    user: AuthenticatedUser,
    leaveRequestId: string,
    dto: OperatorRejectLeaveDto,
    idempotencyKey: string,
  ) {
    return this.review(user, leaveRequestId, 'REJECTED', dto, idempotencyKey);
  }

  private async review(
    user: AuthenticatedUser,
    leaveRequestId: string,
    status: 'APPROVED' | 'REJECTED',
    dto: OperatorReviewLeaveDto | OperatorRejectLeaveDto,
    idempotencyKey: string,
  ) {
    const scope = this.scopeService.require(user);
    const action = status === 'APPROVED' ? 'approve' : 'reject';
    const route = `/operators/me/leave-requests/${leaveRequestId}/${action}`;

    return this.prisma.$transaction(async (transaction) => {
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

      const target = await transaction.parentLeaveRequest.findFirst({
        where: { id: leaveRequestId, campusId: scope.campusId },
        select: { studentId: true, lessonSessionId: true, temporaryMemberId: true },
      });
      if (!target)
        throw new DomainError(ErrorCode.RESOURCE_NOT_FOUND, 'Leave request was not found', 404);
      const lessons = await transaction.$queryRaw<Array<{ id: string; campusId: string; classGroupId: string }>>`
        SELECT "id", "campusId", "classGroupId" FROM "LessonSession"
        WHERE "id" = ${target.lessonSessionId}::uuid AND "campusId" = ${scope.campusId}::uuid FOR UPDATE
      `;
      if (!lessons[0])
        throw new DomainError(ErrorCode.FORBIDDEN, 'The lesson relationship is unavailable', 403);
      await lockRosterRelations(transaction, lessons[0]);
      const member = await transaction.lessonSession.findFirst({
        where: { id: target.lessonSessionId, campusId: scope.campusId,
          ...(target.temporaryMemberId
            ? { temporaryMembers: { some: {
                id: target.temporaryMemberId, campusId: scope.campusId,
                studentId: target.studentId, removedAt: null,
                student: { campusId: scope.campusId, isActive: true },
              } } }
            : { classGroup: { members: { some: {
                campusId: scope.campusId, studentId: target.studentId, leftAt: null,
                student: { campusId: scope.campusId, isActive: true },
              } } } }) },
        select: { id: true },
      });
      if (!member)
        throw new DomainError(ErrorCode.FORBIDDEN, 'The student no longer belongs to this lesson', 403);
      const locked = await transaction.$queryRaw<LockedLeaveRequest[]>`
        SELECT "id", "campusId", "status", "version"
        FROM "ParentLeaveRequest"
        WHERE "id" = ${leaveRequestId}::uuid
        FOR UPDATE
      `;
      const leaveRequest = locked[0];
      if (!leaveRequest || leaveRequest.campusId !== scope.campusId) {
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Leave request was not found',
          404,
        );
      }
      if (leaveRequest.status !== 'PENDING') {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'Only a pending leave request can be reviewed',
          409,
          { currentStatus: leaveRequest.status },
        );
      }
      if (leaveRequest.version !== dto.version) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'The leave request version has changed',
          409,
          { currentVersion: leaveRequest.version },
        );
      }

      const reviewedAt = new Date();
      const updated = await transaction.parentLeaveRequest.updateMany({
        where: {
          id: leaveRequestId,
          campusId: scope.campusId,
          status: 'PENDING',
          version: leaveRequest.version,
        },
        data: {
          status,
          reviewerUserId: scope.userId,
          reviewedAt,
          reviewReason: dto.reviewReason?.trim() || null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'The leave request version has changed',
          409,
        );
      }
      const result = await transaction.parentLeaveRequest.findUniqueOrThrow({
        where: { id: leaveRequestId },
        select: leaveViewSelect,
      });
      const view = this.toView(result);
      await transaction.auditLog.create({
        data: {
          campusId: scope.campusId,
          actorUserId: scope.userId,
          action: `OPERATOR_LEAVE_${status === 'APPROVED' ? 'APPROVE' : 'REJECT'}`,
          resourceType: 'ParentLeaveRequest',
          resourceId: leaveRequestId,
          outcome: 'SUCCESS',
          details: {
            previousStatus: 'PENDING',
            status,
            previousVersion: leaveRequest.version,
            version: leaveRequest.version + 1,
            reviewReason: view.reviewReason,
          },
        },
      });
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: view,
      });
      return view;
    });
  }

  private toView(request: LeaveViewRecord, canReview = false) {
    return {
      id: request.id,
      studentId: request.studentId,
      studentName: request.student.displayName,
      lessonSessionId: request.lessonSessionId,
      courseName: request.lessonSession.classGroup.courseName,
      startsAt: request.lessonSession.startsAt.toISOString(),
      reason: request.reason,
      status: request.status,
      canReview,
      reviewerName: request.reviewer?.displayName ?? null,
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
      reviewReason: request.reviewReason,
      version: request.version,
      createdAt: request.createdAt.toISOString(),
    };
  }
}
