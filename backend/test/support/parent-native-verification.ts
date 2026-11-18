import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import type { Server } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { configureApplication } from '../../src/common/bootstrap/configure-app';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

export function validateNativeVerificationDatabase(value: string): URL {
  const target = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    !/^\/education_app_test_parent_native(?:_[a-z0-9]+)?_test$/.test(
      target.pathname,
    )
  ) {
    throw new Error(
      'Native verification requires its dedicated loopback test database',
    );
  }
  return target;
}

export function buildNativeCatalogFixture(runTag: string) {
  return {
    campus: {
      code: `NATIVE-${runTag}`,
      name: '启明东校区',
      address: '测试路1号',
      mapVisible: true,
      latitude: 28.2,
      longitude: 112.9,
    },
    admin: {
      displayName: '课程验证管理员',
      roles: { create: { roleCode: 'SUPER_ADMIN' as const } },
      authIdentities: {
        create: {
          provider: 'MOCK' as const,
          subject: 'mock-demo-super-admin',
        },
      },
    },
  };
}

async function main(): Promise<void> {
  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.AUTH_DRIVER !== 'mock' ||
    process.env.PAYMENT_DRIVER !== 'mock' ||
    process.env.MESSAGE_DRIVER !== 'mock'
  ) {
    throw new Error('Native verification must use test and mock adapters');
  }
  validateNativeVerificationDatabase(process.env.DATABASE_URL ?? '');
  // Load application configuration only after checking the isolated target.
  const loadApplication = createRequire(__filename);
  const { AppModule } = loadApplication(
    '../../src/app.module',
  ) as typeof import('../../src/app.module');
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  configureApplication(app);
  await app.init();
  const prisma = app.get(PrismaService);
  const runTag = randomUUID();
  const catalogFixture = buildNativeCatalogFixture(runTag);
  const ownedUsers: string[] = [];
  const fixture = await prisma.$transaction(async (tx) => {
    const campus = await tx.campus.create({
      data: catalogFixture.campus,
    });
    const admin = await tx.user.create({ data: catalogFixture.admin });
    const parent = await tx.user.create({
      data: {
        displayName: '陈晨家长',
        roles: { create: { roleCode: 'PARENT', campusId: campus.id } },
        authIdentities: {
          create: { provider: 'MOCK', subject: 'mock-demo-east-parent' },
        },
      },
    });
    const teacher = await tx.user.create({
      data: {
        displayName: '林老师',
        roles: { create: { roleCode: 'TEACHER', campusId: campus.id } },
        teacherProfile: {
          create: { campusId: campus.id, employeeCode: runTag },
        },
        authIdentities: {
          create: { provider: 'MOCK', subject: 'mock-demo-east-teacher' },
        },
      },
      include: { teacherProfile: true },
    });
    const student = await tx.student.create({
      data: { campusId: campus.id, displayName: '陈晨', profileAge: 9 },
    });
    await tx.parentStudentBinding.create({
      data: {
        campusId: campus.id,
        studentId: student.id,
        parentUserId: parent.id,
        isPrimary: true,
      },
    });
    const group = await tx.classGroup.create({
      data: {
        campusId: campus.id,
        teacherId: teacher.teacherProfile!.id,
        name: '专业美术班',
        courseName: '专业美术',
        members: { create: { campusId: campus.id, studentId: student.id } },
      },
    });
    const lesson = await tx.lessonSession.create({
      data: {
        campusId: campus.id,
        teacherId: teacher.teacherProfile!.id,
        classGroupId: group.id,
        startsAt: new Date(Date.now() - 7200000),
        endsAt: new Date(Date.now() - 3600000),
        status: 'COMPLETED',
        completedAt: new Date(),
        attendanceRecords: {
          create: {
            campusId: campus.id,
            studentId: student.id,
            status: 'PRESENT',
            recordedByUserId: teacher.id,
          },
        },
        teachingRecord: {
          create: {
            campusId: campus.id,
            teacherId: teacher.teacherProfile!.id,
            recordedByUserId: teacher.id,
            attendeeCount: 1,
            lessonUnits: 100,
            completedAt: new Date(),
          },
        },
      },
    });
    const futureLessons: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const future = await tx.lessonSession.create({
        data: {
          campusId: campus.id,
          teacherId: teacher.teacherProfile!.id,
          classGroupId: group.id,
          startsAt: new Date(Date.now() + 172800000 + index * 7200000),
          endsAt: new Date(Date.now() + 176400000 + index * 7200000),
        },
      });
      futureLessons.push(future.id);
      if (index < 2)
        await tx.parentLeaveRequest.create({
          data: {
            campusId: campus.id,
            parentUserId: parent.id,
            studentId: student.id,
            lessonSessionId: future.id,
            reason: '家庭临时有事',
            status: 'PENDING',
          },
        });
    }
    return {
      adminId: admin.id,
      parentId: parent.id,
      teacherId: teacher.id,
      studentId: student.id,
      campusId: campus.id,
      lessonId: lesson.id,
      futureLessons,
    };
  });
  ownedUsers.push(fixture.parentId, fixture.teacherId, fixture.adminId);
  await app.listen(0, '127.0.0.1');
  const address = (app.getHttpServer() as Server).address();
  console.log(
    JSON.stringify({
      kind: 'native-verification-ready',
      runTag,
      port: typeof address === 'object' && address ? address.port : null,
      ...fixture,
    }),
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const summary = {
      student: await prisma.student.findUnique({
        where: { id: fixture.studentId },
        select: {
          profileAge: true,
          homeAddress: true,
          profileVersion: true,
          profilePhotoFileId: true,
        },
      }),
      feedback: await prisma.studentFeedback.findMany({
        where: {
          studentId: fixture.studentId,
          lessonSessionId: fixture.lessonId,
        },
        select: { performanceRating: true, content: true },
      }),
      reviews: await prisma.parentLessonReview.findMany({
        where: {
          studentId: fixture.studentId,
          lessonSessionId: fixture.lessonId,
        },
        select: {
          teaching: true,
          communication: true,
          environment: true,
          overall: true,
          note: true,
        },
      }),
      leaveCount: await prisma.parentLeaveRequest.count({
        where: { parentUserId: fixture.parentId },
      }),
      products: await prisma.courseProduct.findMany({
        where: { campusId: fixture.campusId },
        select: {
          id: true,
          status: true,
          version: true,
          name: true,
          courseName: true,
          classType: true,
          priceFen: true,
          mainUnits: true,
          giftUnits: true,
        },
      }),
    };
    await prisma.user.updateMany({
      where: { id: { in: ownedUsers } },
      data: { status: 'DISABLED' },
    });
    await app.close();
    console.log(
      JSON.stringify({ kind: 'native-verification-stopped', ...summary }),
    );
    process.exit(0);
  };
  createInterface({ input: process.stdin }).on('line', (line) => {
    if (line.trim() === 'stop') void stop();
  });
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Native verification failed',
    );
    process.exitCode = 1;
  });
}
