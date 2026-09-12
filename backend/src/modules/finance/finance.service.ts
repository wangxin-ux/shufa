import { Injectable } from '@nestjs/common';
import { Prisma, type FinancePackageIssuance } from '@prisma/client';
import { Workbook } from 'exceljs';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  StoredFileService,
  type UploadedStoredFile,
} from '../file/stored-file.service';
import {
  CreateFinanceReceiptDto,
  FinanceQueryDto,
  IssueFinancePackageDto,
} from './finance.dto';

const proofOptions = {
  purpose: 'FINANCE_RECEIPT_PROOF',
  directory: 'finance-receipts',
  allowedMimeTypes: ['image/png', 'image/jpeg'],
  maxBytes: 3 * 1024 * 1024,
  invalidCode: 'PAYMENT_PROOF_INVALID',
  label: 'finance receipt proof',
} as const;
const receiptInclude = {
  campus: { select: { name: true } },
  student: { select: { displayName: true } },
  issuance: {
    include: {
      corrections: {
        where: { status: { in: ['SUBMITTED', 'APPROVED', 'APPLIED'] } },
        orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
        take: 1,
        select: {
          id: true,
          type: true,
          status: true,
          replacementReceiptId: true,
          replacementReceipt: { select: { amountFen: true } },
        },
      },
    },
  },
  replacementForCorrection: { select: { id: true } },
} satisfies Prisma.FinanceReceiptInclude;
type ReceiptRecord = Prisma.FinanceReceiptGetPayload<{
  include: typeof receiptInclude;
}>;

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly files: StoredFileService,
  ) {}

  private authorize(actor: AuthenticatedUser) {
    if (
      actor.roles.length !== 1 ||
      actor.roles[0].code !== 'FINANCE' ||
      actor.roles[0].campusId !== null
    ) {
      throw new DomainError(
        'FORBIDDEN',
        'A single headquarters finance role is required',
        403,
      );
    }
  }

  async campuses(actor: AuthenticatedUser, query: FinanceQueryDto) {
    this.authorize(actor);
    const where = {
      name: {
        contains: query.query?.trim() ?? '',
        mode: 'insensitive' as const,
      },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.campus.findMany({
        where,
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.campus.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async students(actor: AuthenticatedUser, query: FinanceQueryDto) {
    this.authorize(actor);
    if (!query.campusId) this.invalid('Select a campus first');
    const where = {
      campusId: query.campusId,
      isActive: true,
      displayName: {
        contains: query.query?.trim() ?? '',
        mode: 'insensitive' as const,
      },
    };
    const [students, total] = await this.prisma.$transaction([
      this.prisma.student.findMany({
        where,
        select: { id: true, displayName: true },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.student.count({ where }),
    ]);
    return {
      items: students.map((student) => ({
        id: student.id,
        name: student.displayName,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async uploadProof(actor: AuthenticatedUser, file?: UploadedStoredFile) {
    this.authorize(actor);
    const stored = await this.files.store(actor, file, proofOptions);
    return {
      id: stored.id,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
    };
  }

  async readProof(actor: AuthenticatedUser, receiptId: string) {
    this.authorize(actor);
    const receipt = await this.prisma.financeReceipt.findUnique({
      where: { id: receiptId },
      select: { proofFileId: true },
    });
    if (!receipt) this.notFound();
    return this.files.readPrivateFile(receipt.proofFileId, proofOptions);
  }

  async list(actor: AuthenticatedUser, query: FinanceQueryDto) {
    this.authorize(actor);
    const where = this.receiptWhere(query);
    const originalWhere = {
      AND: [where, { replacementForCorrection: { is: null } }],
    } satisfies Prisma.FinanceReceiptWhereInput;
    const replacementWhere = {
      AND: [where, { replacementForCorrection: { isNot: null } }],
    } satisfies Prisma.FinanceReceiptWhereInput;
    const [rows, total, sum, unlinkedCount, correctedOriginals, replacements] =
      await this.prisma.$transaction(
        [
          this.prisma.financeReceipt.findMany({
            where,
            include: receiptInclude,
            orderBy: [
              { receivedOn: 'desc' },
              { createdAt: 'desc' },
              { id: 'desc' },
            ],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          this.prisma.financeReceipt.count({ where }),
          this.prisma.financeReceipt.aggregate({
            where: originalWhere,
            _sum: { amountFen: true },
          }),
          this.prisma.financeReceipt.count({
            where: {
              AND: [originalWhere, { issuance: { is: null } }],
            },
          }),
          this.prisma.financeReceiptCorrection.aggregate({
            where: {
              status: 'APPLIED',
              originalIssuance: { receipt: originalWhere },
            },
            _sum: { originalAmountFen: true },
          }),
          this.prisma.financeReceipt.aggregate({
            where: replacementWhere,
            _sum: { amountFen: true },
          }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
    const amountFen = sum._sum.amountFen ?? 0;
    const correctionEffectFen =
      (replacements._sum.amountFen ?? 0) -
      (correctedOriginals._sum.originalAmountFen ?? 0);
    const netAmountFen = amountFen + correctionEffectFen;
    if (
      !Number.isSafeInteger(correctionEffectFen) ||
      !Number.isSafeInteger(netAmountFen)
    ) {
      this.conflict('Receipt correction totals exceed the supported range');
    }
    return {
      items: rows.map(receiptView),
      total,
      page: query.page,
      pageSize: query.pageSize,
      summary: {
        amountFen,
        correctionEffectFen,
        netAmountFen,
        unlinkedCount,
      },
    };
  }

  async exportReceipts(actor: AuthenticatedUser, query: FinanceQueryDto) {
    this.authorize(actor);
    const where = this.receiptWhere(query);
    const rows = await this.prisma.$transaction(
      async (tx) => {
        const total = await tx.financeReceipt.count({ where });
        if (total > 5000) {
          throw new DomainError(
            'VALIDATION_FAILED',
            '最多导出5000条，请缩小日期、校区或学员范围',
            400,
          );
        }
        return tx.financeReceipt.findMany({
          where,
          include: receiptInclude,
          orderBy: [
            { receivedOn: 'desc' },
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
        });
      },
      { isolationLevel: 'RepeatableRead', timeout: 30000 },
    );
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('收款明细');
    sheet.addRow([
      '学员姓名',
      '校区',
      '实际收款日期',
      '收款方式',
      '记录类型',
      '原始实际收款（元）',
      '纠错状态',
      '纠错影响（元）',
      '账面净影响（元）',
      '关联状态',
      '课包名称',
      '购买课时',
      '赠送课时',
      '购买课时单价（元）',
    ]);
    for (const receipt of rows) {
      const issuance = receipt.issuance;
      const correction = issuance?.corrections[0] ?? null;
      const replacement = receipt.replacementForCorrection !== null;
      const originalCashFen = replacement ? 0 : receipt.amountFen;
      const correctionEffectFen = replacement
        ? receipt.amountFen
        : correction?.status === 'APPLIED'
          ? -receipt.amountFen
          : 0;
      sheet.addRow([
        receipt.student.displayName,
        receipt.campus.name,
        receipt.receivedOn.toISOString().slice(0, 10),
        receiptChannelLabel(receipt.channel),
        replacement ? '账面替代记录' : '原始实际收款',
        originalCashFen / 100,
        replacement
          ? '已执行替代'
          : correction
            ? correctionStatusLabel(correction.status)
            : '无纠错',
        correctionEffectFen / 100,
        (originalCashFen + correctionEffectFen) / 100,
        issuance ? '已关联' : '待录包',
        issuance?.name ?? '',
        issuance ? issuance.initialMainUnits / 100 : '',
        issuance ? issuance.initialGiftUnits / 100 : '',
        issuance ? issuanceView(issuance).unitPriceFen / 100 : '',
      ]);
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { bold: true };
    for (const column of sheet.columns) column.width = 22;
    for (const index of [6, 8, 9, 12, 13, 14]) {
      sheet.getColumn(index).numFmt = '0.00';
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await this.prisma.auditLog.create({
      data: {
        campusId: null,
        actorUserId: actor.userId,
        action: 'FINANCE_RECEIPT_EXPORT',
        resourceType: 'FinanceReceipt',
        outcome: 'SUCCESS',
        details: {
          campusId: query.campusId ?? null,
          query: query.query?.trim() || null,
          from: query.from ?? null,
          to: query.to ?? null,
          status: query.status ?? null,
          count: rows.length,
        },
      },
    });
    return buffer;
  }

  private receiptWhere(query: FinanceQueryDto) {
    const from = query.from ? calendarDate(query.from) : undefined;
    const to = query.to ? calendarDate(query.to) : undefined;
    if (from && to && from > to) this.invalid('Invalid receipt date range');
    return {
      campusId: query.campusId,
      receivedOn: { gte: from, lte: to },
      student: {
        displayName: {
          contains: query.query?.trim() ?? '',
          mode: 'insensitive',
        },
      },
      ...(query.status
        ? {
            issuance:
              query.status === 'LINKED' ? { isNot: null } : { is: null },
          }
        : {}),
    } satisfies Prisma.FinanceReceiptWhereInput;
  }

  async detail(actor: AuthenticatedUser, receiptId: string) {
    this.authorize(actor);
    const receipt = await this.prisma.financeReceipt.findUnique({
      where: { id: receiptId },
      include: receiptInclude,
    });
    if (!receipt) this.notFound();
    return receiptView(receipt);
  }

  async create(
    actor: AuthenticatedUser,
    input: CreateFinanceReceiptDto,
    key: string,
  ) {
    this.authorize(actor);
    const receivedOn = calendarDate(input.receivedOn);
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    if (input.receivedOn > today)
      this.invalid('Receipt date cannot be in the future');
    const route = '/finance/receipts';
    return this.prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: input,
        campusId: null,
        actorUserId: actor.userId,
      });
      if (claim.replayed) return claim.responseBody;
      await tx.$queryRaw`SELECT "id" FROM "Student" WHERE "id" = ${input.studentId}::uuid FOR UPDATE`;
      const student = await tx.student.findFirst({
        where: {
          id: input.studentId,
          campusId: input.campusId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!student) this.invalid('Student is not active in this campus');
      await tx.$queryRaw`SELECT "id" FROM "StoredFile" WHERE "id" = ${input.proofFileId}::uuid FOR UPDATE`;
      const proof = await tx.storedFile.findFirst({
        where: {
          id: input.proofFileId,
          purpose: proofOptions.purpose,
          createdByUserId: actor.userId,
        },
        include: {
          financeReceipt: { select: { id: true } },
          financeCorrectionProposal: { select: { id: true } },
        },
      });
      if (!proof) this.invalid('An uploader-owned receipt proof is required');
      if (proof.financeReceipt || proof.financeCorrectionProposal)
        this.conflict('This proof is already linked to a receipt');
      const receipt = await tx.financeReceipt.create({
        data: {
          ...input,
          receivedOn,
          note: input.note?.trim() ?? '',
          createdByUserId: actor.userId,
        },
        include: receiptInclude,
      });
      await tx.auditLog.create({
        data: {
          campusId: input.campusId,
          actorUserId: actor.userId,
          action: 'FINANCE_RECEIPT_CREATE',
          resourceType: 'FinanceReceipt',
          resourceId: receipt.id,
          outcome: 'SUCCESS',
          details: {
            amountFen: input.amountFen,
            receivedOn: input.receivedOn,
            studentId: input.studentId,
          },
        },
      });
      const response = receiptView(receipt);
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: response,
        responseStatus: 201,
      });
      return response;
    });
  }

  async issue(
    actor: AuthenticatedUser,
    receiptId: string,
    input: IssueFinancePackageDto,
    key: string,
  ) {
    this.authorize(actor);
    if (!input.name.trim()) this.invalid('Package name cannot be blank');
    const validFrom = new Date(input.validFrom);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= validFrom)
      this.invalid('Expiry must be after validity start');
    const route = `/finance/receipts/${receiptId}/issue-package`;
    return this.prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: input,
        campusId: null,
        actorUserId: actor.userId,
      });
      if (claim.replayed) return claim.responseBody;
      await tx.$queryRaw`SELECT "id" FROM "FinanceReceipt" WHERE "id" = ${receiptId}::uuid FOR UPDATE`;
      const receipt = await tx.financeReceipt.findUnique({
        where: { id: receiptId },
        include: { issuance: true },
      });
      if (!receipt) this.notFound();
      if (receipt.issuance) this.conflict('This receipt already has a package');
      await tx.$queryRaw`SELECT "id" FROM "Student" WHERE "id" = ${receipt.studentId}::uuid FOR UPDATE`;
      const student = await tx.student.findFirst({
        where: {
          id: receipt.studentId,
          campusId: receipt.campusId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!student) this.invalid('Student is not active in the receipt campus');
      const coursePackage = await tx.coursePackage.create({
        data: {
          campusId: receipt.campusId,
          studentId: receipt.studentId,
          name: input.name.trim(),
          mainBalanceUnits: input.mainUnits,
          giftBalanceUnits: input.giftUnits,
          paidAmountFen: receipt.amountFen,
          validFrom,
          expiresAt,
        },
      });
      const issuance = await tx.financePackageIssuance.create({
        data: {
          receiptId,
          coursePackageId: coursePackage.id,
          originalAmountFen: receipt.amountFen,
          initialMainUnits: input.mainUnits,
          initialGiftUnits: input.giftUnits,
          name: input.name.trim(),
          validFrom,
          expiresAt,
          issuedByUserId: actor.userId,
        },
      });
      for (const [bucket, units] of [
        ['MAIN', input.mainUnits],
        ['GIFT', input.giftUnits],
      ] as const) {
        if (units === 0) continue;
        await tx.lessonLedgerEntry.create({
          data: {
            campusId: receipt.campusId,
            studentId: receipt.studentId,
            coursePackageId: coursePackage.id,
            entryType: 'GRANT',
            bucket,
            deltaUnits: units,
            balanceBeforeUnits: 0,
            balanceAfterUnits: units,
            idempotencyKey: `finance-issue:${receiptId}:${bucket}`,
            actorUserId: actor.userId,
            reason: `财务收款发包 ${receiptId}`,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          campusId: receipt.campusId,
          actorUserId: actor.userId,
          action: 'FINANCE_PACKAGE_ISSUE',
          resourceType: 'FinanceReceipt',
          resourceId: receiptId,
          outcome: 'SUCCESS',
          details: {
            coursePackageId: coursePackage.id,
            mainUnits: input.mainUnits,
            giftUnits: input.giftUnits,
          },
        },
      });
      const response = issuanceView(issuance);
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: response,
        responseStatus: 201,
      });
      return response;
    });
  }

  private invalid(message: string): never {
    throw new DomainError('BAD_REQUEST', message, 400);
  }
  private conflict(message: string): never {
    throw new DomainError('CONFLICT', message, 409);
  }
  private notFound(): never {
    throw new DomainError('RESOURCE_NOT_FOUND', 'Receipt not found', 404);
  }
}

export function calendarDate(value: string): Date {
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

function issuanceView(issuance: FinancePackageIssuance) {
  // Display rounding only. The immutable integer numerator/denominator remain authoritative.
  const numerator = BigInt(issuance.originalAmountFen) * 100n;
  const denominator = BigInt(issuance.initialMainUnits);
  const unitPriceFen = Number(
    (numerator * 2n + denominator) / (denominator * 2n),
  );
  return {
    id: issuance.id,
    coursePackageId: issuance.coursePackageId,
    originalAmountFen: issuance.originalAmountFen,
    initialMainUnits: issuance.initialMainUnits,
    initialGiftUnits: issuance.initialGiftUnits,
    name: issuance.name,
    validFrom: issuance.validFrom.toISOString(),
    expiresAt: issuance.expiresAt?.toISOString() ?? null,
    createdAt: issuance.createdAt.toISOString(),
    unitPriceFen,
  };
}

function receiptView(receipt: ReceiptRecord) {
  const correction = receipt.issuance?.corrections[0] ?? null;
  const replacementOfCorrectionId =
    receipt.replacementForCorrection?.id ?? null;
  return {
    id: receipt.id,
    campusId: receipt.campusId,
    campusName: receipt.campus.name,
    studentId: receipt.studentId,
    studentName: receipt.student.displayName,
    amountFen: receipt.amountFen,
    receivedOn: receipt.receivedOn.toISOString().slice(0, 10),
    channel: receipt.channel,
    note: receipt.note,
    createdAt: receipt.createdAt.toISOString(),
    status: receipt.issuance ? 'LINKED' : 'UNLINKED',
    recordKind: replacementOfCorrectionId ? 'REPLACEMENT' : 'ORIGINAL',
    replacementOfCorrectionId,
    correctionEffectFen: replacementOfCorrectionId
      ? receipt.amountFen
      : correction?.status === 'APPLIED'
        ? -receipt.amountFen
        : 0,
    correction: correction
      ? {
          id: correction.id,
          type: correction.type,
          status: correction.status,
          replacementReceiptId: correction.replacementReceiptId,
        }
      : null,
    issuance: receipt.issuance ? issuanceView(receipt.issuance) : null,
  };
}

function correctionStatusLabel(status: string) {
  const labels: Record<string, string> = {
    SUBMITTED: '待审核',
    APPROVED: '已批准待执行',
    APPLIED: '已执行',
  };
  return labels[status] ?? status;
}

function receiptChannelLabel(channel: string) {
  const labels: Record<string, string> = {
    WECHAT: '微信收款',
    ALIPAY: '支付宝',
    BANK: '银行转账',
    CASH: '现金',
    OTHER: '其他',
  };
  return labels[channel] ?? channel;
}
