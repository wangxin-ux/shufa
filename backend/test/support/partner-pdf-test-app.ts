import { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { configureApplication } from '../../src/common/bootstrap/configure-app';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { assertPartnerPdfTestTarget } from './partner-pdf-test-database';

export async function createPartnerPdfTestApp(
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
  beforeInit?: (app: INestApplication) => void,
): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  assertPartnerPdfTestTarget(process.env);
  Object.assign(process.env, {
    PORT: '3001',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_ACCESS_SECRET: 'partner-pdf-test-access-secret-32-characters',
    JWT_REFRESH_SECRET: 'partner-pdf-test-refresh-secret-32-characters',
    FILE_STORAGE_DRIVER: 'local',
    FILE_STORAGE_ROOT: './storage/partner-pdf-test',
    PAYOUT_DRIVER: 'manual',
    TZ: 'Asia/Shanghai',
  });
  const { AppModule } = jest.requireActual<
    typeof import('../../src/app.module')
  >('../../src/app.module');
  const builder = Test.createTestingModule({
    imports: [AppModule],
  });
  const moduleRef = await (configure ? configure(builder) : builder).compile();
  const app = moduleRef.createNestApplication();
  try {
    configureApplication(app);
    beforeInit?.(app);
    await app.init();
    return { app, prisma: app.get(PrismaService) };
  } catch (error) {
    await app.close();
    throw error;
  }
}
