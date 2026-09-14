import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { DomainError } from '../../common/errors/domain-error';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { UploadedStoredFile } from '../file/stored-file.service';
import {
  CreateFinanceRefundDto,
  FinanceRefundActionDto,
  FinanceRefundQueryDto,
  FinanceRefundQuoteDto,
} from './finance-refund.dto';
import { FinanceRefundService } from './finance-refund.service';

function allowAction(dto: FinanceRefundActionDto, allowed: readonly string[]) {
  if (!allowed.includes(dto.action))
    throw new DomainError(
      'FORBIDDEN',
      'Action is not permitted by this endpoint',
      403,
    );
}

@Controller()
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class FinanceRefundController {
  constructor(private readonly service: FinanceRefundService) {}

  @Get('finance/receipts/:receiptId/refund-quote')
  @RequirePermissions('FINANCE_REFUND_READ')
  quote(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('receiptId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: FinanceRefundQuoteDto,
  ) {
    return this.service.quote(actor, id, query);
  }

  @Post('finance/receipts/:receiptId/refunds')
  @RequirePermissions('FINANCE_REFUND_WRITE')
  submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('receiptId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CreateFinanceRefundDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.submit(actor, id, body, key);
  }
  @Get('finance/refunds')
  @RequirePermissions('FINANCE_REFUND_READ')
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceRefundQueryDto,
  ) {
    return this.service.list(actor, query);
  }
  @Get('management/finance-refunds')
  @RequirePermissions('FINANCE_REFUND_REVIEW')
  reviewList(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceRefundQueryDto,
  ) {
    return this.service.list(actor, query);
  }
  @Get('finance/refunds/:id')
  @RequirePermissions('FINANCE_REFUND_READ')
  detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.detail(actor, id);
  }
  @Get('management/finance-refunds/:id')
  @RequirePermissions('FINANCE_REFUND_REVIEW')
  reviewDetail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.detail(actor, id);
  }
  @Post('finance/refunds/:id/actions')
  @HttpCode(200)
  @RequirePermissions('FINANCE_REFUND_WRITE')
  change(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: FinanceRefundActionDto,
    @IdempotencyKey() key: string,
  ) {
    allowAction(body, ['WITHDRAW', 'REQUEST_CANCELLATION']);
    return this.service.act(actor, id, body, key);
  }
  @Post('finance/refunds/:id/payment-actions')
  @HttpCode(200)
  @RequirePermissions('FINANCE_REFUND_PAY')
  pay(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: FinanceRefundActionDto,
    @IdempotencyKey() key: string,
  ) {
    allowAction(body, ['START_PAYMENT', 'MARK_UNCERTAIN', 'RECORD_PAYMENT']);
    return this.service.act(actor, id, body, key);
  }
  @Post('management/finance-refunds/:id/actions')
  @HttpCode(200)
  @RequirePermissions('FINANCE_REFUND_REVIEW')
  review(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: FinanceRefundActionDto,
    @IdempotencyKey() key: string,
  ) {
    allowAction(body, [
      'APPROVE',
      'REJECT',
      'CONFIRM_CANCELLATION',
      'DENY_CANCELLATION',
    ]);
    return this.service.act(actor, id, body, key);
  }
  @Post('finance/refund-proofs')
  @RequirePermissions('FINANCE_REFUND_PAY')
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
  @Get('finance/refunds/:id/proof')
  @RequirePermissions('FINANCE_REFUND_READ')
  async proof(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res() response: Response,
  ) {
    const file = await this.service.readProof(actor, id);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.type(file.mimeType).send(file.buffer);
  }
  @Get('management/finance-refunds/:id/proof')
  @RequirePermissions('FINANCE_REFUND_REVIEW')
  async reviewProof(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res() response: Response,
  ) {
    return this.proof(actor, id, response);
  }
}
