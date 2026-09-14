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
  ReasonedActionDto,
  RetireConfigurationDto,
  VersionedActionDto,
} from '../earning/dto/earning.dto';
import {
  CreateWithdrawalPolicyDto,
  ManagementWithdrawalsQueryDto,
  MarkWithdrawalPaidDto,
  WithdrawalPoliciesQueryDto,
} from './dto/withdrawal.dto';
import { WithdrawalManagementService } from './withdrawal-management.service';
import { WithdrawalPolicyService } from './withdrawal-policy.service';
import { WithdrawalService } from './withdrawal.service';

@Controller('management')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class ManagementWithdrawalController {
  constructor(
    private readonly withdrawalService: WithdrawalService,
    private readonly managementService: WithdrawalManagementService,
    private readonly policyService: WithdrawalPolicyService,
  ) {}

  @Get('teacher-withdrawal-policies')
  @RequirePermissions('EARNING_RULE_MANAGE')
  listPolicies(@Query() query: WithdrawalPoliciesQueryDto) {
    return this.policyService.list(query);
  }

  @Post('teacher-withdrawal-policies')
  @HttpCode(200)
  @RequirePermissions('EARNING_RULE_MANAGE')
  createPolicy(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWithdrawalPolicyDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.policyService.create(user, dto, idempotencyKey);
  }

  @Post('teacher-withdrawal-policies/:policyId/activate')
  @HttpCode(200)
  @RequirePermissions('EARNING_RULE_MANAGE')
  activatePolicy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('policyId', new ParseUUIDPipe({ version: '4' })) policyId: string,
    @Body() dto: VersionedActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.policyService.activate(user, policyId, dto, idempotencyKey);
  }

  @Post('teacher-withdrawal-policies/:policyId/retire')
  @HttpCode(200)
  @RequirePermissions('EARNING_RULE_MANAGE')
  retirePolicy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('policyId', new ParseUUIDPipe({ version: '4' })) policyId: string,
    @Body() dto: RetireConfigurationDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.policyService.retire(user, policyId, dto, idempotencyKey);
  }

  @Get('withdrawals')
  @RequirePermissions('WITHDRAWAL_REVIEW')
  listWithdrawals(@Query() query: ManagementWithdrawalsQueryDto) {
    return this.withdrawalService.listManagedWithdrawals(query);
  }

  @Post('withdrawals/:withdrawalId/approve')
  @HttpCode(200)
  @RequirePermissions('WITHDRAWAL_REVIEW')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('withdrawalId', new ParseUUIDPipe({ version: '4' }))
    withdrawalId: string,
    @Body() dto: VersionedActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.managementService.approve(
      user,
      withdrawalId,
      dto,
      idempotencyKey,
    );
  }

  @Post('withdrawals/:withdrawalId/reject')
  @HttpCode(200)
  @RequirePermissions('WITHDRAWAL_REVIEW')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('withdrawalId', new ParseUUIDPipe({ version: '4' }))
    withdrawalId: string,
    @Body() dto: ReasonedActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.managementService.reject(
      user,
      withdrawalId,
      dto,
      idempotencyKey,
    );
  }

  @Post('withdrawals/:withdrawalId/mark-paying')
  @HttpCode(200)
  @RequirePermissions('WITHDRAWAL_MARK_PAID')
  markPaying(
    @CurrentUser() user: AuthenticatedUser,
    @Param('withdrawalId', new ParseUUIDPipe({ version: '4' }))
    withdrawalId: string,
    @Body() dto: VersionedActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.managementService.markPaying(
      user,
      withdrawalId,
      dto,
      idempotencyKey,
    );
  }

  @Post('withdrawals/:withdrawalId/mark-paid')
  @HttpCode(200)
  @RequirePermissions('WITHDRAWAL_MARK_PAID')
  markPaid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('withdrawalId', new ParseUUIDPipe({ version: '4' }))
    withdrawalId: string,
    @Body() dto: MarkWithdrawalPaidDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.managementService.markPaid(
      user,
      withdrawalId,
      dto,
      idempotencyKey,
    );
  }

  @Post('withdrawals/:withdrawalId/mark-failed')
  @HttpCode(200)
  @RequirePermissions('WITHDRAWAL_MARK_PAID')
  markFailed(
    @CurrentUser() user: AuthenticatedUser,
    @Param('withdrawalId', new ParseUUIDPipe({ version: '4' }))
    withdrawalId: string,
    @Body() dto: ReasonedActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.managementService.markFailed(
      user,
      withdrawalId,
      dto,
      idempotencyKey,
    );
  }
}
