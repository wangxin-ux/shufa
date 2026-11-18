import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import {
  PartnerCampaignDraftBasicDto,
  PartnerCampaignDraftQueryDto,
  SavePartnerCampaignDraftBasicDto,
  SavePartnerCampaignDraftContentDto,
  SavePartnerCampaignDraftFormDto,
} from './dto/partner-campaign-draft.dto';
import { PartnerCampaignDraftsService } from './partner-campaign-drafts.service';

@Controller('partners/me/campaign-drafts')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PartnerCampaignDraftsController {
  constructor(private readonly drafts: PartnerCampaignDraftsService) {}

  @Get()
  @RequirePermissions('PARTNER_CAMPAIGN_DRAFT_READ')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PartnerCampaignDraftQueryDto,
  ) {
    return this.drafts.list(user, query);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions('PARTNER_CAMPAIGN_DRAFT_WRITE')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: PartnerCampaignDraftBasicDto,
    @IdempotencyKey() key: string,
  ) {
    return this.drafts.create(user, input, key);
  }

  @Get(':draftId')
  @RequirePermissions('PARTNER_CAMPAIGN_DRAFT_READ')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.drafts.get(user, id);
  }

  @Put(':draftId/basic-information')
  @RequirePermissions('PARTNER_CAMPAIGN_DRAFT_WRITE')
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: SavePartnerCampaignDraftBasicDto,
  ) {
    return this.drafts.save(user, id, input);
  }

  @Put(':draftId/content')
  @RequirePermissions('PARTNER_CAMPAIGN_DRAFT_WRITE')
  saveContent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: SavePartnerCampaignDraftContentDto,
  ) {
    return this.drafts.saveContent(user, id, input);
  }

  @Put(':draftId/registration-form')
  @RequirePermissions('PARTNER_CAMPAIGN_DRAFT_WRITE')
  saveRegistrationForm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: SavePartnerCampaignDraftFormDto,
  ) {
    return this.drafts.saveRegistrationForm(user, id, input);
  }
}
