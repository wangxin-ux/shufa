import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ManagementModule } from '../management/management.module';
import { CampusManagerRosterController } from './campus-manager-roster.controller';
import { CustomerImportExportService } from './customer-import-export.service';
import { ManagementRosterController } from './management-roster.controller';
import { RosterExcelAdapter } from './roster-excel.adapter';
import { RosterExchangeService } from './roster-exchange.service';
import { TeacherImportExportService } from './teacher-import-export.service';

@Module({
  imports: [AuthModule, ManagementModule],
  controllers: [ManagementRosterController, CampusManagerRosterController],
  providers: [
    RosterExcelAdapter,
    RosterExchangeService,
    CustomerImportExportService,
    TeacherImportExportService,
  ],
})
export class RosterExchangeModule {}
