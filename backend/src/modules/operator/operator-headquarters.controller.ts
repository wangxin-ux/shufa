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
import { OperatorHeadquartersCampusesQueryDto } from './dto/operator-headquarters.dto';
import { OperatorHeadquartersService } from './operator-headquarters.service';

@Controller('operators/me/headquarters')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('OPERATOR_ACCOUNT_READ')
export class OperatorHeadquartersController {
  constructor(private readonly service: OperatorHeadquartersService) {}

  @Get('campuses')
  campuses(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: OperatorHeadquartersCampusesQueryDto,
  ) {
    return this.service.campuses(actor, query);
  }

  @Get('campuses/:campusId/summary')
  campusSummary(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('campusId', new ParseUUIDPipe({ version: '4' }))
    campusId: string,
  ) {
    return this.service.campusSummary(actor, campusId);
  }

  @Get('summary')
  summary(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.summary(actor);
  }
}
