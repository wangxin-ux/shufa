import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  StoredFileService,
  type UploadedStoredFile,
} from '../file/stored-file.service';
import {
  CreateFinanceRefundDto,
  FinanceRefundActionDto,
  FinanceRefundQueryDto,
  FinanceRefundQuoteDto,
} from './finance-refund.dto';
import {
  REFUND_ACTIONS,
  RESERVED_REFUND_STATUSES,
  REVIEW_ACTIONS,
  refundReferenceFen,
  refundTransition,
  type RefundAction,
} from './finance-refund.rules';

const proofOptions = {
  purpose: 'FINANCE_REFUND_PROOF',
  directory: 'finance-refunds',
  allowedMimeTypes: ['image/png', 'image/jpeg'],
  maxBytes: 3 * 1024 * 1024,
  invalidCode: 'PAYMENT_PROOF_INVALID',
  label: 'finance refund proof',
} as const;
const include = {
  issuance: {
    include: {
      receipt: {
        include: {
          campus: { select: { name: true } },
          student: { select: { displayName: true } },
        },
      },
    },
  },
  events: {
    orderBy: { version: 'asc' },
    include: { actor: { select: { displayName: true } } },
  },
  payment: true,
} satisfies Prisma.FinanceRefundRequestInclude;
type RefundRecord = Prisma.FinanceRefundRequestGetPayload<{
  include: typeof include;
}>;

@Injectable()
export class FinanceRefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly files: StoredFileService,
  ) {}

  private authorize(
    actor: AuthenticatedUser,
    roles: Array<'FINANCE' | 'SUPER_ADMIN'>,
  ) {
    if (
      actor.roles.length !== 1 ||
      actor.roles[0].campusId !== null ||
      !roles.some((role) => role === actor.roles[0].code)
    ) {
      throw new DomainError(
        'FORBIDDEN',
        'A single authorized headquarters role is required',
        403,
      );
    }
  }

  async uploadProof(actor: AuthenticatedUser, file?: UploadedStoredFile) {
    this.authorize(actor, ['FINANCE']);
    const proof = await this.files.store(actor, file, proofOptions);
    return {
      id: proof.id,
      mimeType: proof.mimeType,
      sizeBytes: proof.sizeBytes,
    };
  }

  async readProof(actor: AuthenticatedUser, id: string) {
    this.authorize(actor, ['FINANCE', 'SUPER_ADMIN']);
    const payment = await this.prisma.financeRefundPayment.findUnique({
      where: { refundId: id },
    });
    if (!payment) this.notFound();
    return this.files.readPrivateFile(payment.proofFileId, proofOptions);
  }

  async detail(actor: AuthenticatedUser, id: string) {
    this.authorize(actor, ['FINANCE', 'SUPER_ADMIN']);
    const refund = await this.prisma.financeRefundRequest.findUnique({
      where: { id },
      include,
    });
    if (!refund) this.notFound();
    return refundView(refund);
  }

  async list(actor: AuthenticatedUser, input: FinanceRefundQueryDto) {
    this.authorize(actor, ['FINANCE', 'SUPER_ADMIN']);
    const query = this.validate(FinanceRefundQueryDto, input);
    const where: Prisma.FinanceRefundRequestWhereInput = {
      status: query.status,
      issuance: {
        receiptId: query.receiptId,
        receipt: { campusId: query.campusId },
      },
    };
    const [records, total] = await this.prisma.$transaction(
      [
        this.prisma.financeRefundRequest.findMany({
          where,
          include,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.financeRefundRequest.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      items: records.map(refundView),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async submit(
    actor: AuthenticatedUser,
    receiptId: string,
    input: CreateFinanceRefundDto,
    key: string,
  ) {
    this.authorize(actor, ['FINANCE']);
    const dto = this.validate(CreateFinanceRefundDto, input);
    const route = `/finance/receipts/${receiptId}/refunds`;
    return this.prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: dto,
        campusId: null,
        actorUserId: actor.userId,
      });
      if (claim.replayed) return claim.responseBody;
      const { issuance, coursePackage } = await this.lockPackageAndReceipt(
        tx,
        receiptId,
      );
      const occupied = await this.reservationTotals(tx, issuance.id);
      this.assertReservedTotals(coursePackage, occupied);
      if (
        !coursePackage.isActive ||
        dto.mainUnits >
          coursePackage.mainBalanceUnits - coursePackage.mainReservedUnits ||
        dto.giftUnits >
          coursePackage.giftBalanceUnits - coursePackage.giftReservedUnits
      ) {
        throw new DomainError(
          'INSUFFICIENT_LESSON_BALANCE',
          'Requested units exceed unreserved lesson balance',
          409,
        );
      }
      const paid = await tx.financeRefundRequest.aggregate({
        where: { issuanceId: issuance.id, status: 'PAID' },
        _sum: { amountFen: true, mainUnits: true, giftUnits: true },
      });
      if (
        dto.amountFen + occupied.amountFen + (paid._sum.amountFen ?? 0) >
          issuance.originalAmountFen ||
        dto.mainUnits + occupied.mainUnits + (paid._sum.mainUnits ?? 0) >
          issuance.initialMainUnits ||
        dto.giftUnits + occupied.giftUnits + (paid._sum.giftUnits ?? 0) >
          issuance.initialGiftUnits
      ) {
        this.conflict(
          'Refund exceeds the remaining original receipt or issuance entitlement',
        );
      }
      const refund = await tx.financeRefundRequest.create({
        data: {
          issuanceId: issuance.id,
          mainUnits: dto.mainUnits,
          giftUnits: dto.giftUnits,
          amountFen: dto.amountFen,
          referenceAmountFen: refundReferenceFen(
            issuance.originalAmountFen,
            issuance.initialMainUnits,
            dto.mainUnits,
          ),
          reason: dto.reason.trim(),
          requestedByUserId: actor.userId,
        },
      });
      await tx.coursePackage.update({
        where: { id: coursePackage.id },
        data: {
          mainReservedUnits: { increment: dto.mainUnits },
          giftReservedUnits: { increment: dto.giftUnits },
          version: { increment: 1 },
        },
      });
      await tx.financeRefundEvent.create({
        data: {
          refundId: refund.id,
          actorUserId: actor.userId,
          action: 'SUBMIT',
          toStatus: 'SUBMITTED',
          version: 1,
          reason: dto.reason.trim(),
        },
      });
      await this.audit(
        tx,
        actor,
        issuance.receipt.campusId,
        refund.id,
        'SUBMIT',
        {
          amountFen: dto.amountFen,
          mainUnits: dto.mainUnits,
          giftUnits: dto.giftUnits,
        },
      );
      const response = refundView(
        await tx.financeRefundRequest.findUniqueOrThrow({
          where: { id: refund.id },
          include,
        }),
      );
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: response,
        responseStatus: 201,
      });
      return response;
    });
  }

  async quote(
    actor: AuthenticatedUser,
    receiptId: string,
    input: FinanceRefundQuoteDto,
  ) {
    this.authorize(actor, ['FINANCE']);
    const dto = this.validate(FinanceRefundQuoteDto, input);
    return this.prisma.$transaction(async (tx) => {
      const { issuance, coursePackage } = await this.lockPackageAndReceipt(
        tx,
        receiptId,
      );
      const reserved = await this.reservationTotals(tx, issuance.id);
      this.assertReservedTotals(coursePackage, reserved);
      const paid = await tx.financeRefundRequest.aggregate({
        where: { issuanceId: issuance.id, status: 'PAID' },
        _sum: { mainUnits: true, giftUnits: true, amountFen: true },
      });
      const availableMainUnits = Math.min(
        coursePackage.mainBalanceUnits - reserved.mainUnits,
        issuance.initialMainUnits -
          reserved.mainUnits -
          (paid._sum.mainUnits ?? 0),
      );
      const availableGiftUnits = Math.min(
        coursePackage.giftBalanceUnits - reserved.giftUnits,
        issuance.initialGiftUnits -
          reserved.giftUnits -
          (paid._sum.giftUnits ?? 0),
      );
      const maxAmountFen =
        issuance.originalAmountFen -
        reserved.amountFen -
        (paid._sum.amountFen ?? 0);
      if (
        !coursePackage.isActive ||
        dto.mainUnits > availableMainUnits ||
        dto.giftUnits > availableGiftUnits ||
        maxAmountFen < 1
      ) {
        this.conflict('Requested lessons or receipt allowance are unavailable');
      }
      const referenceAmountFen = refundReferenceFen(
        issuance.originalAmountFen,
        issuance.initialMainUnits,
        dto.mainUnits,
      );
      return {
        receiptId,
        mainUnits: dto.mainUnits,
        giftUnits: dto.giftUnits,
        availableMainUnits,
        availableGiftUnits,
        referenceAmountFen,
        suggestedAmountFen: Math.min(referenceAmountFen, maxAmountFen),
        maxAmountFen,
      };
    });
  }

  async act(
    actor: AuthenticatedUser,
    id: string,
    input: FinanceRefundActionDto,
    key: string,
  ) {
    const dto = this.validate(FinanceRefundActionDto, input);
    const action = dto.action as RefundAction;
    this.authorize(
      actor,
      REVIEW_ACTIONS.includes(action) ? ['SUPER_ADMIN'] : ['FINANCE'],
    );
    if (!REFUND_ACTIONS.includes(action)) this.invalid('Unknown refund action');
    if ((action === 'RECORD_PAYMENT') !== Boolean(dto.payment))
      this.invalid('Payment evidence is required only for payment recording');
    const route = `/finance/refunds/${id}/actions/${action}`;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const claim = await this.idempotency.claim(tx, {
          key,
          route,
          request: dto,
          campusId: null,
          actorUserId: actor.userId,
        });
        if (claim.replayed) return claim.responseBody;
        const initial = await tx.financeRefundRequest.findUnique({
          where: { id },
          select: { issuance: { select: { receiptId: true } } },
        });
        if (!initial) this.notFound();
        const { issuance, coursePackage } = await this.lockPackageAndReceipt(
          tx,
          initial.issuance.receiptId,
        );
        await tx.$queryRaw`SELECT "id" FROM "FinanceRefundRequest" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const current = await tx.financeRefundRequest.findUniqueOrThrow({
          where: { id },
        });
        if (
          current.issuanceId !== issuance.id ||
          current.version !== dto.expectedVersion
        )
          this.conflict('Refund version changed');
        if (
          REVIEW_ACTIONS.includes(action) &&
          current.requestedByUserId === actor.userId
        ) {
          throw new DomainError(
            'FORBIDDEN',
            'A requester cannot review their own refund',
            403,
          );
        }
        const next = refundTransition(current.status, action);
        const totals = await this.reservationTotals(tx, issuance.id);
        this.assertReservedTotals(coursePackage, totals);
        const releases = [
          'REJECTED',
          'WITHDRAWN',
          'CANCELLED',
          'PAID',
        ].includes(next);
        if (next === 'PAID') {
          const payment = dto.payment!;
          const paidAt = new Date(payment.paidAt);
          if (
            payment.amountFen !== current.amountFen ||
            !current.paymentStartedAt ||
            paidAt.getTime() > Date.now() ||
            paidAt < current.paymentStartedAt
          ) {
            this.invalid(
              'Payment amount or actual time is inconsistent with approved refund',
            );
          }
          await tx.$queryRaw`SELECT "id" FROM "StoredFile" WHERE "id" = ${payment.proofFileId}::uuid FOR UPDATE`;
          const proof = await tx.storedFile.findFirst({
            where: {
              id: payment.proofFileId,
              createdByUserId: actor.userId,
              purpose: proofOptions.purpose,
            },
            include: { financeRefundPayment: { select: { id: true } } },
          });
          if (!proof)
            this.invalid('An uploader-owned refund proof is required');
          if (proof.financeRefundPayment)
            this.conflict('Refund proof is already linked');
          await tx.financeRefundPayment.create({
            data: {
              refundId: id,
              amountFen: payment.amountFen,
              paidAt,
              proofFileId: proof.id,
              externalReference: payment.externalReference.trim(),
              recordedByUserId: actor.userId,
            },
          });
          for (const [bucket, units, before] of [
            ['MAIN', current.mainUnits, coursePackage.mainBalanceUnits],
            ['GIFT', current.giftUnits, coursePackage.giftBalanceUnits],
          ] as const) {
            if (!units) continue;
            await tx.lessonLedgerEntry.create({
              data: {
                campusId: issuance.receipt.campusId,
                studentId: issuance.receipt.studentId,
                coursePackageId: coursePackage.id,
                entryType: 'REFUND',
                bucket,
                financeRefundId: id,
                deltaUnits: -units,
                balanceBeforeUnits: before,
                balanceAfterUnits: before - units,
                idempotencyKey: `finance-refund:${id}:${bucket}`,
                actorUserId: actor.userId,
                reason: `退课退费 ${id}`,
                createdAt: new Date(),
              },
            });
          }
        }
        if (releases) {
          await tx.coursePackage.update({
            where: { id: coursePackage.id },
            data: {
              mainReservedUnits: { decrement: current.mainUnits },
              giftReservedUnits: { decrement: current.giftUnits },
              ...(next === 'PAID'
                ? {
                    mainBalanceUnits: { decrement: current.mainUnits },
                    giftBalanceUnits: { decrement: current.giftUnits },
                  }
                : {}),
              version: { increment: 1 },
            },
          });
        }
        const now = new Date();
        await tx.financeRefundRequest.update({
          where: { id },
          data: {
            status: next,
            version: { increment: 1 },
            ...(['APPROVE', 'REJECT'].includes(action)
              ? { reviewedByUserId: actor.userId, reviewedAt: now }
              : {}),
            ...(action === 'START_PAYMENT' ? { paymentStartedAt: now } : {}),
          },
        });
        await tx.financeRefundEvent.create({
          data: {
            refundId: id,
            actorUserId: actor.userId,
            action,
            fromStatus: current.status,
            toStatus: next,
            version: current.version + 1,
            reason: dto.reason.trim(),
          },
        });
        await this.audit(tx, actor, issuance.receipt.campusId, id, action, {
          fromStatus: current.status,
          toStatus: next,
          version: current.version + 1,
        });
        const response = refundView(
          await tx.financeRefundRequest.findUniqueOrThrow({
            where: { id },
            include,
          }),
        );
        await this.idempotency.complete(tx, {
          key,
          route,
          responseBody: response,
        });
        return response;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.conflict(
          'Refund payment reference or proof has already been recorded',
        );
      }
      throw error;
    }
  }

  private async lockPackageAndReceipt(
    tx: Prisma.TransactionClient,
    receiptId: string,
  ) {
    const original = await tx.financePackageIssuance.findUnique({
      where: { receiptId },
    });
    if (!original) this.notFound();
    // Match all balance writers: package first, receipt second, request third.
    await tx.$queryRaw`SELECT "id" FROM "CoursePackage" WHERE "id" = ${original.coursePackageId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "FinanceReceipt" WHERE "id" = ${receiptId}::uuid FOR UPDATE`;
    const issuance = await tx.financePackageIssuance.findUniqueOrThrow({
      where: { receiptId },
      include: { receipt: true },
    });
    const coursePackage = await tx.coursePackage.findUniqueOrThrow({
      where: { id: issuance.coursePackageId },
    });
    if (
      issuance.id !== original.id ||
      coursePackage.sourceOrderId !== null ||
      coursePackage.campusId !== issuance.receipt.campusId ||
      coursePackage.studentId !== issuance.receipt.studentId ||
      issuance.originalAmountFen !== issuance.receipt.amountFen
    )
      this.conflict('Original issuance requires reconciliation');
    return { issuance, coursePackage };
  }

  private async reservationTotals(
    tx: Prisma.TransactionClient,
    issuanceId: string,
  ) {
    const totals = await tx.financeRefundRequest.aggregate({
      where: { issuanceId, status: { in: RESERVED_REFUND_STATUSES } },
      _sum: { mainUnits: true, giftUnits: true, amountFen: true },
    });
    return {
      mainUnits: totals._sum.mainUnits ?? 0,
      giftUnits: totals._sum.giftUnits ?? 0,
      amountFen: totals._sum.amountFen ?? 0,
    };
  }
  private assertReservedTotals(
    coursePackage: { mainReservedUnits: number; giftReservedUnits: number },
    totals: { mainUnits: number; giftUnits: number },
  ) {
    if (
      coursePackage.mainReservedUnits !== totals.mainUnits ||
      coursePackage.giftReservedUnits !== totals.giftUnits
    ) {
      this.conflict('Lesson reservations require reconciliation');
    }
  }
  private audit(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    campusId: string,
    id: string,
    action: string,
    details: Prisma.InputJsonObject,
  ) {
    return tx.auditLog.create({
      data: {
        campusId,
        actorUserId: actor.userId,
        action: `FINANCE_REFUND_${action}`,
        resourceType: 'FinanceRefundRequest',
        resourceId: id,
        outcome: 'SUCCESS',
        details,
      },
    });
  }
  private validate<T extends object>(type: new () => T, input: T): T {
    const dto = plainToInstance(type, input);
    if (
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length
    )
      this.invalid('Invalid refund input');
    return dto;
  }
  private invalid(message: string): never {
    throw new DomainError('BAD_REQUEST', message, 400);
  }
  private conflict(message: string): never {
    throw new DomainError('CONFLICT', message, 409);
  }
  private notFound(): never {
    throw new DomainError(
      'RESOURCE_NOT_FOUND',
      'Refund or original issuance not found',
      404,
    );
  }
}

function refundView(row: RefundRecord) {
  const receipt = row.issuance.receipt;
  return {
    id: row.id,
    receiptId: receipt.id,
    coursePackageId: row.issuance.coursePackageId,
    campusId: receipt.campusId,
    campusName: receipt.campus.name,
    studentId: receipt.studentId,
    studentName: receipt.student.displayName,
    mainUnits: row.mainUnits,
    giftUnits: row.giftUnits,
    referenceAmountFen: row.referenceAmountFen,
    amountFen: row.amountFen,
    reason: row.reason,
    status: row.status,
    version: row.version,
    requestedByUserId: row.requestedByUserId,
    createdAt: row.createdAt.toISOString(),
    events: row.events.map((event) => ({
      id: event.id,
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      version: event.version,
      reason: event.reason,
      actorName: event.actor.displayName,
      createdAt: event.createdAt.toISOString(),
    })),
    payment: row.payment
      ? {
          amountFen: row.payment.amountFen,
          paidAt: row.payment.paidAt.toISOString(),
          recordedAt: row.payment.recordedAt.toISOString(),
          externalReference: row.payment.externalReference,
        }
      : null,
  };
}
