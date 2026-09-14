import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FileModule } from '../file/file.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceRefundService } from './finance-refund.service';
import { FinanceRefundController } from './finance-refund.controller';
import { FinanceReportController } from './finance-report.controller';
import { FinanceReportService } from './finance-report.service';
import { FinanceCorrectionController } from './finance-correction.controller';
import { FinanceCorrectionService } from './finance-correction.service';
import { FinanceOverviewController } from './finance-overview.controller';
import { FinanceOverviewService } from './finance-overview.service';

@Module({
  imports: [AuthModule, FileModule],
  controllers: [
    FinanceController,
    FinanceRefundController,
    FinanceReportController,
    FinanceCorrectionController,
    FinanceOverviewController,
  ],
  providers: [
    FinanceService,
    FinanceRefundService,
    FinanceReportService,
    FinanceCorrectionService,
    FinanceOverviewService,
  ],
})
export class FinanceModule {}
