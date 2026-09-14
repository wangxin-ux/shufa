import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EarningModule } from '../earning/earning.module';
import { FileModule } from '../file/file.module';
import { LessonLedgerModule } from '../lesson-ledger/lesson-ledger.module';
import { PartnerEarningModule } from '../partner-earning/partner-earning.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [
    AuthModule,
    EarningModule,
    FileModule,
    LessonLedgerModule,
    PartnerEarningModule,
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
