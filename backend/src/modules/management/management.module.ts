import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FileModule } from '../file/file.module';
import { ManagementDashboardController } from './management-dashboard.controller';
import { ManagementDashboardService } from './management-dashboard.service';
import { ManagementWorkspaceController } from './management-workspace.controller';
import { ManagementWorkspaceService } from './management-workspace.service';
import { StaffAccountManagementController } from './staff-account-management.controller';
import { StaffAccountManagementService } from './staff-account-management.service';
import { OperatorHeadquartersManagementController } from './operator-headquarters-management.controller';
import { OperatorHeadquartersManagementService } from './operator-headquarters-management.service';

@Module({
  imports: [AuthModule, FileModule],
  controllers: [
    ManagementDashboardController,
    ManagementWorkspaceController,
    StaffAccountManagementController,
    OperatorHeadquartersManagementController,
  ],
  providers: [
    ManagementDashboardService,
    ManagementWorkspaceService,
    StaffAccountManagementService,
    OperatorHeadquartersManagementService,
  ],
  exports: [StaffAccountManagementService],
})
export class ManagementModule {}
