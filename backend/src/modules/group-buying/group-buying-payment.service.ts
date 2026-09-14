import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { ParentScope } from '../../common/auth/parent-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { PaymentAdapter } from '../../infrastructure/payment/payment.adapter';
import { PAYMENT_ADAPTER } from '../../infrastructure/payment/payment.constants';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { loadGroupOrderView } from './group-buying-query.service';
import { GroupBuyingSettlementService } from './group-buying-settlement.service';

const prepayRoute = (memberId: string) =>
  `/parents/me/group-members/${memberId}/prepay`;
const mockConfirmationRoute = (memberId: string) =>
  `/parents/me/group-members/${memberId}/mock-payment-confirmation`;

@Injectable()
export class GroupBuyingPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly settlementService: GroupBuyingSettlementService,
    @Inject(PAYMENT_ADAPTER) private readonly paymentAdapter: PaymentAdapter,
  ) {}

  async handleNotification(
    headers: Record<string, string>,
    rawBody: Buffer,
  ) {
    const event = await this.paymentAdapter.verifyNotification(headers, rawBody);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "PaymentTransaction" WHERE "outTradeNo" = ${event.outTradeNo} FOR UPDATE`,
      );
      const payment = await transaction.paymentTransaction.findFirst({
        where: { outTradeNo: event.outTradeNo, type: 'PAYMENT' },
        include: { member: true },
      });
      if (!payment || payment.provider !== event.provider) {
        throw new DomainError(
          ErrorCode.PAYMENT_NOTIFICATION_INVALID,
          'Payment transaction does not match the notification provider',
          400,
        );
      }
      if (payment.amountFen !== event.amountFen) {
        throw new DomainError(
          ErrorCode.PAYMENT_NOTIFICATION_INVALID,
          'Payment notification amount does not match the order',
          400,
        );
      }
      if (payment.status === 'SUCCEEDED') {
        if (payment.providerTradeNo !== event.providerTradeNo) {
          throw new DomainError(
            ErrorCode.PAYMENT_NOTIFICATION_INVALID,
            'Payment notification transaction number conflicts with history',
            400,
          );
        }
        return { code: 'SUCCESS', message: '成功' };
      }
      if (event.status === 'FAILED') {
        if (payment.status === 'PENDING') {
          await transaction.paymentTransaction.update({
            where: { id: payment.id },
            data: {
              status: 'FAILED',
              providerTradeNo: event.providerTradeNo,
              rawNotification: event.rawNotification as Prisma.InputJsonValue,
            },
          });
        }
        return { code: 'SUCCESS', message: '成功' };
      }
      if (
        payment.status !== 'PENDING' ||
        payment.member.status !== 'PENDING_PAYMENT' ||
        payment.member.reservationExpiresAt.getTime() <= Date.now()
      ) {
        throw new DomainError(
          ErrorCode.GROUP_MEMBER_STATUS_CONFLICT,
          'Group member cannot accept this payment notification',
          409,
        );
      }

      const paidAt = new Date();
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "GroupTeam" WHERE "id" = ${payment.member.teamId}::uuid FOR UPDATE`,
      );
      await transaction.paymentTransaction.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCEEDED',
          providerTradeNo: event.providerTradeNo,
          rawNotification: event.rawNotification as Prisma.InputJsonValue,
          succeededAt: paidAt,
        },
      });
      await transaction.groupMember.update({
        where: { id: payment.member.id },
        data: { status: 'PAID', paidAt, version: { increment: 1 } },
      });
      await transaction.enrollmentOrder.update({
        where: { id: payment.enrollmentOrderId },
        data: { status: 'PAID', version: { increment: 1 } },
      });
      const paidMemberCount = await transaction.groupMember.count({
        where: {
          teamId: payment.member.teamId,
          status: { in: ['PAID', 'SETTLED'] },
        },
      });
      await transaction.groupTeam.update({
        where: { id: payment.member.teamId },
        data: { paidMemberCount, version: { increment: 1 } },
      });
      const team = await transaction.groupTeam.findUniqueOrThrow({
        where: { id: payment.member.teamId },
        include: { campaign: true },
      });
      if (paidMemberCount === team.campaign.maxPaidMembers) {
        await this.settlementService.settleTeam(
          transaction,
          payment.member.teamId,
          paidAt,
        );
      }
      return { code: 'SUCCESS', message: '成功' };
    });
  }

  async retryPrepay(
    scope: ParentScope,
    memberId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const route = prepayRoute(memberId);
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: { expectedVersion },
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }
      const member = await transaction.groupMember.findFirst({
        where: {
          id: memberId,
          parentUserId: scope.userId,
          campaign: { campusId: scope.campusId },
        },
        include: {
          campaign: true,
          enrollmentOrder: true,
          transactions: {
            where: { type: 'PAYMENT' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
      if (!member) {
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Group member not found',
          404,
        );
      }
      if (
        member.status !== 'PENDING_PAYMENT' ||
        member.version !== expectedVersion ||
        member.reservationExpiresAt.getTime() <= Date.now()
      ) {
        throw new DomainError(
          ErrorCode.GROUP_MEMBER_STATUS_CONFLICT,
          'Group member cannot create a payment invocation',
          409,
        );
      }
      let payment = member.transactions[0];
      if (!payment) {
        throw new DomainError(
          ErrorCode.GROUP_MEMBER_STATUS_CONFLICT,
          'Payment transaction not found',
          409,
        );
      }
      if (payment.status === 'FAILED') {
        payment = await transaction.paymentTransaction.create({
          data: {
            groupMemberId: member.id,
            enrollmentOrderId: member.enrollmentOrderId,
            type: 'PAYMENT',
            provider: this.paymentAdapter.mode,
            outTradeNo: createPaymentBusinessNo(),
            amountFen: member.campaign.priceFen,
          },
        });
      } else if (payment.status !== 'PENDING') {
        throw new DomainError(
          ErrorCode.GROUP_MEMBER_STATUS_CONFLICT,
          'Pending payment transaction not found',
          409,
        );
      }
      const invocation = await this.paymentAdapter.createJsapiPayment({
        outTradeNo: payment.outTradeNo,
        amountFen: payment.amountFen,
        description: member.campaign.title,
        payerOpenId: scope.userId,
      });
      const result = {
        ...invocation,
        memberId: member.id,
        orderId: member.enrollmentOrderId,
        timeStamp: invocation.mode === 'WECHAT' ? invocation.timeStamp : null,
        nonceStr: invocation.mode === 'WECHAT' ? invocation.nonceStr : null,
        package: invocation.mode === 'WECHAT' ? invocation.package : null,
        signType: invocation.mode === 'WECHAT' ? invocation.signType : null,
        paySign: invocation.mode === 'WECHAT' ? invocation.paySign : null,
      };
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: result as Prisma.InputJsonValue,
      });
      return result;
    });
  }

  async confirmMockPayment(
    scope: ParentScope,
    memberId: string,
    outTradeNo: string,
    idempotencyKey: string,
  ) {
    if (this.paymentAdapter.mode !== 'MOCK') {
      throw new DomainError(
        ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
        'Mock payment confirmation is disabled',
        503,
      );
    }
    const route = mockConfirmationRoute(memberId);
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotency.claim(transaction, {
        key: idempotencyKey,
        route,
        request: { outTradeNo },
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }

      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "PaymentTransaction" WHERE "outTradeNo" = ${outTradeNo} FOR UPDATE`,
      );
      const payment = await transaction.paymentTransaction.findFirst({
        where: {
          outTradeNo,
          type: 'PAYMENT',
          provider: 'MOCK',
          groupMemberId: memberId,
          member: {
            parentUserId: scope.userId,
            campaign: { campusId: scope.campusId },
          },
        },
        include: { member: true },
      });
      if (!payment) {
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Payment transaction not found',
          404,
        );
      }

      if (payment.status === 'PENDING') {
        if (
          payment.member.status !== 'PENDING_PAYMENT' ||
          payment.member.reservationExpiresAt.getTime() <= Date.now()
        ) {
          throw new DomainError(
            ErrorCode.GROUP_MEMBER_STATUS_CONFLICT,
            'Group member cannot be paid',
            409,
          );
        }
        const paidAt = new Date();
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "GroupTeam" WHERE "id" = ${payment.member.teamId}::uuid FOR UPDATE`,
        );
        await transaction.paymentTransaction.update({
          where: { id: payment.id },
          data: {
            status: 'SUCCEEDED',
            providerTradeNo: `MOCK-${payment.outTradeNo}`,
            rawNotification: {
              source: 'LOCAL_CONFIRMATION',
              outTradeNo: payment.outTradeNo,
              amountFen: payment.amountFen,
            },
            succeededAt: paidAt,
          },
        });
        await transaction.groupMember.update({
          where: { id: memberId },
          data: { status: 'PAID', paidAt, version: { increment: 1 } },
        });
        await transaction.enrollmentOrder.update({
          where: { id: payment.enrollmentOrderId },
          data: { status: 'PAID', version: { increment: 1 } },
        });
        const paidMemberCount = await transaction.groupMember.count({
          where: {
            teamId: payment.member.teamId,
            status: { in: ['PAID', 'SETTLED'] },
          },
        });
        await transaction.groupTeam.update({
          where: { id: payment.member.teamId },
          data: { paidMemberCount, version: { increment: 1 } },
        });
        const team = await transaction.groupTeam.findUniqueOrThrow({
          where: { id: payment.member.teamId },
          include: { campaign: true },
        });
        if (paidMemberCount === team.campaign.maxPaidMembers) {
          await this.settlementService.settleTeam(
            transaction,
            payment.member.teamId,
            paidAt,
          );
        }
      } else if (payment.status !== 'SUCCEEDED') {
        throw new DomainError(
          ErrorCode.GROUP_MEMBER_STATUS_CONFLICT,
          'Payment transaction cannot be confirmed',
          409,
        );
      }

      const result = await loadGroupOrderView(transaction, memberId);
      await this.idempotency.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: result as Prisma.InputJsonValue,
      });
      return result;
    });
  }

  async refundMember(
    transaction: Prisma.TransactionClient,
    memberId: string,
    actorUserId: string,
    reason: string,
    refundedAt = new Date(),
  ): Promise<void> {
    const member = await transaction.groupMember.findUnique({
      where: { id: memberId },
      include: {
        enrollmentOrder: { include: { coursePackage: true } },
        transactions: {
          where: { type: 'PAYMENT', status: 'SUCCEEDED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!member) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Group member not found',
        404,
      );
    }
    if (member.status === 'REFUNDED') {
      return;
    }
    if (member.status !== 'PAID' && member.status !== 'SETTLED') {
      throw new DomainError(
        ErrorCode.REFUND_NOT_ALLOWED,
        'Only paid group members can be refunded',
        409,
      );
    }
    const payment = member.transactions[0];
    if (!payment) {
      throw new DomainError(
        ErrorCode.REFUND_NOT_ALLOWED,
        'Successful payment transaction not found',
        409,
      );
    }

    const coursePackage = member.enrollmentOrder.coursePackage;
    if (coursePackage) {
      const consumedCount = await transaction.lessonLedgerEntry.count({
        where: { coursePackageId: coursePackage.id, entryType: 'CONSUME' },
      });
      if (consumedCount > 0) {
        throw new DomainError(
          ErrorCode.REFUND_NOT_ALLOWED,
          'The granted course package has already been used',
          409,
        );
      }
    }

    const outRefundNo = `GREF-${Date.now()}-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const refund = await this.paymentAdapter.requestRefund({
      outTradeNo: payment.outTradeNo,
      outRefundNo,
      amountFen: payment.amountFen,
      totalFen: payment.amountFen,
      reason,
    });
    await transaction.paymentTransaction.create({
      data: {
        groupMemberId: member.id,
        enrollmentOrderId: member.enrollmentOrderId,
        type: 'REFUND',
        provider: this.paymentAdapter.mode,
        outTradeNo: outRefundNo,
        providerTradeNo: refund.providerRefundNo,
        amountFen: payment.amountFen,
        status: refund.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'PROCESSING',
        rawNotification: { source: 'MANAGEMENT_REFUND', reason },
        succeededAt: refund.status === 'SUCCEEDED' ? refundedAt : null,
      },
    });
    if (refund.status !== 'SUCCEEDED') {
      await transaction.groupMember.update({
        where: { id: member.id },
        data: { status: 'REFUNDING', version: { increment: 1 } },
      });
      await transaction.enrollmentOrder.update({
        where: { id: member.enrollmentOrderId },
        data: { status: 'REFUNDING', version: { increment: 1 } },
      });
      return;
    }

    if (coursePackage) {
      await this.reverseUnusedPackage(
        transaction,
        coursePackage,
        actorUserId,
        reason,
        refundedAt,
      );
    }
    await transaction.groupMember.update({
      where: { id: member.id },
      data: { status: 'REFUNDED', version: { increment: 1 } },
    });
    await transaction.enrollmentOrder.update({
      where: { id: member.enrollmentOrderId },
      data: { status: 'REFUNDED', version: { increment: 1 } },
    });
  }

  private async reverseUnusedPackage(
    transaction: Prisma.TransactionClient,
    coursePackage: {
      id: string;
      campusId: string;
      studentId: string;
      mainBalanceUnits: number;
      giftBalanceUnits: number;
    },
    actorUserId: string,
    reason: string,
    refundedAt: Date,
  ): Promise<void> {
    for (const [bucket, balance] of [
      ['MAIN', coursePackage.mainBalanceUnits],
      ['GIFT', coursePackage.giftBalanceUnits],
    ] as const) {
      if (balance === 0) {
        continue;
      }
      await transaction.lessonLedgerEntry.create({
        data: {
          campusId: coursePackage.campusId,
          studentId: coursePackage.studentId,
          coursePackageId: coursePackage.id,
          entryType: 'ADJUSTMENT',
          bucket,
          deltaUnits: -balance,
          balanceBeforeUnits: balance,
          balanceAfterUnits: 0,
          idempotencyKey: `group-refund:${coursePackage.id}:${bucket.toLowerCase()}`,
          actorUserId,
          reason,
          createdAt: refundedAt,
        },
      });
    }
    await transaction.coursePackage.update({
      where: { id: coursePackage.id },
      data: {
        mainBalanceUnits: 0,
        giftBalanceUnits: 0,
        isActive: false,
        version: { increment: 1 },
      },
    });
  }
}

function createPaymentBusinessNo(): string {
  return `GPAY-${Date.now()}-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
