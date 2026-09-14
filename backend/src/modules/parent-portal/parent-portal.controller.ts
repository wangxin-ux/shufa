import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { ParentScopeService } from '../../common/auth/parent-scope.service';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import {
  ParentCampusesQueryDto,
  ParentLeaveRequestDto,
  ParentProfileUpdateDto,
  ParentStudentQueryDto,
} from './dto/parent-portal.dto';
import { ParentPortalService } from './parent-portal.service';

@Controller('parents/me')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class ParentPortalController {
  constructor(
    private readonly parentScopeService: ParentScopeService,
    private readonly parentPortalService: ParentPortalService,
  ) {}

  @Get('campuses')
  @RequirePermissions('PARENT_CAMPUS_DIRECTORY_READ')
  listCampuses(@Query() query: ParentCampusesQueryDto) {
    return this.parentPortalService.listCampuses(query);
  }

  @Get('home')
  @RequirePermissions('PARENT_HOME_READ')
  async getHome(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ParentStudentQueryDto,
  ) {
    return this.parentPortalService.getHome(
      this.parentScopeService.resolve(user),
      query.studentId,
    );
  }

  @Get('hours')
  @RequirePermissions('PARENT_HOURS_READ')
  async getHours(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ParentStudentQueryDto,
  ) {
    return this.parentPortalService.getHours(
      this.parentScopeService.resolve(user),
      query.studentId,
    );
  }

  @Get('leave')
  @RequirePermissions('PARENT_LEAVE_READ')
  async getLeave(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ParentStudentQueryDto,
  ) {
    return this.parentPortalService.getLeavePage(
      this.parentScopeService.resolve(user),
      query.studentId,
    );
  }

  @Post('leave-requests')
  @HttpCode(200)
  @RequirePermissions('PARENT_LEAVE_WRITE')
  async submitLeave(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ParentLeaveRequestDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.parentPortalService.submitLeave(
      this.parentScopeService.resolve(user),
      dto,
      idempotencyKey,
    );
  }

  @Get('profile')
  @RequirePermissions('PARENT_PROFILE_READ')
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.parentPortalService.getProfile(
      this.parentScopeService.resolve(user),
    );
  }

  @Put('profile')
  @HttpCode(200)
  @RequirePermissions('PARENT_PROFILE_WRITE')
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ParentProfileUpdateDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.parentPortalService.updateProfile(
      this.parentScopeService.resolve(user),
      dto,
      idempotencyKey,
    );
  }

  @Get('updates')
  @RequirePermissions('PARENT_UPDATES_READ')
  async getUpdates(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ParentStudentQueryDto,
  ) {
    return this.parentPortalService.getUpdates(
      this.parentScopeService.resolve(user),
      query.studentId,
    );
  }
}
