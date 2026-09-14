import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { CampusManagerReadService } from './campus-manager-read.service';
import { CampusManagerLeaveService } from './campus-manager-leave.service';
import { CampusManagerSchedulingService } from './campus-manager-scheduling.service';
import { CampusManagerSettingsService } from './campus-manager-settings.service';
import { CampusManagerStudentService } from './campus-manager-student.service';
import {
  CampusManagerLeaveRequestsQueryDto,
  CampusManagerRejectLeaveDto,
  CampusManagerReviewLeaveDto,
} from './dto/campus-manager-leave.dto';
import {
  CampusManagerCancelLessonSessionDto,
  CampusManagerCreateLessonSessionDto,
  CampusManagerLessonSessionsQueryDto,
  CampusManagerUpdateLessonSessionDto,
} from './dto/campus-manager-scheduling.dto';
import {
  CampusManagerCreateStudentDto,
  CampusManagerStudentsQueryDto,
} from './dto/campus-manager-student.dto';
import {
  CampusManagerUpdateCampusDto,
  CampusManagerWarningsQueryDto,
} from './dto/campus-manager-settings.dto';

@Controller('campus-managers/me')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class CampusManagerController {
  constructor(
    private readonly campusManagerReadService: CampusManagerReadService,
    private readonly campusManagerLeaveService: CampusManagerLeaveService,
    private readonly campusManagerStudentService: CampusManagerStudentService,
    private readonly campusManagerSchedulingService: CampusManagerSchedulingService,
    private readonly campusManagerSettingsService: CampusManagerSettingsService,
  ) {}

  @Get('leave-requests')
  @RequirePermissions('CAMPUS_LEAVE_REVIEW')
  listLeaveRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CampusManagerLeaveRequestsQueryDto,
  ) {
    return this.campusManagerLeaveService.list(user, query);
  }

  @Post('leave-requests/:leaveRequestId/approve')
  @HttpCode(200)
  @RequirePermissions('CAMPUS_LEAVE_REVIEW')
  approveLeaveRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leaveRequestId', new ParseUUIDPipe({ version: '4' }))
    leaveRequestId: string,
    @Body() dto: CampusManagerReviewLeaveDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.campusManagerLeaveService.approve(
      user,
      leaveRequestId,
      dto,
      idempotencyKey,
    );
  }

  @Post('leave-requests/:leaveRequestId/reject')
  @HttpCode(200)
  @RequirePermissions('CAMPUS_LEAVE_REVIEW')
  rejectLeaveRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leaveRequestId', new ParseUUIDPipe({ version: '4' }))
    leaveRequestId: string,
    @Body() dto: CampusManagerRejectLeaveDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.campusManagerLeaveService.reject(
      user,
      leaveRequestId,
      dto,
      idempotencyKey,
    );
  }

  @Get('dashboard')
  @RequirePermissions('CAMPUS_DASHBOARD_READ')
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.campusManagerReadService.getDashboard(user);
  }

  @Get('profile')
  @RequirePermissions('CAMPUS_DASHBOARD_READ')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.campusManagerReadService.getProfile(user);
  }

  @Get('warnings')
  @RequirePermissions('CAMPUS_WARNING_READ')
  listWarnings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CampusManagerWarningsQueryDto,
  ) {
    return this.campusManagerSettingsService.listWarnings(user, query);
  }

  @Get('campus')
  @RequirePermissions('CAMPUS_SETTINGS_READ')
  getCampus(@CurrentUser() user: AuthenticatedUser) {
    return this.campusManagerSettingsService.getCampus(user);
  }

  @Patch('campus')
  @HttpCode(200)
  @RequirePermissions('CAMPUS_SETTINGS_UPDATE')
  updateCampus(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CampusManagerUpdateCampusDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.campusManagerSettingsService.updateCampus(
      user,
      dto,
      idempotencyKey,
    );
  }

  @Get('students')
  @RequirePermissions('CAMPUS_STUDENT_READ')
  listStudents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CampusManagerStudentsQueryDto,
  ) {
    return this.campusManagerStudentService.list(user, query);
  }

  @Get('students/:studentId')
  @RequirePermissions('CAMPUS_STUDENT_READ')
  getStudent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' }))
    studentId: string,
  ) {
    return this.campusManagerStudentService.detail(user, studentId);
  }

  @Post('students')
  @HttpCode(200)
  @RequirePermissions('CAMPUS_STUDENT_CREATE')
  createStudent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CampusManagerCreateStudentDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.campusManagerStudentService.create(user, dto, idempotencyKey);
  }

  @Get('scheduling-options')
  @RequirePermissions('CAMPUS_SCHEDULE_READ')
  getSchedulingOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.campusManagerStudentService.listClassOptions(user);
  }

  @Get('lesson-sessions')
  @RequirePermissions('CAMPUS_SCHEDULE_READ')
  listLessonSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CampusManagerLessonSessionsQueryDto,
  ) {
    return this.campusManagerSchedulingService.list(user, query);
  }

  @Post('lesson-sessions')
  @HttpCode(200)
  @RequirePermissions('CAMPUS_SCHEDULE_CREATE')
  createLessonSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CampusManagerCreateLessonSessionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.campusManagerSchedulingService.create(
      user,
      dto,
      idempotencyKey,
    );
  }

  @Patch('lesson-sessions/:lessonSessionId')
  @HttpCode(200)
  @RequirePermissions('CAMPUS_SCHEDULE_UPDATE')
  updateLessonSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' }))
    lessonSessionId: string,
    @Body() dto: CampusManagerUpdateLessonSessionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.campusManagerSchedulingService.update(
      user,
      lessonSessionId,
      dto,
      idempotencyKey,
    );
  }

  @Post('lesson-sessions/:lessonSessionId/cancel')
  @HttpCode(200)
  @RequirePermissions('CAMPUS_SCHEDULE_UPDATE')
  cancelLessonSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' }))
    lessonSessionId: string,
    @Body() dto: CampusManagerCancelLessonSessionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.campusManagerSchedulingService.cancel(
      user,
      lessonSessionId,
      dto,
      idempotencyKey,
    );
  }
}
