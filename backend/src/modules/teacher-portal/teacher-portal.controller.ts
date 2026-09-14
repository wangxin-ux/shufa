import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { TeacherScopeService } from '../../common/auth/teacher-scope.service';
import { AccessTokenGuard } from '../auth/access-token.guard';
import {
  DateRangeQueryDto,
  LessonSessionsQueryDto,
  StudentsQueryDto,
} from '../scheduling/dto/teacher-read-query.dto';
import { TeacherReadService } from '../scheduling/teacher-read.service';

@Controller('teachers/me')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class TeacherPortalController {
  constructor(
    private readonly teacherScopeService: TeacherScopeService,
    private readonly teacherReadService: TeacherReadService,
  ) {}

  @Get('dashboard')
  @RequirePermissions('TEACHER_PROFILE_READ')
  async getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.teacherReadService.getDashboard(
      await this.teacherScopeService.resolve(user),
    );
  }

  @Get('profile')
  @RequirePermissions('TEACHER_PROFILE_READ')
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.teacherReadService.getProfile(
      await this.teacherScopeService.resolve(user),
    );
  }

  @Get('lesson-sessions')
  @RequirePermissions('TEACHER_SCHEDULE_READ')
  async listLessonSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LessonSessionsQueryDto,
  ) {
    return this.teacherReadService.listLessonSessions(
      await this.teacherScopeService.resolve(user),
      query,
    );
  }

  @Get('lesson-sessions/:lessonSessionId')
  @RequirePermissions('TEACHER_SCHEDULE_READ')
  async getLessonSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' }))
    lessonSessionId: string,
  ) {
    return this.teacherReadService.getLessonSession(
      await this.teacherScopeService.resolve(user),
      lessonSessionId,
    );
  }

  @Get('students')
  @RequirePermissions('TEACHER_STUDENT_READ')
  async listStudents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: StudentsQueryDto,
  ) {
    return this.teacherReadService.listStudents(
      await this.teacherScopeService.resolve(user),
      query,
    );
  }

  @Get('students/:studentId')
  @RequirePermissions('TEACHER_STUDENT_READ')
  async getStudent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
  ) {
    return this.teacherReadService.getStudent(
      await this.teacherScopeService.resolve(user),
      studentId,
    );
  }

  @Get('teaching-records')
  @RequirePermissions('TEACHING_RECORD_READ')
  async listTeachingRecords(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.teacherReadService.listTeachingRecords(
      await this.teacherScopeService.resolve(user),
      query,
    );
  }

  @Get('lesson-ledger')
  @RequirePermissions('LESSON_LEDGER_READ_OWN')
  async listLessonLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.teacherReadService.listLessonLedger(
      await this.teacherScopeService.resolve(user),
      query,
    );
  }
}
