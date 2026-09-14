import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { AccessTokenGuard } from '../auth/access-token.guard';
import {
  PartnerPageQueryDto,
  PartnerPeriodQueryDto,
  PartnerSearchQueryDto,
} from './dto/partner-query.dto';
import { PartnerReadService } from './partner-read.service';
import { PartnerEarningQueryService } from '../partner-earning/partner-earning-query.service';
import {
  PartnerEarningPeriodQueryDto,
  PartnerEarningsQueryDto,
} from '../partner-earning/dto/partner-earning.dto';

@Controller('partners/me')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PartnerController {
  constructor(
    private readonly readService: PartnerReadService,
    private readonly earningQueryService: PartnerEarningQueryService,
  ) {}

  @Get('dashboard')
  @RequirePermissions('PARTNER_DASHBOARD_READ')
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.readService.getDashboard(user);
  }

  @Get('profile')
  @RequirePermissions('PARTNER_PROFILE_READ')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.readService.getProfile(user);
  }

  @Get('students')
  @RequirePermissions('PARTNER_STUDENT_READ')
  listStudents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PartnerSearchQueryDto,
  ) {
    return this.readService.listStudents(user, query);
  }

  @Get('students/:studentId')
  @RequirePermissions('PARTNER_STUDENT_READ')
  getStudent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
  ) {
    return this.readService.getStudent(user, studentId);
  }

  @Get('operations-summary')
  @RequirePermissions('PARTNER_DASHBOARD_READ')
  getOperationsSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PartnerPeriodQueryDto,
  ) {
    return this.readService.getOperationsSummary(user, query);
  }

  @Get('warnings')
  @RequirePermissions('PARTNER_WARNING_READ')
  listWarnings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PartnerSearchQueryDto,
  ) {
    return this.readService.listWarnings(user, query);
  }

  @Get('attendance')
  @RequirePermissions('PARTNER_ATTENDANCE_READ')
  getAttendance(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PartnerPageQueryDto,
  ) {
    return this.readService.getAttendance(user, query);
  }

  @Get('teachers')
  @RequirePermissions('PARTNER_TEACHER_READ')
  listTeachers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PartnerSearchQueryDto,
  ) {
    return this.readService.listTeachers(user, query);
  }

  @Get('lesson-account')
  @RequirePermissions('PARTNER_LEDGER_READ')
  getLessonAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PartnerPageQueryDto,
  ) {
    return this.readService.getLessonAccount(user, query);
  }

  @Get('earnings/summary')
  @RequirePermissions('PARTNER_EARNING_READ')
  getEarningSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PartnerEarningPeriodQueryDto,
  ) {
    return this.earningQueryService.getSummary(user, query);
  }

  @Get('earnings')
  @RequirePermissions('PARTNER_EARNING_READ')
  listEarnings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PartnerEarningsQueryDto,
  ) {
    return this.earningQueryService.listForPartner(user, query);
  }

  @Get('earning-rule')
  @RequirePermissions('PARTNER_EARNING_READ')
  getCurrentEarningRule(@CurrentUser() user: AuthenticatedUser) {
    return this.earningQueryService.getCurrentRule(user);
  }
}
