import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ParentScopeService } from '../../common/auth/parent-scope.service';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import {
  GroupOrdersQueryDto,
  GroupPrepayRetryDto,
  JoinExistingTeamDto,
  JoinGroupDto,
  MockPaymentConfirmationDto,
  ParentGroupCampaignsQueryDto,
} from './dto/group-buying.dto';
import { GroupBuyingCommandService } from './group-buying-command.service';
import { GroupBuyingPaymentService } from './group-buying-payment.service';
import { GroupBuyingQueryService } from './group-buying-query.service';

@Controller('parents/me')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class ParentGroupBuyingController {
  constructor(
    private readonly parentScopeService: ParentScopeService,
    private readonly queryService: GroupBuyingQueryService,
    private readonly commandService: GroupBuyingCommandService,
    private readonly paymentService: GroupBuyingPaymentService,
  ) {}

  @Get('group-campaigns')
  @RequirePermissions('PARENT_GROUP_CAMPAIGN_READ')
  listCampaigns(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ParentGroupCampaignsQueryDto,
  ) {
    return this.queryService.listParentCampaigns(
      this.parentScopeService.resolve(user),
      query,
    );
  }

  @Get('group-campaigns/:campaignId')
  @RequirePermissions('PARENT_GROUP_CAMPAIGN_READ')
  getCampaign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campaignId', new ParseUUIDPipe({ version: '4' }))
    campaignId: string,
    @Query('teamId') teamId?: string,
  ) {
    return this.queryService.getParentCampaign(
      this.parentScopeService.resolve(user),
      campaignId,
      teamId,
    );
  }

  @Get('group-orders')
  @RequirePermissions('PARENT_GROUP_ORDER_READ_OWN')
  listOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GroupOrdersQueryDto,
  ) {
    return this.queryService.listParentOrders(
      this.parentScopeService.resolve(user),
      query,
    );
  }

  @Post('group-teams')
  @HttpCode(200)
  @RequirePermissions('PARENT_GROUP_JOIN')
  createTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: JoinGroupDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.commandService.createTeam(
      this.parentScopeService.resolve(user),
      dto,
      idempotencyKey,
    );
  }

  @Post('group-teams/:teamId/members')
  @HttpCode(200)
  @RequirePermissions('PARENT_GROUP_JOIN')
  joinTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', new ParseUUIDPipe({ version: '4' })) teamId: string,
    @Body() dto: JoinExistingTeamDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.commandService.joinTeam(
      this.parentScopeService.resolve(user),
      teamId,
      dto,
      idempotencyKey,
    );
  }

  @Post('group-members/:memberId/prepay')
  @HttpCode(200)
  @RequirePermissions('PARENT_GROUP_JOIN')
  retryPrepay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body() dto: GroupPrepayRetryDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.paymentService.retryPrepay(
      this.parentScopeService.resolve(user),
      memberId,
      dto.expectedVersion,
      idempotencyKey,
    );
  }

  @Post('group-members/:memberId/mock-payment-confirmation')
  @HttpCode(200)
  @RequirePermissions('PARENT_GROUP_JOIN')
  confirmMockPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body() dto: MockPaymentConfirmationDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.paymentService.confirmMockPayment(
      this.parentScopeService.resolve(user),
      memberId,
      dto.outTradeNo,
      idempotencyKey,
    );
  }
}
