import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../common/auth/permissions.guard';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { OperatorAddLessonMemberDto, OperatorRemoveLessonMemberDto } from './dto/operator-lesson-members.dto';
import { OperatorLessonMembersService } from './operator-lesson-members.service';

@Controller('operators/me/lesson-sessions')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class OperatorLessonMembersController {
  constructor(private readonly members: OperatorLessonMembersService) {}

  @Get(':lessonSessionId/members')
  @RequirePermissions('OPERATOR_SCHEDULE_READ')
  list(@CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.members.list(user, id);
  }

  @Post(':lessonSessionId/members')
  @HttpCode(200)
  @RequirePermissions('OPERATOR_SCHEDULE_UPDATE')
  add(@CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: OperatorAddLessonMemberDto, @IdempotencyKey() key: string) {
    return this.members.add(user, id, dto, key);
  }

  @Post(':lessonSessionId/members/:studentId/remove')
  @HttpCode(200)
  @RequirePermissions('OPERATOR_SCHEDULE_UPDATE')
  remove(@CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
    @Body() dto: OperatorRemoveLessonMemberDto, @IdempotencyKey() key: string) {
    return this.members.remove(user, id, studentId, dto, key);
  }
}
