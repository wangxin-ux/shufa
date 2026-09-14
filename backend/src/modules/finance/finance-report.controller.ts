import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
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
  FinanceReportExportParamsDto,
  FinanceReportExportQueryDto,
  FinanceReportQueryDto,
} from './finance-report.dto';
import { FinanceReportService } from './finance-report.service';

@Controller('finance/reports')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class FinanceReportController {
  constructor(private readonly service: FinanceReportService) {}

  @Get('lesson-consumption')
  @RequirePermissions('FINANCE_REPORT_READ')
  lessonConsumption(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceReportQueryDto,
  ) {
    return this.service.lessonConsumption(actor, query);
  }

  @Get('refunds')
  @RequirePermissions('FINANCE_REPORT_READ')
  refunds(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceReportQueryDto,
  ) {
    return this.service.refunds(actor, query);
  }

  @Get(':kind/export')
  @RequirePermissions('FINANCE_REPORT_EXPORT')
  async export(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: FinanceReportExportParamsDto,
    @Query() query: FinanceReportExportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const buffer = await this.service.export(actor, params.kind, query);
    return xlsxResponse(response, buffer, `finance-${params.kind}.xlsx`);
  }
}
