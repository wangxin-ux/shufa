import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { OperatorScopeService } from '../../common/auth/operator-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { lockRosterRelations, readActiveLessonMembers } from '../attendance/lesson-membership';
import { planPackageConsumption, InsufficientLessonBalanceError } from '../lesson-ledger/lesson-ledger.service';
import type { ConsumptionPackage } from '../lesson-ledger/lesson-ledger.service';
import type { OperatorAddLessonMemberDto, OperatorRemoveLessonMemberDto } from './dto/operator-lesson-members.dto';

const lessonSelect = {
  id: true, campusId: true, classGroupId: true, startsAt: true,
  status: true, version: true, lessonUnits: true,
} as const;
type Lesson = Prisma.LessonSessionGetPayload<{ select: typeof lessonSelect }>;

@Injectable()
export class OperatorLessonMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: OperatorScopeService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(user: AuthenticatedUser, lessonSessionId: string) {
    const scope = this.scopeService.require(user);
    return this.prisma.$transaction(async tx => {
      const lesson = await this.findLesson(tx, scope.campusId, lessonSessionId);
      return this.view(tx, lesson);
    }, { isolationLevel: 'RepeatableRead' });
  }

  add(user: AuthenticatedUser, lessonSessionId: string, dto: OperatorAddLessonMemberDto, key: string) {
    return this.change(user, lessonSessionId, dto.studentId, dto, key, 'add');
  }

  remove(user: AuthenticatedUser, lessonSessionId: string, studentId: string, dto: OperatorRemoveLessonMemberDto, key: string) {
    return this.change(user, lessonSessionId, studentId, dto, key, 'remove');
  }

  private async change(
    user: AuthenticatedUser, lessonSessionId: string, studentId: string,
    dto: OperatorRemoveLessonMemberDto, key: string, action: 'add' | 'remove',
  ) {
    const scope = this.scopeService.require(user);
    const route = action === 'add'
      ? `/operators/me/lesson-sessions/${lessonSessionId}/members`
      : `/operators/me/lesson-sessions/${lessonSessionId}/members/${studentId}/remove`;
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`
        SELECT "id" FROM "LessonSession"
        WHERE "id" = ${lessonSessionId}::uuid AND "campusId" = ${scope.campusId}::uuid FOR UPDATE
      `;
      const claim = await this.idempotency.claim(tx, {
        key, route, request: dto, campusId: scope.campusId, actorUserId: scope.userId,
      });
      if (claim.replayed) return claim.responseBody;
      const lesson = await this.findLesson(tx, scope.campusId, lessonSessionId);
      this.assertEditable(lesson, dto.version);
      await lockRosterRelations(tx, lesson, true, studentId);
      const student = await tx.student.findFirst({
        where: { id: studentId, campusId: scope.campusId, isActive: true },
        select: { id: true },
      });
      if (!student && action === 'add')
        throw new DomainError(ErrorCode.FORBIDDEN, 'The student is outside the active campus scope', 403);
      const regular = await tx.classMember.findFirst({
        where: { campusId: scope.campusId, classGroupId: lesson.classGroupId, studentId,
          leftAt: null, student: { campusId: scope.campusId, isActive: true } },
        select: { id: true },
      });
      const active = await tx.lessonTemporaryMember.findFirst({
        where: { campusId: scope.campusId, lessonSessionId, studentId, removedAt: null },
        select: { id: true, joinedAt: true },
      });
      if (action === 'remove' && regular)
        throw new DomainError(ErrorCode.CONFLICT, 'A regular member cannot be removed through this endpoint', 409);
      const changed = action === 'add' ? !regular && !active : !!active;
      if (changed) {
        if (action === 'add') {
          const at = new Date();
          const packages = await tx.$queryRaw<ConsumptionPackage[]>`
            SELECT "id", "mainBalanceUnits", "giftBalanceUnits", "mainReservedUnits", "giftReservedUnits",
              "isActive", "validFrom", "expiresAt"
            FROM "CoursePackage"
            WHERE "campusId" = ${scope.campusId}::uuid AND "studentId" = ${studentId}::uuid
              AND "isActive" = true AND "validFrom" <= ${at}
              AND ("expiresAt" IS NULL OR "expiresAt" >= ${at})
            ORDER BY "id" FOR SHARE
          `;
          try {
            planPackageConsumption(packages, lesson.lessonUnits, new Date());
          } catch (error: unknown) {
            if (error instanceof InsufficientLessonBalanceError)
              throw new DomainError(ErrorCode.INSUFFICIENT_LESSON_BALANCE,
                'The student has insufficient currently available lesson units', 409,
                { requiredUnits: error.requiredUnits, availableUnits: error.availableUnits });
            throw error;
          }
        }
        // Locks may have waited past the original start.
        this.assertEditable(lesson, dto.version);
        const now = new Date();
        const updated = await tx.lessonSession.updateMany({
          where: { id: lessonSessionId, campusId: scope.campusId, version: lesson.version,
            status: 'SCHEDULED', startsAt: { gt: now } },
          data: { version: { increment: 1 } },
        });
        if (updated.count !== 1) this.conflict(lesson.version);
        if (action === 'add') {
          await tx.lessonTemporaryMember.create({
            data: { campusId: scope.campusId, lessonSessionId, studentId,
              joinedAt: now, addedByUserId: scope.userId },
          });
        } else {
          const removed = await tx.lessonTemporaryMember.updateMany({
            where: { id: active!.id, campusId: scope.campusId, removedAt: null },
            data: { removedAt: now, removedByUserId: scope.userId },
          });
          if (removed.count !== 1) this.conflict(lesson.version);
        }
        await tx.auditLog.create({
          data: { campusId: scope.campusId, actorUserId: scope.userId,
            action: `OPERATOR_LESSON_MEMBER_${action.toUpperCase()}`, resourceType: 'LessonSession',
            resourceId: lessonSessionId, outcome: 'SUCCESS',
            details: { studentId, previousVersion: lesson.version, version: lesson.version + 1 } },
        });
        lesson.version++;
      } else {
        this.assertEditable(lesson, dto.version);
      }
      const result = await this.view(tx, lesson);
      await this.idempotency.complete(tx, {
        key, route, responseBody: result,
      });
      return result;
    });
  }

  private async findLesson(tx: Prisma.TransactionClient, campusId: string, id: string) {
    const lesson = await tx.lessonSession.findFirst({ where: { id, campusId }, select: lessonSelect });
    if (!lesson) throw new DomainError(ErrorCode.RESOURCE_NOT_FOUND, 'The lesson was not found', 404);
    return lesson;
  }

  private assertEditable(lesson: Lesson, version: number) {
    if (lesson.version !== version || lesson.version >= 2147483647) this.conflict(lesson.version);
    if (lesson.status !== 'SCHEDULED' || lesson.startsAt.getTime() <= Date.now())
      throw new DomainError(ErrorCode.CONFLICT, 'Only a future scheduled lesson can change temporary members', 409);
  }

  private conflict(currentVersion: number): never {
    throw new DomainError(ErrorCode.LESSON_VERSION_CONFLICT, 'The lesson version has changed', 409, { currentVersion });
  }

  private async view(tx: Prisma.TransactionClient, lesson: Lesson) {
    const serverTime = new Date();
    const canChange = lesson.status === 'SCHEDULED' && lesson.startsAt > serverTime;
    const historical = lesson.status === 'COMPLETED' || lesson.status === 'REVERSED';
    const members = historical
      ? (await tx.attendanceRecord.findMany({
          where: { campusId: lesson.campusId, lessonSessionId: lesson.id, includedInFinalRoster: true },
          orderBy: [{ student: { displayName: 'asc' } }, { studentId: 'asc' }],
          select: { studentId: true, student: { select: { displayName: true } } },
        })).map(row => ({ studentId: row.studentId, displayName: row.student.displayName,
          source: 'HISTORICAL' as const, canRemove: false }))
      : (await readActiveLessonMembers(tx, lesson))
        .map(row => ({ ...row, canRemove: canChange && row.source === 'TEMPORARY' }));
    return { lessonSessionId: lesson.id, lessonVersion: lesson.version, status: lesson.status,
      startsAt: lesson.startsAt.toISOString(), canChange, members, serverTime: serverTime.toISOString() };
  }
}
