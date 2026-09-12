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
  UseGuards,
} from '@nestjs/common';
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
import {
  CreateFinanceCorrectionDto,
  FinanceCorrectionActionDto,
  FinanceCorrectionQueryDto,
} from './finance-correction.dto';
import { FinanceCorrectionService } from './finance-correction.service';

function allowAction(
  dto: FinanceCorrectionActionDto,
  allowed: readonly string[],
) {
  if (!allowed.includes(dto.action)) {
    throw new DomainError(
      'FORBIDDEN',
      'Action is not permitted by this endpoint',
      403,
    );
  }
}

@Controller()
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class FinanceCorrectionController {
  constructor(private readonly service: FinanceCorrectionService) {}

  @Post('finance/receipts/:receiptId/corrections')
  @RequirePermissions('FINANCE_CORRECTION_WRITE')
  submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('receiptId', new ParseUUIDPipe({ version: '4' })) receiptId: string,
    @Body() body: CreateFinanceCorrectionDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.submit(actor, receiptId, body, key);
  }

  @Get('finance/corrections')
  @RequirePermissions('FINANCE_CORRECTION_READ')
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceCorrectionQueryDto,
  ) {
    return this.service.list(actor, query);
  }

  @Get('management/finance-corrections')
  @RequirePermissions('FINANCE_CORRECTION_REVIEW')
  reviewList(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: FinanceCorrectionQueryDto,
  ) {
    return this.service.list(actor, query);
  }

  @Get('finance/corrections/:id')
  @RequirePermissions('FINANCE_CORRECTION_READ')
  detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.detail(actor, id);
  }

  @Get('management/finance-corrections/:id')
  @RequirePermissions('FINANCE_CORRECTION_REVIEW')
  reviewDetail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.detail(actor, id);
  }

  @Post('finance/corrections/:id/actions')
  @HttpCode(200)
  @RequirePermissions('FINANCE_CORRECTION_APPLY')
  change(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: FinanceCorrectionActionDto,
    @IdempotencyKey() key: string,
  ) {
    allowAction(body, ['WITHDRAW', 'APPLY']);
    return this.service.act(actor, id, body, key);
  }

  @Post('management/finance-corrections/:id/actions')
  @HttpCode(200)
  @RequirePermissions('FINANCE_CORRECTION_REVIEW')
  review(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: FinanceCorrectionActionDto,
    @IdempotencyKey() key: string,
  ) {
    allowAction(body, ['APPROVE', 'REJECT']);
    return this.service.act(actor, id, body, key);
  }

  @Get('finance/corrections/:id/original-proof')
  @RequirePermissions('FINANCE_CORRECTION_READ')
  originalProof(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res() response: Response,
  ) {
    return this.sendProof(this.service.readOriginalProof(actor, id), response);
  }

  @Get('management/finance-corrections/:id/original-proof')
  @RequirePermissions('FINANCE_CORRECTION_REVIEW')
  reviewOriginalProof(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res() response: Response,
  ) {
    return this.sendProof(this.service.readOriginalProof(actor, id), response);
  }

  @Get('finance/corrections/:id/replacement-proof')
  @RequirePermissions('FINANCE_CORRECTION_READ')
  replacementProof(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res() response: Response,
  ) {
    return this.sendProof(
      this.service.readReplacementProof(actor, id),
      response,
    );
  }

  @Get('management/finance-corrections/:id/replacement-proof')
  @RequirePermissions('FINANCE_CORRECTION_REVIEW')
  reviewReplacementProof(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res() response: Response,
  ) {
    return this.sendProof(
      this.service.readReplacementProof(actor, id),
      response,
    );
  }

  private async sendProof(
    filePromise: Promise<{ buffer: Buffer; mimeType: string }>,
    response: Response,
  ) {
    const file = await filePromise;
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.type(file.mimeType).send(file.buffer);
  }
}
