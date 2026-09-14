import { Injectable } from '@nestjs/common';
import { CampusManagerScopeService } from '../../common/auth/campus-manager-scope.service';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class CampusManagerReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: CampusManagerScopeService,
  ) {}

  async getDashboard(user: AuthenticatedUser) {
    const scope = this.scopeService.require(user);
    const serverTime = new Date();
    const [manager, campus] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: scope.userId, status: 'ACTIVE' },
        select: { displayName: true },
      }),
      this.prisma.campus.findUnique({
        where: { id: scope.campusId },
        select: { id: true, name: true, timezone: true },
      }),
    ]);
    if (!manager || !campus) {
      this.forbidden();
    }

    const { start, end } = this.zonedDayBounds(serverTime, campus.timezone);
    const [activeStudentCount, todayLessonCount, pendingLeaveCount, latest] =
      await Promise.all([
        this.prisma.student.count({
          where: { campusId: scope.campusId, isActive: true },
        }),
        this.prisma.lessonSession.count({
          where: {
            campusId: scope.campusId,
            startsAt: { gte: start, lt: end },
            status: { not: 'CANCELLED' },
          },
        }),
        this.prisma.parentLeaveRequest.count({
          where: { campusId: scope.campusId, status: 'PENDING' },
        }),
        this.prisma.parentLeaveRequest.findFirst({
          where: { campusId: scope.campusId, status: 'PENDING' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            student: { select: { displayName: true } },
            lessonSession: {
              select: {
                startsAt: true,
                classGroup: { select: { courseName: true } },
              },
            },
          },
        }),
      ]);

    return {
      manager: { displayName: manager.displayName },
      campus: { id: campus.id, name: campus.name },
      activeStudentCount,
      todayLessonCount,
      pendingLeaveCount,
      latestPendingLeave: latest
        ? {
            id: latest.id,
            studentName: latest.student.displayName,
            courseName: latest.lessonSession.classGroup.courseName,
            startsAt: latest.lessonSession.startsAt.toISOString(),
          }
        : null,
      serverTime: serverTime.toISOString(),
    };
  }

  async getProfile(user: AuthenticatedUser) {
    const scope = this.scopeService.require(user);
    const manager = await this.prisma.user.findFirst({
      where: { id: scope.userId, status: 'ACTIVE' },
      select: {
        displayName: true,
        roles: {
          where: {
            roleCode: 'CAMPUS_MANAGER',
            campusId: scope.campusId,
          },
          select: { campus: { select: { id: true, name: true } } },
        },
      },
    });
    const campus = manager?.roles[0]?.campus;
    if (!manager || !campus || manager.roles.length !== 1) {
      this.forbidden();
    }

    return {
      displayName: manager.displayName,
      roleCode: 'CAMPUS_MANAGER' as const,
      campusId: campus.id,
      campusName: campus.name,
    };
  }

  private zonedDayBounds(now: Date, timeZone: string) {
    const local = this.zonedParts(now, timeZone);
    const nextDate = new Date(
      Date.UTC(local.year, local.month - 1, local.day + 1),
    );
    return {
      start: this.zonedMidnightToUtc(
        local.year,
        local.month,
        local.day,
        timeZone,
      ),
      end: this.zonedMidnightToUtc(
        nextDate.getUTCFullYear(),
        nextDate.getUTCMonth() + 1,
        nextDate.getUTCDate(),
        timeZone,
      ),
    };
  }

  private zonedMidnightToUtc(
    year: number,
    month: number,
    day: number,
    timeZone: string,
  ): Date {
    const desired = Date.UTC(year, month - 1, day);
    let candidate = desired;
    for (let index = 0; index < 3; index += 1) {
      const observed = this.zonedParts(new Date(candidate), timeZone);
      candidate +=
        desired -
        Date.UTC(
          observed.year,
          observed.month - 1,
          observed.day,
          observed.hour,
          observed.minute,
          observed.second,
        );
    }
    return new Date(candidate);
  }

  private zonedParts(date: Date, timeZone: string) {
    const values = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(date)
        .map(({ type, value }) => [type, value]),
    );
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
      second: Number(values.second),
    };
  }

  private forbidden(): never {
    throw new DomainError(
      ErrorCode.FORBIDDEN,
      'The campus manager profile is outside the authenticated scope',
      403,
    );
  }
}
