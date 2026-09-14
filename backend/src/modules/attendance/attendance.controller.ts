import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { TeacherScopeService } from '../../common/auth/teacher-scope.service';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AttendanceService } from './attendance.service';
import {
  AttendanceDraftDto,
  CompleteLessonDto,
  ReverseLessonDto,
} from './dto/attendance.dto';

@Controller('teachers/me/lesson-sessions')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class AttendanceController {
  constructor(
    private readonly teacherScopeService: TeacherScopeService,
    private readonly attendanceService: AttendanceService,
  ) {}

  @Put(':lessonSessionId/attendance')
  @RequirePermissions('ATTENDANCE_WRITE')
  async saveAttendance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' }))
    lessonSessionId: string,
    @Body() dto: AttendanceDraftDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.attendanceService.saveAttendance(
      await this.teacherScopeService.resolve(user),
      lessonSessionId,
      dto,
      idempotencyKey,
    );
  }

  @Post(':lessonSessionId/complete')
  @HttpCode(200)
  @RequirePermissions('LESSON_COMPLETE')
  async completeLesson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' }))
    lessonSessionId: string,
    @Body() dto: CompleteLessonDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.attendanceService.completeLesson(
      await this.teacherScopeService.resolve(user),
      lessonSessionId,
      dto,
      idempotencyKey,
    );
  }

  @Post(':lessonSessionId/reverse')
  @HttpCode(200)
  @RequirePermissions('LESSON_REVERSE_OWN_WINDOW')
  async reverseLesson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' }))
    lessonSessionId: string,
    @Body() dto: ReverseLessonDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.attendanceService.reverseLesson(
      await this.teacherScopeService.resolve(user),
      lessonSessionId,
      dto,
      idempotencyKey,
    );
  }
}
