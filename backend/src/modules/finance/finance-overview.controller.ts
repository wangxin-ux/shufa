import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { xlsxResponse } from '../roster-exchange/roster-response';
import {
  FinanceOverviewExportParamsDto,
  FinanceOverviewFiltersDto,
  FinanceOverviewQueryDto,
} from './finance-overview.dto';
import { FinanceOverviewService } from './finance-overview.service';

@Controller('finance')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class FinanceOverviewController {
  constructor(private readonly service: FinanceOverviewService) {}

  @Get('hours')
  @RequirePermissions('FINANCE_REPORT_READ')
  hours(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceOverviewQueryDto,
  ) {
    return this.service.studentHours(actor, query);
  }

  @Get('oversight/orders')
  @RequirePermissions('FINANCE_OVERSIGHT_READ')
  orders(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceOverviewQueryDto,
  ) {
    return this.service.orders(actor, query);
  }

  @Get('oversight/orders/:orderId/proof')
  @RequirePermissions('FINANCE_OVERSIGHT_READ')
  async orderProof(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string,
    @Res() response: Response,
  ) {
    const file = await this.service.orderProof(actor, orderId);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.type(file.mimeType).send(file.buffer);
  }

  @Get('oversight/earnings')
  @RequirePermissions('FINANCE_OVERSIGHT_READ')
  earnings(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceOverviewFiltersDto,
  ) {
    return this.service.earnings(actor, query);
  }

  @Get('oversight/payouts')
  @RequirePermissions('FINANCE_OVERSIGHT_READ')
  payouts(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceOverviewQueryDto,
  ) {
    return this.service.payouts(actor, query);
  }

  @Get('oversight/cash-flow')
  @RequirePermissions('FINANCE_OVERSIGHT_READ')
  cashFlow(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceOverviewQueryDto,
  ) {
    return this.service.cashFlow(actor, query);
  }

  @Get('oversight/profitability')
  @RequirePermissions('FINANCE_OVERSIGHT_READ')
  profitability(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceOverviewFiltersDto,
  ) {
    return this.service.profitability(actor, query);
  }

  @Get('oversight/:kind/export')
  @RequirePermissions('FINANCE_OVERSIGHT_EXPORT')
  async export(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: FinanceOverviewExportParamsDto,
    @Query() query: FinanceOverviewFiltersDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const buffer = await this.service.export(actor, params.kind, query);
    return xlsxResponse(response, buffer, `finance-${params.kind}.xlsx`);
  }
}
