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
import { TeacherScopeService } from '../../common/auth/teacher-scope.service';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { GroupPageQueryDto } from './dto/group-buying.dto';
import { GroupBuyingQueryService } from './group-buying-query.service';

@Controller('teachers/me/group-campaigns')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class TeacherGroupPromotionController {
  constructor(
    private readonly teacherScopeService: TeacherScopeService,
    private readonly queryService: GroupBuyingQueryService,
  ) {}

  @Get()
  @RequirePermissions('TEACHER_GROUP_CAMPAIGN_READ')
  async listCampaigns(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GroupPageQueryDto,
  ) {
    const scope = await this.teacherScopeService.resolve(user);
    return this.queryService.listPromotionCampaigns(scope.campusId, query);
  }

  @Get(':campaignId')
  @RequirePermissions('TEACHER_GROUP_CAMPAIGN_READ')
  async getCampaign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campaignId', new ParseUUIDPipe({ version: '4' }))
    campaignId: string,
  ) {
    const scope = await this.teacherScopeService.resolve(user);
    return this.queryService.getPromotionCampaign(scope.campusId, campaignId);
  }
}
