import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './common/config/env.validation';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { RequestIdMiddleware } from './common/request-id/request-id.middleware';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { HealthController } from './modules/health/health.controller';
import { TeacherPortalModule } from './modules/teacher-portal/teacher-portal.module';
import { ParentPortalModule } from './modules/parent-portal/parent-portal.module';
import { EarningModule } from './modules/earning/earning.module';
import { FileModule } from './modules/file/file.module';
import { WithdrawalModule } from './modules/withdrawal/withdrawal.module';
import { CampusManagerModule } from './modules/campus-manager/campus-manager.module';
import { ManagementModule } from './modules/management/management.module';
import { PartnerModule } from './modules/partner/partner.module';
import { PartnerEarningModule } from './modules/partner-earning/partner-earning.module';
import { GroupBuyingModule } from './modules/group-buying/group-buying.module';
import { RosterExchangeModule } from './modules/roster-exchange/roster-exchange.module';
import { FinanceModule } from './modules/finance/finance.module';
import { HrModule } from './modules/hr/hr.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['../.env', '.env'],
      isGlobal: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
    IdempotencyModule,
    AuthModule,
    AttendanceModule,
    EarningModule,
    FileModule,
    WithdrawalModule,
    FeedbackModule,
    TeacherPortalModule,
    ParentPortalModule,
    CampusManagerModule,
    PartnerModule,
    PartnerEarningModule,
    ManagementModule,
    GroupBuyingModule,
    RosterExchangeModule,
    FinanceModule,
    HrModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
