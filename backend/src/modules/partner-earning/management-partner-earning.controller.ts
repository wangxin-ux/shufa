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
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { VersionedActionDto } from '../earning/dto/earning.dto';
import { ReasonedActionDto } from '../earning/dto/earning.dto';
import {
  CreatePartnerEarningRuleDto,
  ManagementPartnerEarningsQueryDto,
  ManagementPartnerEarningRulesQueryDto,
} from './dto/partner-earning.dto';
import { PartnerEarningQueryService } from './partner-earning-query.service';
import { PartnerEarningReviewService } from './partner-earning-review.service';
import { PartnerEarningRuleManagementService } from './partner-earning-rule-management.service';

@Controller('management/partner-earning-rules')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('PARTNER_EARNING_RULE_MANAGE')
export class ManagementPartnerEarningController {
  constructor(
    private readonly ruleManagementService: PartnerEarningRuleManagementService,
  ) {}

  @Get()
  listRules(@Query() query: ManagementPartnerEarningRulesQueryDto) {
    return this.ruleManagementService.list(query);
  }

  @Post()
  @HttpCode(200)
  createRule(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePartnerEarningRuleDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.ruleManagementService.create(user, dto, idempotencyKey);
  }

  @Post(':ruleId/activate')
  @HttpCode(200)
  activateRule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ruleId', new ParseUUIDPipe({ version: '4' })) ruleId: string,
    @Body() dto: VersionedActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.ruleManagementService.activate(
      user,
      ruleId,
      dto,
      idempotencyKey,
    );
  }

  @Post(':ruleId/retire')
  @HttpCode(200)
  retireRule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ruleId', new ParseUUIDPipe({ version: '4' })) ruleId: string,
    @Body() dto: VersionedActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.ruleManagementService.retire(
      user,
      ruleId,
      dto,
      idempotencyKey,
    );
  }
}

@Controller('management/partner-earnings')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('PARTNER_EARNING_REVIEW')
export class ManagementPartnerEarningReviewController {
  constructor(
    private readonly queryService: PartnerEarningQueryService,
    private readonly reviewService: PartnerEarningReviewService,
  ) {}

  @Get()
  listEarnings(@Query() query: ManagementPartnerEarningsQueryDto) {
    return this.queryService.listManaged(query);
  }

  @Post(':entryId/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @Body() dto: VersionedActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.reviewService.approve(user, entryId, dto, idempotencyKey);
  }

  @Post(':entryId/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @Body() dto: ReasonedActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.reviewService.reject(user, entryId, dto, idempotencyKey);
  }
}
