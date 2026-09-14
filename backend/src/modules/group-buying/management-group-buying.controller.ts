import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import {
  GroupCampaignMutationDto,
  GroupCampaignPosterOrderDto,
  ManagementCourseProductsQueryDto,
  ManagementGroupCampaignsQueryDto,
  ManagementGroupOrdersQueryDto,
  VersionedGroupActionDto,
  VersionedGroupCampaignMutationDto,
  VersionedReasonedGroupActionDto,
} from './dto/group-buying.dto';
import { GroupBuyingManagementService } from './group-buying-management.service';
import { GroupBuyingQueryService } from './group-buying-query.service';

@Controller('management')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class ManagementGroupBuyingController {
  constructor(
    private readonly queryService: GroupBuyingQueryService,
    private readonly managementService: GroupBuyingManagementService,
  ) {}

  @Get('course-products')
  @RequirePermissions('COURSE_PRODUCT_MANAGE')
  listCourseProducts(@Query() query: ManagementCourseProductsQueryDto) {
    return this.queryService.listManagementCourseProducts(query);
  }

  @Get('group-campaigns')
  @RequirePermissions('GROUP_CAMPAIGN_MANAGE')
  listCampaigns(@Query() query: ManagementGroupCampaignsQueryDto) {
    return this.queryService.listManagementCampaigns(query);
  }

  @Post('group-campaigns/:campaignId/posters')
  @HttpCode(200)
  @RequirePermissions('GROUP_CAMPAIGN_MANAGE')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024 } }),
  )
  uploadCampaignPoster(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campaignId', new ParseUUIDPipe({ version: '4' }))
    campaignId: string,
    @Body() dto: VersionedGroupActionDto,
    @UploadedFile()
    file:
      | {
          originalname: string;
          mimetype: string;
          size: number;
          buffer: Buffer;
        }
      | undefined,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.managementService.uploadCampaignPoster(
      user,
      campaignId,
      dto,
      file,
      idempotencyKey,
    );
  }

  @Post('group-campaigns/:campaignId/posters/reorder')
  @HttpCode(200)
  @RequirePermissions('GROUP_CAMPAIGN_MANAGE')
  reorderCampaignPosters(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campaignId', new ParseUUIDPipe({ version: '4' }))
    campaignId: string,
    @Body() dto: GroupCampaignPosterOrderDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.managementService.reorderCampaignPosters(
      user,
      campaignId,
      dto,
      idempotencyKey,
    );
  }

  @Post('group-campaigns/:campaignId/posters/:posterId/detach')
  @HttpCode(200)
  @RequirePermissions('GROUP_CAMPAIGN_MANAGE')
  detachCampaignPoster(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campaignId', new ParseUUIDPipe({ version: '4' }))
    campaignId: string,
    @Param('posterId', new ParseUUIDPipe({ version: '4' })) posterId: string,
    @Body() dto: VersionedGroupActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.managementService.detachCampaignPoster(
      user,
      campaignId,
      posterId,
      dto,
      idempotencyKey,
    );
  }

  @Post('group-campaigns')
  @HttpCode(200)
  @RequirePermissions('GROUP_CAMPAIGN_MANAGE')
  createCampaign(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GroupCampaignMutationDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.managementService.createCampaign(user, dto, idempotencyKey);
  }

  @Patch('group-campaigns/:campaignId')
  @RequirePermissions('GROUP_CAMPAIGN_MANAGE')
  updateCampaign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campaignId', new ParseUUIDPipe({ version: '4' }))
    campaignId: string,
    @Body() dto: VersionedGroupCampaignMutationDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.managementService.updateCampaign(
      user,
      campaignId,
      dto,
      idempotencyKey,
    );
  }

  @Post('group-campaigns/:campaignId/activate')
  @HttpCode(200)
  @RequirePermissions('GROUP_CAMPAIGN_MANAGE')
  activateCampaign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campaignId', new ParseUUIDPipe({ version: '4' }))
    campaignId: string,
    @Body() dto: VersionedGroupActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.managementService.activateCampaign(
      user,
      campaignId,
      dto,
      idempotencyKey,
    );
  }

  @Post('group-campaigns/:campaignId/close')
  @HttpCode(200)
  @RequirePermissions('GROUP_CAMPAIGN_MANAGE')
  closeCampaign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campaignId', new ParseUUIDPipe({ version: '4' }))
    campaignId: string,
    @Body() dto: VersionedGroupActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.managementService.closeCampaign(
      user,
      campaignId,
      dto,
      idempotencyKey,
    );
  }

  @Post('group-campaigns/:campaignId/cancel')
  @HttpCode(200)
  @RequirePermissions('GROUP_CAMPAIGN_MANAGE')
  cancelCampaign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campaignId', new ParseUUIDPipe({ version: '4' }))
    campaignId: string,
    @Body() dto: VersionedReasonedGroupActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.managementService.cancelCampaign(
      user,
      campaignId,
      dto,
      idempotencyKey,
    );
  }

  @Get('group-orders')
  @RequirePermissions('GROUP_ORDER_READ')
  listOrders(@Query() query: ManagementGroupOrdersQueryDto) {
    return this.queryService.listManagementOrders(query);
  }

  @Post('group-orders/:orderId/refund')
  @HttpCode(200)
  @RequirePermissions('GROUP_REFUND_MANAGE')
  refundOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string,
    @Body() dto: VersionedReasonedGroupActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.managementService.refundOrder(
      user,
      orderId,
      dto,
      idempotencyKey,
    );
  }
}
