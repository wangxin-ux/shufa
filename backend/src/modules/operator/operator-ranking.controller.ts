import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { PartnerRankingQueryDto } from '../partner/dto/partner-ranking.dto';
import { PartnerRankingService } from '../partner/partner-ranking.service';

@Controller('operators/me/rankings')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class OperatorRankingController {
  constructor(private readonly rankings: PartnerRankingService) {}

  @Get()
  @RequirePermissions('OPERATOR_RANKING_READ')
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: PartnerRankingQueryDto,
  ) {
    return this.rankings.listForOperator(actor, query);
  }
}
