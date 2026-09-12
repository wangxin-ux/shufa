import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FileModule } from '../file/file.module';
import { HrController } from './hr.controller';
import { HrRecordController } from './hr-record.controller';
import { HrRecordService } from './hr-record.service';
import { HrService } from './hr.service';

@Module({
  imports: [AuthModule, FileModule],
  controllers: [HrController, HrRecordController],
  providers: [HrService, HrRecordService],
})
export class HrModule {}
