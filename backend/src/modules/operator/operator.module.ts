import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FileModule } from '../file/file.module';
import { OperatorController } from './operator.controller';
import { OperatorLeaveService } from './operator-leave.service';
import { OperatorReadService } from './operator-read.service';
import { OperatorSchedulingService } from './operator-scheduling.service';
import { OperatorSettingsService } from './operator-settings.service';
import { OperatorStudentService } from './operator-student.service';
import { OperatorStudentArchiveController } from './operator-student-archive.controller';
import { OperatorStudentArchiveService } from './operator-student-archive.service';
import { OperatorRosterController } from './operator-roster.controller';
import { ManagementModule } from '../management/management.module';
import { RosterExcelAdapter } from '../roster-exchange/roster-excel.adapter';
import { RosterExchangeService } from '../roster-exchange/roster-exchange.service';
import { CustomerImportExportService } from '../roster-exchange/customer-import-export.service';
import { TeacherImportExportService } from '../roster-exchange/teacher-import-export.service';
import { OperatorTeacherArchiveController } from './operator-teacher-archive.controller';
import { OperatorTeacherArchiveService } from './operator-teacher-archive.service';
import { PartnerModule } from '../partner/partner.module';
import { OperatorRankingController } from './operator-ranking.controller';
import { OperatorAccountController } from './operator-account.controller';
import { OperatorAccountService } from './operator-account.service';
import { OperatorEarningController } from './operator-earning.controller';
import { OperatorEarningService } from './operator-earning.service';
import { OperatorLessonMembersController } from './operator-lesson-members.controller';
import { OperatorLessonMembersService } from './operator-lesson-members.service';
import { OperatorLessonSeriesController } from './operator-lesson-series.controller';
import { OperatorLessonSeriesService } from './operator-lesson-series.service';
import { OperatorHeadquartersScopeService } from '../../common/auth/operator-headquarters-scope.service';
import { OperatorHeadquartersController } from './operator-headquarters.controller';
import { OperatorHeadquartersService } from './operator-headquarters.service';

@Module({
  imports: [AuthModule, FileModule, ManagementModule, PartnerModule],
  controllers: [
    OperatorController,
    OperatorStudentArchiveController,
    OperatorRosterController,
    OperatorTeacherArchiveController,
    OperatorRankingController,
    OperatorAccountController,
    OperatorEarningController,
    OperatorLessonMembersController,
    OperatorLessonSeriesController,
    OperatorHeadquartersController,
  ],
  providers: [
    OperatorLeaveService,
    OperatorReadService,
    OperatorSchedulingService,
    OperatorSettingsService,
    OperatorStudentService,
    OperatorStudentArchiveService,
    RosterExcelAdapter,
    RosterExchangeService,
    CustomerImportExportService,
    TeacherImportExportService,
    OperatorTeacherArchiveService,
    OperatorAccountService,
    OperatorEarningService,
    OperatorLessonMembersService,
    OperatorLessonSeriesService,
    OperatorHeadquartersScopeService,
    OperatorHeadquartersService,
  ],
})
export class OperatorModule {}
