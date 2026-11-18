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
  OperatorTeacherArchivesQueryDto,
  OperatorTeacherHistoryQueryDto,
  OperatorTeacherMonthQueryDto,
} from './dto/operator-teacher-archive.dto';
import { OperatorTeacherArchiveService } from './operator-teacher-archive.service';

@Controller('operators/me/teacher-archives')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('OPERATOR_TEACHER_READ')
export class OperatorTeacherArchiveController {
  constructor(private readonly service: OperatorTeacherArchiveService) {}

  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: OperatorTeacherArchivesQueryDto,
  ) {
    return this.service.list(actor, query);
  }

  @Get(':teacherId/performance')
  performance(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('teacherId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: OperatorTeacherMonthQueryDto,
  ) {
    return this.service.performance(actor, id, query);
  }

  @Get(':teacherId/evaluation-history')
  history(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('teacherId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: OperatorTeacherHistoryQueryDto,
  ) {
    return this.service.history(actor, id, query);
  }
}
