import { Injectable } from '@nestjs/common';
import type { ParentLeaveStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CampusManagerScopeService } from '../../common/auth/campus-manager-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  CampusManagerLeaveRequestsQueryDto,
  CampusManagerRejectLeaveDto,
  CampusManagerReviewLeaveDto,
} from './dto/campus-manager-leave.dto';

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
export class CampusManagerLeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: CampusManagerScopeService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: CampusManagerLeaveRequestsQueryDto,
  ) {
    const scope = this.scopeService.require(user);
    const where: Prisma.ParentLeaveRequestWhereInput = {
      campusId: scope.campusId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, requests] = await Promise.all([
      this.prisma.parentLeaveRequest.count({ where }),
      this.prisma.parentLeaveRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: leaveViewSelect,
      }),
    ]);

    return {
      data: requests.map((request) => this.toView(request)),
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
    dto: CampusManagerReviewLeaveDto,
    idempotencyKey: string,
  ) {
    return this.review(user, leaveRequestId, 'APPROVED', dto, idempotencyKey);
  }

  reject(
    user: AuthenticatedUser,
    leaveRequestId: string,
    dto: CampusManagerRejectLeaveDto,
    idempotencyKey: string,
  ) {
    return this.review(user, leaveRequestId, 'REJECTED', dto, idempotencyKey);
  }

  private async review(
    user: AuthenticatedUser,
    leaveRequestId: string,
    status: 'APPROVED' | 'REJECTED',
    dto: CampusManagerReviewLeaveDto | CampusManagerRejectLeaveDto,
    idempotencyKey: string,
  ) {
    const scope = this.scopeService.require(user);
    const action = status === 'APPROVED' ? 'approve' : 'reject';
    const route = `/campus-managers/me/leave-requests/${leaveRequestId}/${action}`;

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
          action: `CAMPUS_LEAVE_${status === 'APPROVED' ? 'APPROVE' : 'REJECT'}`,
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

  private toView(request: LeaveViewRecord) {
    return {
      id: request.id,
      studentId: request.studentId,
      studentName: request.student.displayName,
      lessonSessionId: request.lessonSessionId,
      courseName: request.lessonSession.classGroup.courseName,
      startsAt: request.lessonSession.startsAt.toISOString(),
      reason: request.reason,
      status: request.status,
      reviewerName: request.reviewer?.displayName ?? null,
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
      reviewReason: request.reviewReason,
      version: request.version,
      createdAt: request.createdAt.toISOString(),
    };
  }
}
