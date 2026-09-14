import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { UploadedStoredFile } from '../file/stored-file.service';
import { xlsxResponse } from '../roster-exchange/roster-response';
import {
  CreateFinanceReceiptDto,
  FinanceQueryDto,
  IssueFinancePackageDto,
} from './finance.dto';
import { FinanceService } from './finance.service';

@Controller('finance')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class FinanceController {
  constructor(private readonly service: FinanceService) {}

  @Get('campuses')
  @RequirePermissions('FINANCE_RECEIPT_READ')
  campuses(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceQueryDto,
  ) {
    return this.service.campuses(actor, query);
  }
  @Get('students')
  @RequirePermissions('FINANCE_RECEIPT_READ')
  students(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceQueryDto,
  ) {
    return this.service.students(actor, query);
  }
  @Post('receipt-proofs')
  @RequirePermissions('FINANCE_RECEIPT_WRITE')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 3 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file?: UploadedStoredFile,
  ) {
    return this.service.uploadProof(actor, file);
  }
  @Get('receipts')
  @RequirePermissions('FINANCE_RECEIPT_READ')
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceQueryDto,
  ) {
    return this.service.list(actor, query);
  }
  @Get('receipts/export')
  @RequirePermissions('FINANCE_RECEIPT_EXPORT')
  async exportReceipts(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const buffer = await this.service.exportReceipts(actor, query);
    return xlsxResponse(response, buffer, 'finance-receipts.xlsx');
  }
  @Post('receipts')
  @RequirePermissions('FINANCE_RECEIPT_WRITE')
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() input: CreateFinanceReceiptDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.create(actor, input, key);
  }
  @Get('receipts/:receiptId')
  @RequirePermissions('FINANCE_RECEIPT_READ')
  detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('receiptId', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.detail(actor, id);
  }
  @Get('receipts/:receiptId/proof')
  @RequirePermissions('FINANCE_RECEIPT_READ')
  async proof(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('receiptId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res() response: Response,
  ) {
    const file = await this.service.readProof(actor, id);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.type(file.mimeType).send(file.buffer);
  }
  @Post('receipts/:receiptId/issue-package')
  @RequirePermissions('FINANCE_PACKAGE_ISSUE')
  issue(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('receiptId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: IssueFinancePackageDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.issue(actor, id, input, key);
  }
}
