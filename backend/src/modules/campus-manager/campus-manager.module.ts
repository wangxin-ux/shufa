import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CampusManagerController } from './campus-manager.controller';
import { CampusManagerLeaveService } from './campus-manager-leave.service';
import { CampusManagerReadService } from './campus-manager-read.service';
import { CampusManagerSchedulingService } from './campus-manager-scheduling.service';
import { CampusManagerSettingsService } from './campus-manager-settings.service';
import { CampusManagerStudentService } from './campus-manager-student.service';

@Module({
  imports: [AuthModule],
  controllers: [CampusManagerController],
  providers: [
    CampusManagerLeaveService,
    CampusManagerReadService,
    CampusManagerSchedulingService,
    CampusManagerSettingsService,
    CampusManagerStudentService,
  ],
})
export class CampusManagerModule {}
