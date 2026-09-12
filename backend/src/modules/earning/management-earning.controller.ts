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
import {
  CreateTeacherEarningRuleDto,
  ManagementEarningRulesQueryDto,
  ManagementTeacherEarningsQueryDto,
  ReasonedActionDto,
  RetireConfigurationDto,
  VersionedActionDto,
} from './dto/earning.dto';
import { EarningQueryService } from './earning-query.service';
import { EarningReviewService } from './earning-review.service';
import { EarningRuleManagementService } from './earning-rule-management.service';

@Controller('management')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class ManagementEarningController {
  constructor(
    private readonly earningQueryService: EarningQueryService,
    private readonly earningReviewService: EarningReviewService,
    private readonly ruleManagementService: EarningRuleManagementService,
  ) {}

  @Get('earning-rules')
  @RequirePermissions('EARNING_RULE_MANAGE')
  listRules(@Query() query: ManagementEarningRulesQueryDto) {
    return this.ruleManagementService.list(query);
  }

  @Post('earning-rules')
  @HttpCode(200)
  @RequirePermissions('EARNING_RULE_MANAGE')
  createRule(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTeacherEarningRuleDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.ruleManagementService.create(user, dto, idempotencyKey);
  }

  @Post('earning-rules/:ruleId/activate')
  @HttpCode(200)
  @RequirePermissions('EARNING_RULE_MANAGE')
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

  @Post('earning-rules/:ruleId/retire')
  @HttpCode(200)
  @RequirePermissions('EARNING_RULE_MANAGE')
  retireRule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ruleId', new ParseUUIDPipe({ version: '4' })) ruleId: string,
    @Body() dto: RetireConfigurationDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.ruleManagementService.retire(user, ruleId, dto, idempotencyKey);
  }

  @Get('teacher-earnings')
  @RequirePermissions('TEACHER_EARNING_REVIEW')
  listEarnings(@Query() query: ManagementTeacherEarningsQueryDto) {
    return this.earningQueryService.listManagedEarnings(query);
  }

  @Post('teacher-earnings/:entryId/approve')
  @HttpCode(200)
  @RequirePermissions('TEACHER_EARNING_REVIEW')
  approveEarning(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @Body() dto: VersionedActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.earningReviewService.approve(
      user,
      entryId,
      dto,
      idempotencyKey,
    );
  }

  @Post('teacher-earnings/:entryId/reject')
  @HttpCode(200)
  @RequirePermissions('TEACHER_EARNING_REVIEW')
  rejectEarning(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @Body() dto: ReasonedActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.earningReviewService.reject(user, entryId, dto, idempotencyKey);
  }
}
