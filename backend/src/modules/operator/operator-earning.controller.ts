import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { OperatorEarningQueryDto } from './dto/operator-earning.dto';
import { OperatorEarningService } from './operator-earning.service';

@Controller('operators/me/earnings')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('OPERATOR_EARNING_READ')
export class OperatorEarningController {
  constructor(private readonly service: OperatorEarningService) {}

  @Get('summary')
  summary(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.summary(actor);
  }

  @Get()
  entries(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: OperatorEarningQueryDto,
  ) {
    return this.service.entries(actor, query);
  }
}
