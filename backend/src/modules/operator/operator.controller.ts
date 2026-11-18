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
import { OperatorReadService } from './operator-read.service';
import { OperatorLeaveService } from './operator-leave.service';
import { OperatorSchedulingService } from './operator-scheduling.service';
import { OperatorSettingsService } from './operator-settings.service';
import { OperatorStudentService } from './operator-student.service';
import {
  OperatorLeaveRequestsQueryDto,
  OperatorRejectLeaveDto,
  OperatorReviewLeaveDto,
} from './dto/operator-leave.dto';
import {
  OperatorCancelLessonSessionDto,
  OperatorCreateLessonSessionDto,
  OperatorLessonSessionsQueryDto,
  OperatorUpdateLessonSessionDto,
} from './dto/operator-scheduling.dto';
import {
  OperatorCreateStudentDto,
  OperatorStudentsQueryDto,
} from './dto/operator-student.dto';
import {
  OperatorUpdateCampusDto,
  OperatorWarningsQueryDto,
} from './dto/operator-settings.dto';

@Controller('operators/me')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class OperatorController {
  constructor(
    private readonly operatorReadService: OperatorReadService,
    private readonly operatorLeaveService: OperatorLeaveService,
    private readonly operatorStudentService: OperatorStudentService,
    private readonly operatorSchedulingService: OperatorSchedulingService,
    private readonly operatorSettingsService: OperatorSettingsService,
  ) {}

  @Get('leave-requests')
  @RequirePermissions('OPERATOR_LEAVE_REVIEW')
  listLeaveRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OperatorLeaveRequestsQueryDto,
  ) {
    return this.operatorLeaveService.list(user, query);
  }

  @Post('leave-requests/:leaveRequestId/approve')
  @HttpCode(200)
  @RequirePermissions('OPERATOR_LEAVE_REVIEW')
  approveLeaveRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leaveRequestId', new ParseUUIDPipe({ version: '4' }))
    leaveRequestId: string,
    @Body() dto: OperatorReviewLeaveDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.operatorLeaveService.approve(
      user,
      leaveRequestId,
      dto,
      idempotencyKey,
    );
  }

  @Post('leave-requests/:leaveRequestId/reject')
  @HttpCode(200)
  @RequirePermissions('OPERATOR_LEAVE_REVIEW')
  rejectLeaveRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leaveRequestId', new ParseUUIDPipe({ version: '4' }))
    leaveRequestId: string,
    @Body() dto: OperatorRejectLeaveDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.operatorLeaveService.reject(
      user,
      leaveRequestId,
      dto,
      idempotencyKey,
    );
  }

  @Get('dashboard')
  @RequirePermissions('OPERATOR_DASHBOARD_READ')
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.operatorReadService.getDashboard(user);
  }

  @Get('profile')
  @RequirePermissions('OPERATOR_DASHBOARD_READ')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.operatorReadService.getProfile(user);
  }

  @Get('warnings')
  @RequirePermissions('OPERATOR_WARNING_READ')
  listWarnings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OperatorWarningsQueryDto,
  ) {
    return this.operatorSettingsService.listWarnings(user, query);
  }

  @Get('campus')
  @RequirePermissions('OPERATOR_SETTINGS_READ')
  getCampus(@CurrentUser() user: AuthenticatedUser) {
    return this.operatorSettingsService.getCampus(user);
  }

  @Patch('campus')
  @HttpCode(200)
  @RequirePermissions('OPERATOR_SETTINGS_UPDATE')
  updateCampus(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OperatorUpdateCampusDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.operatorSettingsService.updateCampus(user, dto, idempotencyKey);
  }

  @Get('students')
  @RequirePermissions('OPERATOR_STUDENT_READ')
  listStudents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OperatorStudentsQueryDto,
  ) {
    return this.operatorStudentService.list(user, query);
  }

  @Get('students/:studentId')
  @RequirePermissions('OPERATOR_STUDENT_READ')
  getStudent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' }))
    studentId: string,
  ) {
    return this.operatorStudentService.detail(user, studentId);
  }

  @Post('students')
  @HttpCode(200)
  @RequirePermissions('OPERATOR_STUDENT_CREATE')
  createStudent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OperatorCreateStudentDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.operatorStudentService.create(user, dto, idempotencyKey);
  }

  @Get('scheduling-options')
  @RequirePermissions('OPERATOR_SCHEDULE_READ')
  getSchedulingOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.operatorStudentService.listClassOptions(user);
  }

  @Get('lesson-sessions')
  @RequirePermissions('OPERATOR_SCHEDULE_READ')
  listLessonSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OperatorLessonSessionsQueryDto,
  ) {
    return this.operatorSchedulingService.list(user, query);
  }

  @Post('lesson-sessions')
  @HttpCode(200)
  @RequirePermissions('OPERATOR_SCHEDULE_CREATE')
  createLessonSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OperatorCreateLessonSessionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.operatorSchedulingService.create(user, dto, idempotencyKey);
  }

  @Patch('lesson-sessions/:lessonSessionId')
  @HttpCode(200)
  @RequirePermissions('OPERATOR_SCHEDULE_UPDATE')
  updateLessonSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' }))
    lessonSessionId: string,
    @Body() dto: OperatorUpdateLessonSessionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.operatorSchedulingService.update(
      user,
      lessonSessionId,
      dto,
      idempotencyKey,
    );
  }

  @Post('lesson-sessions/:lessonSessionId/cancel')
  @HttpCode(200)
  @RequirePermissions('OPERATOR_SCHEDULE_UPDATE')
  cancelLessonSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' }))
    lessonSessionId: string,
    @Body() dto: OperatorCancelLessonSessionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.operatorSchedulingService.cancel(
      user,
      lessonSessionId,
      dto,
      idempotencyKey,
    );
  }
}
