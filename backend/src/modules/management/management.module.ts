import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FileModule } from '../file/file.module';
import { ManagementDashboardController } from './management-dashboard.controller';
import { ManagementDashboardService } from './management-dashboard.service';
import { ManagementWorkspaceController } from './management-workspace.controller';
import { ManagementWorkspaceService } from './management-workspace.service';
import { StaffAccountManagementController } from './staff-account-management.controller';
import { StaffAccountManagementService } from './staff-account-management.service';

@Module({
  imports: [AuthModule, FileModule],
  controllers: [
    ManagementDashboardController,
    ManagementWorkspaceController,
    StaffAccountManagementController,
  ],
  providers: [
    ManagementDashboardService,
    ManagementWorkspaceService,
    StaffAccountManagementService,
  ],
  exports: [StaffAccountManagementService],
})
export class ManagementModule {}
