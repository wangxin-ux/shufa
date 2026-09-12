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
import { PartnerScopeService } from '../../common/auth/partner-scope.service';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { GroupPageQueryDto } from './dto/group-buying.dto';
import { GroupBuyingQueryService } from './group-buying-query.service';

@Controller('partners/me/group-campaigns')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PartnerGroupPromotionController {
  constructor(
    private readonly partnerScopeService: PartnerScopeService,
    private readonly queryService: GroupBuyingQueryService,
  ) {}

  @Get()
  @RequirePermissions('PARTNER_GROUP_CAMPAIGN_READ')
  listCampaigns(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GroupPageQueryDto,
  ) {
    const scope = this.partnerScopeService.require(user);
    return this.queryService.listPromotionCampaigns(scope.campusId, query);
  }

  @Get(':campaignId')
  @RequirePermissions('PARTNER_GROUP_CAMPAIGN_READ')
  getCampaign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campaignId', new ParseUUIDPipe({ version: '4' }))
    campaignId: string,
  ) {
    const scope = this.partnerScopeService.require(user);
    return this.queryService.getPromotionCampaign(scope.campusId, campaignId);
  }
}
