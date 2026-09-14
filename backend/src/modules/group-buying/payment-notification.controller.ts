import {
  Controller,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { GroupBuyingPaymentService } from './group-buying-payment.service';

@Controller('payments/wechat')
export class PaymentNotificationController {
  constructor(private readonly paymentService: GroupBuyingPaymentService) {}

  @Post('notifications')
  @HttpCode(200)
  handle(@Req() request: RawBodyRequest<Request>) {
    if (!request.rawBody) {
      throw new DomainError(
        ErrorCode.PAYMENT_NOTIFICATION_INVALID,
        'Payment notification raw body is unavailable',
        400,
      );
    }
    const headers = Object.fromEntries(
      Object.entries(request.headers)
        .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
        .map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value]),
    );
    return this.paymentService.handleNotification(headers, request.rawBody);
  }
}
