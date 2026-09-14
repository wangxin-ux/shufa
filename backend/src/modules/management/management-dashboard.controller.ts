import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { ManagementDashboardQueryDto } from './dto/management.dto';
import { ManagementDashboardService } from './management-dashboard.service';

@Controller('management')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class ManagementDashboardController {
  constructor(private readonly service: ManagementDashboardService) {}

  @Get('dashboard')
  @RequirePermissions('GLOBAL_DASHBOARD_READ')
  getDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ManagementDashboardQueryDto,
  ) {
    return this.service.getDashboard(user, query);
  }

  @Get('profile')
  @RequirePermissions('GLOBAL_DASHBOARD_READ')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getProfile(user);
  }
}
