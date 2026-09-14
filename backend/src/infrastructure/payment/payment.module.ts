import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockPaymentAdapter } from './mock-payment.adapter';
import { PAYMENT_ADAPTER } from './payment.constants';
import { WechatPaymentAdapter } from './wechat-payment.adapter';

@Module({
  providers: [
    MockPaymentAdapter,
    WechatPaymentAdapter,
    {
      provide: PAYMENT_ADAPTER,
      inject: [ConfigService, MockPaymentAdapter, WechatPaymentAdapter],
      useFactory: (
        configService: ConfigService,
        mockPaymentAdapter: MockPaymentAdapter,
        wechatPaymentAdapter: WechatPaymentAdapter,
      ) =>
        configService.getOrThrow<string>('PAYMENT_DRIVER') === 'mock'
          ? mockPaymentAdapter
          : wechatPaymentAdapter,
    },
  ],
  exports: [PAYMENT_ADAPTER],
})
export class PaymentModule {}
