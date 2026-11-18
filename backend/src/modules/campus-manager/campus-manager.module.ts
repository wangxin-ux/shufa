import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FileModule } from '../file/file.module';
import { CampusManagerController } from './campus-manager.controller';
import { CampusManagerLeaveService } from './campus-manager-leave.service';
import { CampusManagerReadService } from './campus-manager-read.service';
import { CampusManagerSchedulingService } from './campus-manager-scheduling.service';
import { CampusManagerSettingsService } from './campus-manager-settings.service';
import { CampusManagerStudentService } from './campus-manager-student.service';
import { CampusManagerStudentArchiveController } from './campus-manager-student-archive.controller';
import { CampusManagerStudentArchiveService } from './campus-manager-student-archive.service';

@Module({
  imports: [AuthModule, FileModule],
  controllers: [CampusManagerController, CampusManagerStudentArchiveController],
  providers: [
    CampusManagerLeaveService,
    CampusManagerReadService,
    CampusManagerSchedulingService,
    CampusManagerSettingsService,
    CampusManagerStudentService,
    CampusManagerStudentArchiveService,
  ],
})
export class CampusManagerModule {}
