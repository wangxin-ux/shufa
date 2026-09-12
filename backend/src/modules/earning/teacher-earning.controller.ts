import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { TeacherScopeService } from '../../common/auth/teacher-scope.service';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { TeacherEarningsQueryDto } from './dto/earning.dto';
import { EarningQueryService } from './earning-query.service';

@Controller('teachers/me')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class TeacherEarningController {
  constructor(
    private readonly teacherScopeService: TeacherScopeService,
    private readonly earningQueryService: EarningQueryService,
  ) {}

  @Get('earnings/summary')
  @RequirePermissions('TEACHER_EARNING_READ_OWN')
  async getSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.earningQueryService.getTeacherSummary(
      await this.teacherScopeService.resolve(user),
    );
  }

  @Get('earning-rule')
  @RequirePermissions('TEACHER_EARNING_READ_OWN')
  async getCurrentRule(@CurrentUser() user: AuthenticatedUser) {
    return this.earningQueryService.getCurrentTeacherRule(
      await this.teacherScopeService.resolve(user),
    );
  }

  @Get('earnings')
  @RequirePermissions('TEACHER_EARNING_READ_OWN')
  async listEarnings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TeacherEarningsQueryDto,
  ) {
    return this.earningQueryService.listTeacherEarnings(
      await this.teacherScopeService.resolve(user),
      query,
    );
  }
}
