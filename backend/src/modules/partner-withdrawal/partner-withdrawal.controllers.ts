import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Header,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { PartnerSettlementService } from './partner-settlement.service';
import { PartnerWithdrawalService } from './partner-withdrawal.service';
import {
  ManagedPartnerWithdrawalQueryDto,
  PartnerSettlementConfigurationDto,
  PartnerSettlementConfirmDto,
  PartnerWithdrawalActionDto,
  PartnerWithdrawalCreateDto,
  PartnerWithdrawalQueryDto,
  SettlementVersionDto,
} from './partner-withdrawal.dto';

const uuid = new ParseUUIDPipe({ version: '4' });
@Injectable()
export class LocalPartnerSettlementGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const address = context.switchToHttp().getRequest<Request>()
      .socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? ''))
      throw new DomainError(ErrorCode.FORBIDDEN, '模拟提现仅限本机连接', 403);
    return true;
  }
}

@Controller('partners/me')
@UseGuards(AccessTokenGuard, PermissionsGuard, LocalPartnerSettlementGuard)
export class PartnerWithdrawalController {
  constructor(
    private readonly settlement: PartnerSettlementService,
    private readonly withdrawals: PartnerWithdrawalService,
  ) {}
  @Get('withdrawal-summary')
  @RequirePermissions('PARTNER_WITHDRAWAL_READ')
  summary(@CurrentUser() actor: AuthenticatedUser) {
    return this.settlement.ownSummary(actor);
  }
  @Get('withdrawals')
  @RequirePermissions('PARTNER_WITHDRAWAL_READ')
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: PartnerWithdrawalQueryDto,
  ) {
    return this.withdrawals.ownList(actor, query);
  }
  @Post('withdrawals')
  @HttpCode(200)
  @RequirePermissions('PARTNER_WITHDRAWAL_CREATE')
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: PartnerWithdrawalCreateDto,
    @IdempotencyKey() key: string,
  ) {
    return this.withdrawals.create(actor, dto, key);
  }
  @Get('withdrawals/:id')
  @RequirePermissions('PARTNER_WITHDRAWAL_READ')
  detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', uuid) id: string,
  ) {
    return this.withdrawals.detail(actor, id);
  }
  @Post('withdrawals/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('PARTNER_WITHDRAWAL_CANCEL')
  cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body() dto: SettlementVersionDto,
    @IdempotencyKey() key: string,
  ) {
    return this.withdrawals.cancel(actor, id, dto, key);
  }
}

@Controller('partners/me/withdrawals')
@UseGuards(AccessTokenGuard, LocalPartnerSettlementGuard)
export class PartnerWithdrawalProofController {
  constructor(private readonly withdrawals: PartnerWithdrawalService) {}
  // Exact single-role authorization lives in readProof; either role can read its permitted linkage.
  @Get(':id/proof')
  @Header('Cache-Control', 'private, no-store')
  async proof(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', uuid) id: string,
  ) {
    const result = await this.withdrawals.readProof(actor, id);
    return new StreamableFile(result.buffer, {
      type: result.mimeType,
      disposition: 'inline; filename="simulated-payout.pdf"',
    });
  }
}

@Controller('management')
@UseGuards(AccessTokenGuard, PermissionsGuard, LocalPartnerSettlementGuard)
export class ManagementPartnerWithdrawalController {
  constructor(
    private readonly settlement: PartnerSettlementService,
    private readonly withdrawals: PartnerWithdrawalService,
  ) {}
  @Get('campuses/:campusId/partner-settlement')
  @RequirePermissions('PARTNER_SETTLEMENT_MANAGE')
  summary(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('campusId', uuid) campusId: string,
  ) {
    return this.settlement.managedSummary(actor, campusId);
  }
  @Put('campuses/:campusId/partner-settlement')
  @RequirePermissions('PARTNER_SETTLEMENT_MANAGE')
  configure(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('campusId', uuid) campusId: string,
    @Body() dto: PartnerSettlementConfigurationDto,
    @IdempotencyKey() key: string,
  ) {
    return this.settlement.configure(actor, campusId, dto, key);
  }
  @Get('campuses/:campusId/partner-settlement/sources')
  @RequirePermissions('PARTNER_SETTLEMENT_MANAGE')
  sources(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('campusId', uuid) campusId: string,
    @Query() query: PartnerWithdrawalQueryDto,
  ) {
    return this.settlement.candidates(actor, campusId, query);
  }
  @Post('campuses/:campusId/partner-settlement/sources/:earningId')
  @HttpCode(200)
  @RequirePermissions('PARTNER_SETTLEMENT_MANAGE')
  confirm(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('campusId', uuid) campusId: string,
    @Param('earningId', uuid) earningId: string,
    @Body() dto: PartnerSettlementConfirmDto,
    @IdempotencyKey() key: string,
  ) {
    return this.settlement.confirm(actor, campusId, earningId, dto, key);
  }
  @Get('partner-withdrawals')
  @RequirePermissions('PARTNER_WITHDRAWAL_MANAGE')
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ManagedPartnerWithdrawalQueryDto,
  ) {
    return this.withdrawals.managedList(actor, query);
  }
  @Get('partner-withdrawals/:id')
  @RequirePermissions('PARTNER_WITHDRAWAL_MANAGE')
  detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', uuid) id: string,
  ) {
    return this.withdrawals.detail(actor, id, true);
  }
  @Post('partner-withdrawals/:id/:action')
  @HttpCode(200)
  @RequirePermissions('PARTNER_WITHDRAWAL_MANAGE')
  action(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Param('action') action: string,
    @Body() dto: PartnerWithdrawalActionDto,
    @IdempotencyKey() key: string,
  ) {
    return this.withdrawals.action(actor, id, action, dto, key);
  }
}
