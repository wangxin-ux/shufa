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
  FreeCampaignDetailQueryDto,
  FreeCampaignPhaseQueryDto,
  FreeConfigurationMutationDto,
  FreeReasonedActionDto,
  FreeRegistrationInputDto,
  FreeRegistrationQueryDto,
  FreeReviewQueryDto,
  FreeVersionedActionDto,
} from './dto/free-campaign.dto';
import { GroupPageQueryDto } from './dto/group-buying.dto';
import { FreeCampaignConfigService } from './free-campaign-config.service';
import { FreeCampaignReviewService } from './free-campaign-review.service';
import { FreeCampaignRegistrationService } from './free-campaign-registration.service';

const uuid = () => new ParseUUIDPipe({ version: '4' });

@Controller('partners/me/free-campaigns')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PartnerPublishedFreeCampaignController {
  constructor(
    private readonly registrations: FreeCampaignRegistrationService,
  ) {}

  @Get()
  @RequirePermissions('PARTNER_CAMPAIGN_DRAFT_READ')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FreeCampaignPhaseQueryDto,
  ) {
    return this.registrations.listOwnedCampaigns(user, query);
  }
}

@Controller('partners/me/campaign-drafts')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PartnerFreeCampaignController {
  constructor(
    private readonly config: FreeCampaignConfigService,
    private readonly registrations: FreeCampaignRegistrationService,
  ) {}

  @Get(':draftId/free-registration')
  @RequirePermissions('PARTNER_CAMPAIGN_DRAFT_READ')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId', uuid()) id: string,
  ) {
    return this.config.get(user, id);
  }

  @Put(':draftId/free-registration')
  @RequirePermissions('PARTNER_CAMPAIGN_DRAFT_WRITE')
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId', uuid()) id: string,
    @Body() input: FreeConfigurationMutationDto,
  ) {
    return this.config.save(user, id, input);
  }

  @Post(':draftId/submit')
  @HttpCode(200)
  @RequirePermissions('PARTNER_CAMPAIGN_SUBMIT')
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId', uuid()) id: string,
    @Body() input: FreeVersionedActionDto,
    @IdempotencyKey() key: string,
  ) {
    return this.config.submit(user, id, input, key);
  }

  @Get(':draftId/versions')
  @RequirePermissions('PARTNER_CAMPAIGN_DRAFT_READ')
  versions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId', uuid()) id: string,
    @Query() query: GroupPageQueryDto,
  ) {
    return this.config.versions(user, id, query);
  }

  @Get(':draftId/registrations')
  @RequirePermissions('PARTNER_CAMPAIGN_REGISTRATION_READ')
  results(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId', uuid()) id: string,
    @Query() query: FreeRegistrationQueryDto,
  ) {
    return this.registrations.partnerRegistrations(user, id, query);
  }
}

@Controller('management')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('CAMPAIGN_REVIEW')
export class ManagementFreeCampaignController {
  constructor(private readonly reviews: FreeCampaignReviewService) {}

  @Get('campaign-reviews')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FreeReviewQueryDto,
  ) {
    return this.reviews.list(user, query);
  }

  @Get('campaign-reviews/:versionId')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId', uuid()) id: string,
  ) {
    return this.reviews.get(user, id);
  }

  @Post('campaign-reviews/:versionId/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId', uuid()) id: string,
    @Body() input: FreeVersionedActionDto,
    @IdempotencyKey() key: string,
  ) {
    return this.reviews.decide(user, id, input, key, 'APPROVED');
  }

  @Post('campaign-reviews/:versionId/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId', uuid()) id: string,
    @Body() input: FreeReasonedActionDto,
    @IdempotencyKey() key: string,
  ) {
    return this.reviews.decide(user, id, input, key, 'REJECTED', input.reason);
  }

  @Post('campaigns/:campaignId/close')
  @HttpCode(200)
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campaignId', uuid()) id: string,
    @Body() input: FreeReasonedActionDto,
    @IdempotencyKey() key: string,
  ) {
    return this.reviews.close(user, id, input, key);
  }
}

@Controller('parents/me')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class ParentFreeCampaignController {
  constructor(
    private readonly registrations: FreeCampaignRegistrationService,
  ) {}

  @Get('free-campaigns')
  @RequirePermissions('PARENT_FREE_CAMPAIGN_READ')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GroupPageQueryDto,
  ) {
    return this.registrations.listCampaigns(user, query);
  }

  @Get('free-campaigns/:campaignId')
  @RequirePermissions('PARENT_FREE_CAMPAIGN_READ')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campaignId', uuid()) id: string,
    @Query() query: FreeCampaignDetailQueryDto,
  ) {
    return this.registrations.getCampaign(user, id, query.versionId);
  }

  @Post('free-campaigns/:campaignId/registrations')
  @HttpCode(200)
  @RequirePermissions('PARENT_CAMPAIGN_REGISTRATION_CREATE')
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campaignId', uuid()) id: string,
    @Body() input: FreeRegistrationInputDto,
    @IdempotencyKey() key: string,
  ) {
    return this.registrations.register(user, id, input, key);
  }

  @Get('campaign-registrations')
  @RequirePermissions('PARENT_CAMPAIGN_REGISTRATION_READ_OWN')
  results(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GroupPageQueryDto,
  ) {
    return this.registrations.listRegistrations(user, query);
  }

  @Get('campaign-registrations/:registrationId')
  @RequirePermissions('PARENT_CAMPAIGN_REGISTRATION_READ_OWN')
  result(
    @CurrentUser() user: AuthenticatedUser,
    @Param('registrationId', uuid()) id: string,
  ) {
    return this.registrations.getRegistration(user, id);
  }

  @Post('campaign-registrations/:registrationId/cancel')
  @HttpCode(200)
  @RequirePermissions('PARENT_CAMPAIGN_REGISTRATION_CANCEL_OWN')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('registrationId', uuid()) id: string,
    @Body() input: FreeVersionedActionDto,
    @IdempotencyKey() key: string,
  ) {
    return this.registrations.cancel(user, id, input, key);
  }
}
