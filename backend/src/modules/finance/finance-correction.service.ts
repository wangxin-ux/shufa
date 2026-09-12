import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StoredFileService } from '../file/stored-file.service';
import {
  CreateFinanceCorrectionDto,
  FinanceCorrectionActionDto,
  FinanceCorrectionQueryDto,
  type FinanceCorrectionReplacementDto,
} from './finance-correction.dto';
import {
  CORRECTION_ACTIONS,
  CORRECTION_REVIEW_ACTIONS,
  correctionEffectFen,
  correctionTransition,
  type CorrectionAction,
} from './finance-correction.rules';

const proofOptions = {
  purpose: 'FINANCE_RECEIPT_PROOF',
  directory: 'finance-receipts',
  allowedMimeTypes: ['image/png', 'image/jpeg'],
  maxBytes: 3 * 1024 * 1024,
  invalidCode: 'PAYMENT_PROOF_INVALID',
  label: 'finance receipt proof',
} as const;

const correctionInclude = {
  originalIssuance: {
    include: {
      receipt: {
        include: {
          campus: { select: { name: true } },
          student: { select: { displayName: true } },
        },
      },
      coursePackage: true,
    },
  },
  events: {
    orderBy: { version: 'asc' },
    include: { actor: { select: { displayName: true } } },
  },
} satisfies Prisma.FinanceReceiptCorrectionInclude;

type CorrectionRecord = Prisma.FinanceReceiptCorrectionGetPayload<{
  include: typeof correctionInclude;
}>;
type LockedIssuance = Prisma.FinancePackageIssuanceGetPayload<{
  include: {
    receipt: {
      include: {
        campus: { select: { name: true } };
        student: { select: { displayName: true } };
        replacementForCorrection: { select: { id: true } };
      };
    };
  };
}>;
type LockedPackage = Awaited<
  ReturnType<Prisma.TransactionClient['coursePackage']['findUniqueOrThrow']>
>;

interface ReplacementSnapshot {
  campusId: string;
  campusName: string;
  studentId: string;
  studentName: string;
  amountFen: number;
  receivedOn: string;
  channel: string;
  proofFileId: string;
  note: string;
  package: {
    name: string;
    mainUnits: number;
    giftUnits: number;
    validFrom: string;
    expiresAt: string | null;
  };
}

@Injectable()
export class FinanceCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly files: StoredFileService,
  ) {}

  async submit(
    actor: AuthenticatedUser,
    receiptId: string,
    input: CreateFinanceCorrectionDto,
    key: string,
  ) {
    this.authorize(actor, ['FINANCE']);
    const dto = this.validate(CreateFinanceCorrectionDto, input);
    if ((dto.type === 'REPLACE') !== Boolean(dto.replacement)) {
      this.invalid('Replacement data is required only for REPLACE corrections');
    }
    const route = `/finance/receipts/${receiptId}/corrections`;
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

        const { issuance, coursePackage } = await this.lockPackageAndReceipt(
          tx,
          receiptId,
        );
        await this.assertEligible(tx, issuance, coursePackage);
        const replacement = dto.replacement
          ? await this.validateReplacement(
              tx,
              actor.userId,
              dto.replacement,
              null,
            )
          : null;
        const correction = await tx.financeReceiptCorrection.create({
          data: {
            originalIssuanceId: issuance.id,
            type: dto.type,
            reason: dto.reason.trim(),
            originalAmountFen: issuance.originalAmountFen,
            sourcePackageVersion: coursePackage.version,
            replacementSnapshot: replacement
              ? (replacement as unknown as Prisma.InputJsonObject)
              : undefined,
            proposedProofFileId: replacement?.proofFileId,
            requestedByUserId: actor.userId,
          },
        });
        await tx.financeReceiptCorrectionEvent.create({
          data: {
            correctionId: correction.id,
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
          correction.id,
          'SUBMIT',
          {
            receiptId,
            type: dto.type,
            originalAmountFen: issuance.originalAmountFen,
          },
        );
        const response = correctionView(
          await tx.financeReceiptCorrection.findUniqueOrThrow({
            where: { id: correction.id },
            include: correctionInclude,
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
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async list(actor: AuthenticatedUser, input: FinanceCorrectionQueryDto) {
    this.authorize(actor, ['FINANCE', 'SUPER_ADMIN']);
    const query = this.validate(FinanceCorrectionQueryDto, input);
    const where: Prisma.FinanceReceiptCorrectionWhereInput = {
      status: query.status,
      originalIssuance: {
        receiptId: query.receiptId,
        receipt: { campusId: query.campusId },
      },
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.financeReceiptCorrection.findMany({
          where,
          include: correctionInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.financeReceiptCorrection.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      items: rows.map(correctionView),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(actor: AuthenticatedUser, id: string) {
    this.authorize(actor, ['FINANCE', 'SUPER_ADMIN']);
    const correction = await this.prisma.financeReceiptCorrection.findUnique({
      where: { id },
      include: correctionInclude,
    });
    if (!correction) this.notFound();
    return correctionView(correction);
  }

  async readOriginalProof(actor: AuthenticatedUser, id: string) {
    this.authorize(actor, ['FINANCE', 'SUPER_ADMIN']);
    const correction = await this.prisma.financeReceiptCorrection.findUnique({
      where: { id },
      select: {
        originalIssuance: {
          select: { receipt: { select: { proofFileId: true } } },
        },
      },
    });
    if (!correction) this.notFound();
    return this.files.readPrivateFile(
      correction.originalIssuance.receipt.proofFileId,
      proofOptions,
    );
  }

  async readReplacementProof(actor: AuthenticatedUser, id: string) {
    this.authorize(actor, ['FINANCE', 'SUPER_ADMIN']);
    const correction = await this.prisma.financeReceiptCorrection.findUnique({
      where: { id },
      select: { proposedProofFileId: true },
    });
    if (!correction?.proposedProofFileId) this.notFound();
    return this.files.readPrivateFile(
      correction.proposedProofFileId,
      proofOptions,
    );
  }

  async act(
    actor: AuthenticatedUser,
    id: string,
    input: FinanceCorrectionActionDto,
    key: string,
  ) {
    const dto = this.validate(FinanceCorrectionActionDto, input);
    const action = dto.action as CorrectionAction;
    if (!CORRECTION_ACTIONS.includes(action)) {
      this.invalid('Unknown correction action');
    }
    const review = CORRECTION_REVIEW_ACTIONS.includes(action);
    this.authorize(actor, review ? ['SUPER_ADMIN'] : ['FINANCE']);
    const route = review
      ? `/management/finance-corrections/${id}/actions`
      : `/finance/corrections/${id}/actions`;

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

        const initial = await tx.financeReceiptCorrection.findUnique({
          where: { id },
          select: {
            originalIssuance: { select: { receiptId: true } },
          },
        });
        if (!initial) this.notFound();
        const { issuance, coursePackage } = await this.lockPackageAndReceipt(
          tx,
          initial.originalIssuance.receiptId,
        );
        await tx.$queryRaw`SELECT "id" FROM "FinanceReceiptCorrection" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const current = await tx.financeReceiptCorrection.findUniqueOrThrow({
          where: { id },
        });
        if (
          current.originalIssuanceId !== issuance.id ||
          current.version !== dto.expectedVersion
        ) {
          this.conflict('Correction version changed');
        }
        if (review && current.requestedByUserId === actor.userId) {
          throw new DomainError(
            'FORBIDDEN',
            'A requester cannot review their own correction',
            403,
          );
        }

        const next = correctionTransition(current.status, action);
        let replacementReceiptId: string | null = null;
        if (action === 'APPLY') {
          await this.assertEligible(
            tx,
            issuance,
            coursePackage,
            current.id,
            current.sourcePackageVersion,
          );
          const replacement = current.replacementSnapshot
            ? replacementSnapshot(current.replacementSnapshot)
            : null;
          if ((current.type === 'REPLACE') !== Boolean(replacement)) {
            this.conflict('Correction proposal requires reconciliation');
          }
          if (replacement) {
            await this.validateReplacement(
              tx,
              current.requestedByUserId,
              replacement,
              current.id,
            );
          }
          replacementReceiptId = await this.applyCorrection(
            tx,
            actor,
            current.id,
            issuance,
            coursePackage,
            replacement,
          );
        }

        const now = new Date();
        await tx.financeReceiptCorrection.update({
          where: { id },
          data: {
            status: next,
            version: { increment: 1 },
            ...(review
              ? { reviewedByUserId: actor.userId, reviewedAt: now }
              : {}),
            ...(action === 'APPLY'
              ? {
                  appliedByUserId: actor.userId,
                  appliedAt: now,
                  replacementReceiptId,
                }
              : {}),
          },
        });
        await tx.financeReceiptCorrectionEvent.create({
          data: {
            correctionId: id,
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
          replacementReceiptId,
        });
        const response = correctionView(
          await tx.financeReceiptCorrection.findUniqueOrThrow({
            where: { id },
            include: correctionInclude,
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
      this.rethrowConflict(error);
    }
  }

  private async lockPackageAndReceipt(
    tx: Prisma.TransactionClient,
    receiptId: string,
  ): Promise<{ issuance: LockedIssuance; coursePackage: LockedPackage }> {
    const original = await tx.financePackageIssuance.findUnique({
      where: { receiptId },
      select: { id: true, coursePackageId: true },
    });
    if (!original) this.notFound();
    // All balance writers acquire the package before the receipt and request.
    await tx.$queryRaw`SELECT "id" FROM "CoursePackage" WHERE "id" = ${original.coursePackageId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "FinanceReceipt" WHERE "id" = ${receiptId}::uuid FOR UPDATE`;
    const issuance = await tx.financePackageIssuance.findUniqueOrThrow({
      where: { receiptId },
      include: {
        receipt: {
          include: {
            campus: { select: { name: true } },
            student: { select: { displayName: true } },
            replacementForCorrection: { select: { id: true } },
          },
        },
      },
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
    ) {
      this.conflict('Original issuance requires reconciliation');
    }
    return { issuance, coursePackage };
  }

  private async assertEligible(
    tx: Prisma.TransactionClient,
    issuance: LockedIssuance,
    coursePackage: LockedPackage,
    correctionId?: string,
    expectedVersion = 1,
  ) {
    if (
      !coursePackage.isActive ||
      issuance.receipt.replacementForCorrection !== null ||
      coursePackage.version !== expectedVersion ||
      coursePackage.mainBalanceUnits !== issuance.initialMainUnits ||
      coursePackage.giftBalanceUnits !== issuance.initialGiftUnits ||
      coursePackage.mainReservedUnits !== 0 ||
      coursePackage.giftReservedUnits !== 0 ||
      coursePackage.paidAmountFen !== issuance.originalAmountFen ||
      coursePackage.name !== issuance.name ||
      coursePackage.validFrom.getTime() !== issuance.validFrom.getTime() ||
      coursePackage.expiresAt?.getTime() !== issuance.expiresAt?.getTime()
    ) {
      this.conflict(
        'Only a completely untouched issued package can be corrected',
      );
    }
    const ledger = await tx.lessonLedgerEntry.findMany({
      where: { coursePackageId: coursePackage.id },
      orderBy: [{ bucket: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    const refundCount = await tx.financeRefundRequest.count({
      where: { issuanceId: issuance.id },
    });
    const correctionCount = await tx.financeReceiptCorrection.count({
      where: {
        originalIssuanceId: issuance.id,
        status: { in: ['SUBMITTED', 'APPROVED', 'APPLIED'] },
        ...(correctionId ? { id: { not: correctionId } } : {}),
      },
    });
    const expected = [
      ['MAIN', issuance.initialMainUnits],
      ['GIFT', issuance.initialGiftUnits],
    ].filter(([, units]) => units !== 0);
    const pristine =
      refundCount === 0 &&
      correctionCount === 0 &&
      ledger.length === expected.length &&
      ledger.every((entry, index) => {
        const [bucket, units] = expected[index];
        return (
          entry.entryType === 'GRANT' &&
          entry.bucket === bucket &&
          entry.deltaUnits === units &&
          entry.balanceBeforeUnits === 0 &&
          entry.balanceAfterUnits === units &&
          entry.campusId === issuance.receipt.campusId &&
          entry.studentId === issuance.receipt.studentId &&
          entry.lessonSessionId === null &&
          entry.reversalOfId === null &&
          entry.financeRefundId === null &&
          entry.financeCorrectionId === null
        );
      });
    if (!pristine) {
      this.conflict(
        'Package history is not eligible for whole-record correction',
      );
    }
  }

  private async validateReplacement(
    tx: Prisma.TransactionClient,
    requesterUserId: string,
    input: FinanceCorrectionReplacementDto | ReplacementSnapshot,
    correctionId: string | null,
  ): Promise<ReplacementSnapshot> {
    const receivedOn = calendarDate(input.receivedOn);
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    if (input.receivedOn > today) {
      this.invalid('Replacement receipt date cannot be in the future');
    }
    const validFrom = new Date(input.package.validFrom);
    const expiresAt = input.package.expiresAt
      ? new Date(input.package.expiresAt)
      : null;
    if (
      !Number.isFinite(validFrom.getTime()) ||
      (expiresAt && expiresAt <= validFrom)
    ) {
      this.invalid('Replacement package validity is invalid');
    }
    await tx.$queryRaw`SELECT "id" FROM "Student" WHERE "id" = ${input.studentId}::uuid FOR UPDATE`;
    const student = await tx.student.findFirst({
      where: {
        id: input.studentId,
        campusId: input.campusId,
        isActive: true,
      },
      select: {
        displayName: true,
        campus: { select: { name: true } },
      },
    });
    if (!student)
      this.invalid('Replacement student is not active in this campus');

    await tx.$queryRaw`SELECT "id" FROM "StoredFile" WHERE "id" = ${input.proofFileId}::uuid FOR UPDATE`;
    const proof = await tx.storedFile.findFirst({
      where: {
        id: input.proofFileId,
        purpose: proofOptions.purpose,
        createdByUserId: requesterUserId,
      },
      include: {
        financeReceipt: { select: { id: true } },
        financeCorrectionProposal: { select: { id: true } },
      },
    });
    if (!proof) this.invalid('An uploader-owned replacement proof is required');
    if (
      proof.financeReceipt ||
      (proof.financeCorrectionProposal &&
        proof.financeCorrectionProposal.id !== correctionId)
    ) {
      this.conflict('Replacement proof is already linked');
    }
    if (correctionId && proof.financeCorrectionProposal?.id !== correctionId) {
      this.conflict('Replacement proof no longer matches the proposal');
    }

    return {
      campusId: input.campusId,
      campusName: student.campus.name,
      studentId: input.studentId,
      studentName: student.displayName,
      amountFen: input.amountFen,
      receivedOn: receivedOn.toISOString().slice(0, 10),
      channel: input.channel,
      proofFileId: input.proofFileId,
      note: input.note?.trim() ?? '',
      package: {
        name: input.package.name.trim(),
        mainUnits: input.package.mainUnits,
        giftUnits: input.package.giftUnits,
        validFrom: validFrom.toISOString(),
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    };
  }

  private async applyCorrection(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    correctionId: string,
    issuance: LockedIssuance,
    coursePackage: LockedPackage,
    replacement: ReplacementSnapshot | null,
  ): Promise<string | null> {
    const grants = await tx.lessonLedgerEntry.findMany({
      where: { coursePackageId: coursePackage.id, entryType: 'GRANT' },
      orderBy: { bucket: 'asc' },
    });
    for (const grant of grants) {
      await tx.lessonLedgerEntry.create({
        data: {
          campusId: issuance.receipt.campusId,
          studentId: issuance.receipt.studentId,
          coursePackageId: coursePackage.id,
          entryType: 'CORRECTION',
          bucket: grant.bucket,
          financeCorrectionId: correctionId,
          deltaUnits: -grant.deltaUnits,
          balanceBeforeUnits: grant.deltaUnits,
          balanceAfterUnits: 0,
          idempotencyKey: `finance-correction:${correctionId}:${grant.bucket}`,
          reversalOfId: grant.id,
          actorUserId: actor.userId,
          reason: `财务收款纠错 ${correctionId}`,
        },
      });
    }
    const updated = await tx.coursePackage.updateMany({
      where: {
        id: coursePackage.id,
        version: coursePackage.version,
        mainBalanceUnits: coursePackage.mainBalanceUnits,
        giftBalanceUnits: coursePackage.giftBalanceUnits,
        mainReservedUnits: 0,
        giftReservedUnits: 0,
        isActive: true,
      },
      data: {
        mainBalanceUnits: 0,
        giftBalanceUnits: 0,
        isActive: false,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      this.conflict('Course package changed while applying correction');
    }
    if (!replacement) return null;

    const receipt = await tx.financeReceipt.create({
      data: {
        campusId: replacement.campusId,
        studentId: replacement.studentId,
        amountFen: replacement.amountFen,
        receivedOn: calendarDate(replacement.receivedOn),
        channel: replacement.channel,
        proofFileId: replacement.proofFileId,
        note: replacement.note,
        createdByUserId: actor.userId,
      },
    });
    const newPackage = await tx.coursePackage.create({
      data: {
        campusId: replacement.campusId,
        studentId: replacement.studentId,
        name: replacement.package.name,
        mainBalanceUnits: replacement.package.mainUnits,
        giftBalanceUnits: replacement.package.giftUnits,
        paidAmountFen: replacement.amountFen,
        validFrom: new Date(replacement.package.validFrom),
        expiresAt: replacement.package.expiresAt
          ? new Date(replacement.package.expiresAt)
          : null,
      },
    });
    await tx.financePackageIssuance.create({
      data: {
        receiptId: receipt.id,
        coursePackageId: newPackage.id,
        originalAmountFen: replacement.amountFen,
        initialMainUnits: replacement.package.mainUnits,
        initialGiftUnits: replacement.package.giftUnits,
        name: replacement.package.name,
        validFrom: new Date(replacement.package.validFrom),
        expiresAt: replacement.package.expiresAt
          ? new Date(replacement.package.expiresAt)
          : null,
        issuedByUserId: actor.userId,
      },
    });
    for (const [bucket, units] of [
      ['MAIN', replacement.package.mainUnits],
      ['GIFT', replacement.package.giftUnits],
    ] as const) {
      if (!units) continue;
      await tx.lessonLedgerEntry.create({
        data: {
          campusId: replacement.campusId,
          studentId: replacement.studentId,
          coursePackageId: newPackage.id,
          entryType: 'GRANT',
          bucket,
          deltaUnits: units,
          balanceBeforeUnits: 0,
          balanceAfterUnits: units,
          idempotencyKey: `finance-correction:${correctionId}:replacement:${bucket}`,
          actorUserId: actor.userId,
          reason: `财务纠错替代发包 ${correctionId}`,
        },
      });
    }
    return receipt.id;
  }

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
        action: `FINANCE_CORRECTION_${action}`,
        resourceType: 'FinanceReceiptCorrection',
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
    ) {
      this.invalid('Invalid correction input');
    }
    return dto;
  }

  private rethrowConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      this.conflict('Correction or replacement proof is already linked');
    }
    throw error;
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
      'Correction or original issuance not found',
      404,
    );
  }
}

function correctionView(row: CorrectionRecord) {
  const issuance = row.originalIssuance;
  const receipt = issuance.receipt;
  const replacement = row.replacementSnapshot
    ? replacementSnapshot(row.replacementSnapshot)
    : null;
  return {
    id: row.id,
    originalReceiptId: receipt.id,
    originalCoursePackageId: issuance.coursePackageId,
    type: row.type,
    status: row.status,
    version: row.version,
    reason: row.reason,
    requestedByUserId: row.requestedByUserId,
    createdAt: row.createdAt.toISOString(),
    original: {
      campusId: receipt.campusId,
      campusName: receipt.campus.name,
      studentId: receipt.studentId,
      studentName: receipt.student.displayName,
      amountFen: receipt.amountFen,
      receivedOn: receipt.receivedOn.toISOString().slice(0, 10),
      channel: receipt.channel,
      note: receipt.note,
      proofAvailable: true,
      package: {
        name: issuance.name,
        mainUnits: issuance.initialMainUnits,
        giftUnits: issuance.initialGiftUnits,
        validFrom: issuance.validFrom.toISOString(),
        expiresAt: issuance.expiresAt?.toISOString() ?? null,
      },
    },
    proposedReplacement: replacement
      ? {
          campusId: replacement.campusId,
          campusName: replacement.campusName,
          studentId: replacement.studentId,
          studentName: replacement.studentName,
          amountFen: replacement.amountFen,
          receivedOn: replacement.receivedOn,
          channel: replacement.channel,
          note: replacement.note,
          proofAvailable: true,
          package: replacement.package,
        }
      : null,
    replacementReceiptId: row.replacementReceiptId,
    correctionEffectFen: correctionEffectFen(
      row.type,
      row.originalAmountFen,
      replacement?.amountFen ?? null,
    ),
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
  };
}

function replacementSnapshot(value: Prisma.JsonValue): ReplacementSnapshot {
  return value as unknown as ReplacementSnapshot;
}

function calendarDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new DomainError('BAD_REQUEST', 'Invalid calendar date', 400);
  }
  return date;
}
