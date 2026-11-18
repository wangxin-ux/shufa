import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { configureApplication } from '../../src/common/bootstrap/configure-app';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { assertTeacherPdfTestTarget } from './teacher-pdf-test-database';

export async function completeTeacherFixtureCleanup(
  steps: ReadonlyArray<() => Promise<void>>,
): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) {
    throw new AggregateError(errors, 'Teacher fixture cleanup failed');
  }
}

export async function createTeacherPdfTestApp(): Promise<{
  app: INestApplication<Server>;
  prisma: PrismaService;
}> {
  const target = assertTeacherPdfTestTarget(process.env);
  Object.assign(process.env, {
    PORT: '3001',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    FILE_STORAGE_DRIVER: 'local',
    FILE_STORAGE_ROOT: `./storage/teacher-pdf-${process.env.TEACHER_PDF_TEST_RUN_ID}`,
    PAYOUT_DRIVER: 'manual',
    TZ: 'Asia/Shanghai',
  });
  const { AppModule } = jest.requireActual<
    typeof import('../../src/app.module')
  >('../../src/app.module');
  const { PrismaService } = jest.requireActual<
    typeof import('../../src/infrastructure/prisma/prisma.service')
  >('../../src/infrastructure/prisma/prisma.service');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<Server>>();
  try {
    configureApplication(app);
    await app.init();
    const prisma = app.get(PrismaService);
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT current_database() AS name
    `;
    if (rows.length !== 1 || rows[0].name !== target.pathname.slice(1)) {
      throw new Error('Teacher PDF database connection identity mismatch');
    }
    return { app, prisma };
  } catch (error) {
    await app.close();
    throw error;
  }
}
