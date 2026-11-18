import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { AccessTokenGuard } from '../auth/access-token.guard';
import {
  OperatorAccountQueryDto,
  OperatorAccountSubjectsQueryDto,
} from './dto/operator-account.dto';
import { OperatorAccountService } from './operator-account.service';

@Controller('operators/me')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('OPERATOR_ACCOUNT_READ')
export class OperatorAccountController {
  constructor(private readonly service: OperatorAccountService) {}

  @Get('lesson-account')
  lessonAccount(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: OperatorAccountQueryDto,
  ) {
    return this.service.lessonAccount(actor, query);
  }

  @Get('subjects')
  subjects(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: OperatorAccountSubjectsQueryDto,
  ) {
    return this.service.subjects(actor, query);
  }
}
