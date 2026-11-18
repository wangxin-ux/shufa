import { ParentPortalService } from './parent-portal.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ParentScopeService } from '../../common/auth/parent-scope.service';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { StoredFileService } from '../file/stored-file.service';
import { activeLessonMemberWhere } from '../attendance/lesson-membership';

describe('parent home read-only directory and upcoming lessons', () => {
  const scope = { campusId: 'own-campus', userId: 'parent' };
  const student = { id: 'bound-student', displayName: '陈晨', profileAge: 9 };

  function fixture(bound = true) {
    const lessons = [{
      id: 'future',
      startsAt: new Date('2026-10-06T06:00:00Z'),
      endsAt: new Date('2026-10-06T07:00:00Z'),
      campus: { name: '东校区' },
      classGroup: { courseName: '硬笔书法' },
      teacher: { user: { displayName: '林老师' } },
    }];
    const prisma = {
      coursePackage: { findMany: jest.fn().mockResolvedValue([]) },
      lessonSession: {
        findMany: jest.fn().mockResolvedValue(lessons),
        findFirst: jest.fn().mockResolvedValue(lessons[0]),
      },
      teacherProfile: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'teacher', specialties: ['硬笔书法'], user: { displayName: '林老师' } },
        ]),
      },
      attendanceRecord: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new ParentPortalService(
      prisma as unknown as PrismaService,
      { resolveStudent: jest.fn().mockResolvedValue(bound ? student : null) } as unknown as ParentScopeService,
      {} as IdempotencyService,
      {} as StoredFileService,
    );
    return { prisma, service };
  }

  it('returns scoped public teacher fields and the same first upcoming lesson as its reminder', async () => {
    const { service, prisma } = fixture();
    const home = await service.getHome(scope) as unknown as {
      teachers: unknown[];
      reminders: unknown[];
      nextLesson: unknown;
    };
    expect(home.teachers).toEqual([
      { id: 'teacher', name: '林老师', specialties: ['硬笔书法'] },
    ]);
    expect(home.reminders).toHaveLength(1);
    expect(home.nextLesson).toEqual(home.reminders[0]);
    expect(prisma.teacherProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { campusId: scope.campusId, isActive: true, user: { status: 'ACTIVE' } },
      select: { id: true, specialties: true, user: { select: { displayName: true } } },
    }));
    expect(prisma.lessonSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        campusId: scope.campusId,
        AND: [{ OR: [
          { status: 'SCHEDULED', startsAt: { gte: expect.any(Date) as Date } },
          { status: 'IN_PROGRESS', endsAt: { gte: expect.any(Date) as Date } },
        ] }, activeLessonMemberWhere(scope.campusId, student.id)],
      }) as unknown,
      take: 20,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    }));
  });

  it('returns no directory or reminders without a bound student', async () => {
    const { service, prisma } = fixture(false);
    expect(await service.getHome(scope)).toMatchObject({
      student: null, nextLesson: null, teachers: [], reminders: [],
    });
    expect(prisma.teacherProfile.findMany).not.toHaveBeenCalled();
    expect(prisma.lessonSession.findMany).not.toHaveBeenCalled();
  });
});
