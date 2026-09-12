import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Workbook } from 'exceljs';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StoredFileService } from '../file/stored-file.service';
import type {
  FinanceOverviewFiltersDto,
  FinanceOverviewQueryDto,
} from './finance-overview.dto';

const ROW_LIMIT = 5000;
const paymentProofOptions = {
  purpose: 'PAYMENT_PROOF',
  directory: 'payment-proofs',
  allowedMimeTypes: ['image/png', 'image/jpeg'],
  maxBytes: 10 * 1024 * 1024,
  invalidCode: 'PAYMENT_PROOF_INVALID',
  label: 'payment proof',
} as const;

type CampusInput = { id: string; name: string; address: string | null };
type PartnerInput = {
  campusId: string;
  entryType: 'ACCRUAL' | 'REVERSAL';
  amountFen: number;
  unitPriceFen: number;
  countedAttendeeCount: number;
};
type TeacherInput = {
  campusId: string;
  entryType: 'ACCRUAL' | 'REVERSAL';
  amountFen: number;
};
type RefundInput = { campusId: string; amountFen: number };

export function balanceAtCutoff(
  currentBalanceUnits: number,
  laterDeltas: number[],
) {
  return (
    currentBalanceUnits - laterDeltas.reduce((sum, value) => sum + value, 0)
  );
}

export function summarizeFinanceProfitability(
  campuses: CampusInput[],
  partnerEntries: PartnerInput[],
  teacherEntries: TeacherInput[],
  refunds: RefundInput[],
) {
  const rows = campuses.map((campus) => ({
    campusId: campus.id,
    campusName: campus.name,
    regionLabel: campus.address?.trim() || '地区未维护',
    grossLessonRevenueFen: 0,
    teacherEarningFen: 0,
    partnerEarningFen: 0,
    refundFen: 0,
    knownContributionFen: 0,
    feeFen: null as number | null,
    netProfitFen: null as number | null,
  }));
  const byCampus = new Map(rows.map((row) => [row.campusId, row]));
  for (const entry of partnerEntries) {
    const row = byCampus.get(entry.campusId);
    if (!row) continue;
    const sign = entry.entryType === 'REVERSAL' ? -1 : 1;
    row.grossLessonRevenueFen +=
      sign * entry.unitPriceFen * entry.countedAttendeeCount;
    row.partnerEarningFen += entry.amountFen;
  }
  for (const entry of teacherEntries) {
    const row = byCampus.get(entry.campusId);
    if (row) row.teacherEarningFen += entry.amountFen;
  }
  for (const refund of refunds) {
    const row = byCampus.get(refund.campusId);
    if (row) row.refundFen += refund.amountFen;
  }
  for (const row of rows) {
    row.knownContributionFen =
      row.grossLessonRevenueFen -
      row.teacherEarningFen -
      row.partnerEarningFen -
      row.refundFen;
  }
  const summary = rows.reduce(
    (sum, row) => ({
      grossLessonRevenueFen:
        sum.grossLessonRevenueFen + row.grossLessonRevenueFen,
      teacherEarningFen: sum.teacherEarningFen + row.teacherEarningFen,
      partnerEarningFen: sum.partnerEarningFen + row.partnerEarningFen,
      refundFen: sum.refundFen + row.refundFen,
      knownContributionFen: sum.knownContributionFen + row.knownContributionFen,
      feeFen: null as number | null,
      netProfitFen: null as number | null,
    }),
    {
      grossLessonRevenueFen: 0,
      teacherEarningFen: 0,
      partnerEarningFen: 0,
      refundFen: 0,
      knownContributionFen: 0,
      feeFen: null as number | null,
      netProfitFen: null as number | null,
    },
  );
  return { rows, summary, feeStatus: 'NOT_RECORDED' as const };
}

@Injectable()
export class FinanceOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: StoredFileService,
  ) {}

  async studentHours(actor: AuthenticatedUser, query: FinanceOverviewQueryDto) {
    this.authorize(actor);
    const range = dateRange(query);
    const cutoff = range.lt ?? shanghaiDayAfter(todayShanghai());
    const campusIds = parseCampusIds(query.campusIds);
    const where: Prisma.CoursePackageWhereInput = {
      ...(campusIds ? { campusId: { in: campusIds } } : {}),
      ...(query.keyword?.trim()
        ? {
            student: {
              displayName: {
                contains: query.keyword.trim(),
                mode: 'insensitive',
              },
            },
          }
        : {}),
      createdAt: { lt: cutoff },
    };
    const total = await this.prisma.coursePackage.count({ where });
    enforceLimit(total);
    const packages = await this.prisma.coursePackage.findMany({
      where,
      orderBy: [{ student: { displayName: 'asc' } }, { createdAt: 'asc' }],
      select: {
        id: true,
        campusId: true,
        name: true,
        validFrom: true,
        expiresAt: true,
        mainBalanceUnits: true,
        giftBalanceUnits: true,
        mainReservedUnits: true,
        giftReservedUnits: true,
        campus: { select: { name: true } },
        student: { select: { id: true, displayName: true } },
        financeIssuance: {
          select: { originalAmountFen: true, initialMainUnits: true },
        },
        sourceOrder: {
          select: { priceFenSnapshot: true, mainUnitsSnapshot: true },
        },
        lessonLedger: {
          where: {
            OR: [
              { entryType: 'CONSUME' },
              {
                entryType: 'REVERSAL',
                reversalOf: { is: { entryType: 'CONSUME' } },
              },
            ],
            lessonSession: { is: { completedAt: range } },
          },
          select: { bucket: true, deltaUnits: true },
        },
      },
    });
    const ids = packages.map((item) => item.id);
    const later = ids.length
      ? await this.prisma.lessonLedgerEntry.findMany({
          where: { coursePackageId: { in: ids }, createdAt: { gte: cutoff } },
          select: { coursePackageId: true, bucket: true, deltaUnits: true },
        })
      : [];
    const laterByPackage = new Map<
      string,
      { MAIN: number[]; GIFT: number[] }
    >();
    for (const entry of later) {
      const bucket = laterByPackage.get(entry.coursePackageId) ?? {
        MAIN: [],
        GIFT: [],
      };
      bucket[entry.bucket].push(entry.deltaUnits);
      laterByPackage.set(entry.coursePackageId, bucket);
    }
    const allItems = packages.map((item) => {
      const laterDeltas = laterByPackage.get(item.id) ?? { MAIN: [], GIFT: [] };
      const consumed = item.lessonLedger.reduce(
        (sum, entry) => {
          sum[entry.bucket] -= entry.deltaUnits;
          return sum;
        },
        { MAIN: 0, GIFT: 0 },
      );
      const original = item.financeIssuance
        ? {
            amountFen: item.financeIssuance.originalAmountFen,
            mainUnits: item.financeIssuance.initialMainUnits,
          }
        : item.sourceOrder
          ? {
              amountFen: item.sourceOrder.priceFenSnapshot,
              mainUnits: item.sourceOrder.mainUnitsSnapshot,
            }
          : null;
      const mainRemainingUnits = balanceAtCutoff(
        item.mainBalanceUnits,
        laterDeltas.MAIN,
      );
      const giftRemainingUnits = balanceAtCutoff(
        item.giftBalanceUnits,
        laterDeltas.GIFT,
      );
      return {
        id: item.id,
        campusId: item.campusId,
        campusName: item.campus.name,
        studentId: item.student.id,
        studentName: item.student.displayName,
        packageName: item.name,
        validFrom: item.validFrom.toISOString(),
        expiresAt: item.expiresAt?.toISOString() ?? null,
        consumedMainUnits: consumed.MAIN,
        consumedGiftUnits: consumed.GIFT,
        unitPriceFen:
          original && original.mainUnits > 0
            ? Math.round((original.amountFen * 100) / original.mainUnits)
            : null,
        priceStatus: original ? ('KNOWN' as const) : ('PENDING_CHECK' as const),
        mainRemainingUnits,
        giftRemainingUnits,
        totalRemainingUnits: mainRemainingUnits + giftRemainingUnits,
        mainReservedUnits: item.mainReservedUnits,
        giftReservedUnits: item.giftReservedUnits,
      };
    });
    const offset = (query.page - 1) * query.pageSize;
    return {
      items: allItems.slice(offset, offset + query.pageSize),
      total,
      page: query.page,
      pageSize: query.pageSize,
      asOf: new Date(cutoff.getTime() - 1).toISOString(),
      summary: {
        studentCount: new Set(allItems.map((item) => item.studentId)).size,
        consumedMainUnits: allItems.reduce(
          (sum, item) => sum + item.consumedMainUnits,
          0,
        ),
        consumedGiftUnits: allItems.reduce(
          (sum, item) => sum + item.consumedGiftUnits,
          0,
        ),
        remainingUnits: allItems.reduce(
          (sum, item) => sum + item.totalRemainingUnits,
          0,
        ),
      },
    };
  }

  async orders(actor: AuthenticatedUser, query: FinanceOverviewQueryDto) {
    this.authorize(actor);
    const range = dateRange(query);
    const campusIds = parseCampusIds(query.campusIds);
    const validStatuses = [
      'AWAITING_PROOF',
      'AWAITING_PAYMENT',
      'PENDING_REVIEW',
      'PAID',
      'REJECTED',
      'EFFECTIVE',
      'REFUNDING',
      'REFUNDED',
      'CANCELLED',
      'VOIDED',
    ];
    const status = validStatuses.includes(query.status ?? '')
      ? (query.status as Prisma.EnumEnrollmentOrderStatusFilter['equals'])
      : undefined;
    const where: Prisma.EnrollmentOrderWhereInput = {
      ...(campusIds ? { campusId: { in: campusIds } } : {}),
      ...(status ? { status } : {}),
      createdAt: range,
      ...(query.keyword?.trim()
        ? {
            OR: [
              {
                orderNo: {
                  contains: query.keyword.trim(),
                  mode: 'insensitive',
                },
              },
              {
                student: {
                  displayName: {
                    contains: query.keyword.trim(),
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.enrollmentOrder.count({ where }),
      this.prisma.enrollmentOrder.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          orderNo: true,
          productNameSnapshot: true,
          priceFenSnapshot: true,
          status: true,
          createdAt: true,
          reviewedAt: true,
          campus: { select: { id: true, name: true } },
          student: { select: { id: true, displayName: true } },
          paymentProofs: {
            orderBy: { attemptNo: 'desc' },
            take: 1,
            select: { id: true, submittedAt: true },
          },
          groupMember: { select: { id: true } },
        },
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        orderNo: row.orderNo,
        source: row.groupMember
          ? ('GROUP_BUYING' as const)
          : ('ENROLLMENT' as const),
        campusId: row.campus.id,
        campusName: row.campus.name,
        studentId: row.student.id,
        studentName: row.student.displayName,
        productName: row.productNameSnapshot,
        amountFen: row.priceFenSnapshot,
        status: row.status,
        proofAvailable: row.paymentProofs.length > 0,
        proofSubmittedAt:
          row.paymentProofs[0]?.submittedAt.toISOString() ?? null,
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async orderProof(actor: AuthenticatedUser, orderId: string) {
    this.authorize(actor);
    const order = await this.prisma.enrollmentOrder.findUnique({
      where: { id: orderId },
      select: {
        paymentProofs: {
          orderBy: { attemptNo: 'desc' },
          take: 1,
          select: { storedFileId: true },
        },
      },
    });
    const fileId = order?.paymentProofs[0]?.storedFileId;
    if (!fileId)
      throw new DomainError(
        'RESOURCE_NOT_FOUND',
        'Payment proof not found',
        404,
      );
    return this.files.readPrivateFile(fileId, paymentProofOptions);
  }

  async earnings(actor: AuthenticatedUser, query: FinanceOverviewFiltersDto) {
    this.authorize(actor);
    const facts = await this.profitabilityFacts(query, false);
    const report = summarizeFinanceProfitability(
      facts.campuses,
      facts.partnerEntries,
      facts.teacherEntries,
      [],
    );
    return {
      reportingTimeZone: 'Asia/Shanghai',
      rows: report.rows.map((row) => ({
        campusId: row.campusId,
        campusName: row.campusName,
        regionLabel: row.regionLabel,
        grossLessonRevenueFen: row.grossLessonRevenueFen,
        teacherEarningFen: row.teacherEarningFen,
        partnerEarningFen: row.partnerEarningFen,
        platformRetainedFen: row.grossLessonRevenueFen - row.partnerEarningFen,
        knownContributionFen:
          row.grossLessonRevenueFen -
          row.partnerEarningFen -
          row.teacherEarningFen,
      })),
      summary: {
        grossLessonRevenueFen: report.summary.grossLessonRevenueFen,
        teacherEarningFen: report.summary.teacherEarningFen,
        partnerEarningFen: report.summary.partnerEarningFen,
        platformRetainedFen:
          report.summary.grossLessonRevenueFen -
          report.summary.partnerEarningFen,
        knownContributionFen:
          report.summary.grossLessonRevenueFen -
          report.summary.partnerEarningFen -
          report.summary.teacherEarningFen,
      },
    };
  }

  async payouts(actor: AuthenticatedUser, query: FinanceOverviewQueryDto) {
    this.authorize(actor);
    const range = dateRange(query);
    const campusIds = parseCampusIds(query.campusIds);
    const commonCampus = campusIds ? { in: campusIds } : undefined;
    const includeParents =
      !query.category || ['ALL', 'PARENT_REFUND'].includes(query.category);
    const includeTeachers =
      !query.category || ['ALL', 'TEACHER_WITHDRAWAL'].includes(query.category);
    const [teacherRows, refundRows, groupRefundRows] = await Promise.all([
      includeTeachers
        ? this.prisma.withdrawal.findMany({
            where: { campusId: commonCampus, createdAt: range },
            select: {
              id: true,
              requestNo: true,
              amountFen: true,
              status: true,
              createdAt: true,
              paidAt: true,
              payoutProofFileId: true,
              campus: { select: { id: true, name: true } },
              teacher: { select: { user: { select: { displayName: true } } } },
            },
          })
        : [],
      includeParents
        ? this.prisma.financeRefundRequest.findMany({
            where: {
              createdAt: range,
              issuance: { receipt: { campusId: commonCampus } },
            },
            select: {
              id: true,
              amountFen: true,
              status: true,
              createdAt: true,
              payment: { select: { paidAt: true, proofFileId: true } },
              issuance: {
                select: {
                  receipt: {
                    select: {
                      campus: { select: { id: true, name: true } },
                      student: { select: { displayName: true } },
                    },
                  },
                },
              },
            },
          })
        : [],
      includeParents
        ? this.prisma.paymentTransaction.findMany({
            where: {
              type: 'REFUND',
              createdAt: range,
              enrollmentOrder: { campusId: commonCampus },
            },
            select: {
              id: true,
              outTradeNo: true,
              amountFen: true,
              status: true,
              createdAt: true,
              succeededAt: true,
              enrollmentOrder: {
                select: {
                  campus: { select: { id: true, name: true } },
                  student: { select: { displayName: true } },
                },
              },
            },
          })
        : [],
    ]);
    const items = [
      ...teacherRows.map((row) => ({
        id: `teacher:${row.id}`,
        category: 'TEACHER_WITHDRAWAL' as const,
        referenceNo: row.requestNo,
        campusId: row.campus.id,
        campusName: row.campus.name,
        subjectName: row.teacher.user.displayName,
        amountFen: row.amountFen,
        status: row.status,
        requestedAt: row.createdAt.toISOString(),
        paidAt: row.paidAt?.toISOString() ?? null,
        proofAvailable: !!row.payoutProofFileId,
      })),
      ...refundRows.map((row) => ({
        id: `finance-refund:${row.id}`,
        category: 'PARENT_REFUND' as const,
        referenceNo: row.id,
        campusId: row.issuance.receipt.campus.id,
        campusName: row.issuance.receipt.campus.name,
        subjectName: row.issuance.receipt.student.displayName,
        amountFen: row.amountFen,
        status: row.status,
        requestedAt: row.createdAt.toISOString(),
        paidAt: row.payment?.paidAt.toISOString() ?? null,
        proofAvailable: !!row.payment?.proofFileId,
      })),
      ...groupRefundRows.map((row) => ({
        id: `group-refund:${row.id}`,
        category: 'PARENT_REFUND' as const,
        referenceNo: row.outTradeNo,
        campusId: row.enrollmentOrder.campus.id,
        campusName: row.enrollmentOrder.campus.name,
        subjectName: row.enrollmentOrder.student.displayName,
        amountFen: row.amountFen,
        status: row.status,
        requestedAt: row.createdAt.toISOString(),
        paidAt: row.succeededAt?.toISOString() ?? null,
        proofAvailable: false,
      })),
    ].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    const filtered = query.status
      ? items.filter((item) => item.status === query.status)
      : items;
    enforceLimit(filtered.length);
    return {
      items: filtered.slice(
        (query.page - 1) * query.pageSize,
        query.page * query.pageSize,
      ),
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
      coverage: {
        parentRefunds: 'AVAILABLE' as const,
        teacherWithdrawals: 'AVAILABLE' as const,
        partnerPayouts: 'NOT_IMPLEMENTED' as const,
      },
    };
  }

  async cashFlow(actor: AuthenticatedUser, query: FinanceOverviewQueryDto) {
    this.authorize(actor);
    const all = await this.cashFlowItems(query);
    const pageItems = all.items.slice(
      (query.page - 1) * query.pageSize,
      query.page * query.pageSize,
    );
    return {
      ...all,
      items: pageItems,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async profitability(
    actor: AuthenticatedUser,
    query: FinanceOverviewFiltersDto,
  ) {
    this.authorize(actor);
    const facts = await this.profitabilityFacts(query, true);
    return {
      reportingTimeZone: 'Asia/Shanghai',
      ...summarizeFinanceProfitability(
        facts.campuses,
        facts.partnerEntries,
        facts.teacherEntries,
        facts.refunds,
      ),
    };
  }

  async export(
    actor: AuthenticatedUser,
    kind: 'cash-flow' | 'profitability',
    query: FinanceOverviewFiltersDto,
  ) {
    this.authorize(actor);
    const workbook = new Workbook();
    if (kind === 'cash-flow') {
      const result = await this.cashFlowItems(
        Object.assign({}, query, {
          page: 1,
          pageSize: 50,
        }),
      );
      const sheet = workbook.addWorksheet('资金流水');
      sheet.addRow([
        '方向',
        '类型',
        '校区',
        '对象',
        '金额（元）',
        '发生时间（北京时间）',
        '状态',
      ]);
      for (const row of result.items)
        sheet.addRow([
          row.direction === 'INFLOW' ? '收入' : '支出',
          row.type,
          row.campusName,
          row.subjectName,
          row.amountFen / 100,
          shanghaiLabel(row.occurredAt),
          row.status,
        ]);
    } else {
      const facts = await this.profitabilityFacts(query, true);
      const result = summarizeFinanceProfitability(
        facts.campuses,
        facts.partnerEntries,
        facts.teacherEntries,
        facts.refunds,
      );
      const sheet = workbook.addWorksheet('成本收益');
      sheet.addRow([
        '校区',
        '地区',
        '课耗营收（元）',
        '教师课时费（元）',
        '合作方收益（元）',
        '实际退费（元）',
        '已知贡献（元）',
        '手续费',
        '净收益',
      ]);
      for (const row of result.rows)
        sheet.addRow([
          row.campusName,
          row.regionLabel,
          row.grossLessonRevenueFen / 100,
          row.teacherEarningFen / 100,
          row.partnerEarningFen / 100,
          row.refundFen / 100,
          row.knownContributionFen / 100,
          '未记录',
          '待手续费事实',
        ]);
    }
    await this.prisma.auditLog.create({
      data: {
        campusId: null,
        actorUserId: actor.userId,
        action: 'FINANCE_OVERSIGHT_EXPORT',
        resourceType: 'FinanceOverview',
        outcome: 'SUCCESS',
        details: { kind, ...query },
      },
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private async cashFlowItems(query: FinanceOverviewQueryDto) {
    const range = dateRange(query);
    const campusIds = parseCampusIds(query.campusIds);
    const campus = campusIds ? { in: campusIds } : undefined;
    const [receipts, payments, refunds, withdrawals] = await Promise.all([
      this.prisma.financeReceipt.findMany({
        where: {
          campusId: campus,
          receivedOn: range,
          replacementForCorrection: { is: null },
        },
        select: {
          id: true,
          amountFen: true,
          receivedOn: true,
          channel: true,
          campus: { select: { id: true, name: true } },
          student: { select: { displayName: true } },
        },
      }),
      this.prisma.paymentTransaction.findMany({
        where: {
          status: 'SUCCEEDED',
          succeededAt: range,
          enrollmentOrder: { campusId: campus },
        },
        select: {
          id: true,
          type: true,
          provider: true,
          amountFen: true,
          succeededAt: true,
          enrollmentOrder: {
            select: {
              campus: { select: { id: true, name: true } },
              student: { select: { displayName: true } },
            },
          },
        },
      }),
      this.prisma.financeRefundPayment.findMany({
        where: {
          paidAt: range,
          refund: { issuance: { receipt: { campusId: campus } } },
        },
        select: {
          id: true,
          amountFen: true,
          paidAt: true,
          refund: {
            select: {
              issuance: {
                select: {
                  receipt: {
                    select: {
                      campus: { select: { id: true, name: true } },
                      student: { select: { displayName: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.withdrawal.findMany({
        where: { status: 'PAID', paidAt: range, campusId: campus },
        select: {
          id: true,
          amountFen: true,
          paidAt: true,
          campus: { select: { id: true, name: true } },
          teacher: { select: { user: { select: { displayName: true } } } },
        },
      }),
    ]);
    const items = [
      ...receipts.map((row) => ({
        id: `receipt:${row.id}`,
        direction: 'INFLOW' as const,
        type: `线下收款-${row.channel}`,
        campusId: row.campus.id,
        campusName: row.campus.name,
        subjectName: row.student.displayName,
        amountFen: row.amountFen,
        occurredAt: row.receivedOn.toISOString(),
        status: 'CONFIRMED',
      })),
      ...payments.map((row) => ({
        id: `payment:${row.id}`,
        direction:
          row.type === 'PAYMENT' ? ('INFLOW' as const) : ('OUTFLOW' as const),
        type: `${row.provider}-${row.type}`,
        campusId: row.enrollmentOrder.campus.id,
        campusName: row.enrollmentOrder.campus.name,
        subjectName: row.enrollmentOrder.student.displayName,
        amountFen: row.amountFen,
        occurredAt: row.succeededAt!.toISOString(),
        status: 'SUCCEEDED',
      })),
      ...refunds.map((row) => ({
        id: `refund:${row.id}`,
        direction: 'OUTFLOW' as const,
        type: '课包实际退费',
        campusId: row.refund.issuance.receipt.campus.id,
        campusName: row.refund.issuance.receipt.campus.name,
        subjectName: row.refund.issuance.receipt.student.displayName,
        amountFen: row.amountFen,
        occurredAt: row.paidAt.toISOString(),
        status: 'PAID',
      })),
      ...withdrawals.map((row) => ({
        id: `withdrawal:${row.id}`,
        direction: 'OUTFLOW' as const,
        type: '教师课时费提现',
        campusId: row.campus.id,
        campusName: row.campus.name,
        subjectName: row.teacher.user.displayName,
        amountFen: row.amountFen,
        occurredAt: row.paidAt!.toISOString(),
        status: 'PAID',
      })),
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    enforceLimit(items.length);
    return {
      items,
      total: items.length,
      summary: {
        inflowFen: items
          .filter((item) => item.direction === 'INFLOW')
          .reduce((sum, item) => sum + item.amountFen, 0),
        outflowFen: items
          .filter((item) => item.direction === 'OUTFLOW')
          .reduce((sum, item) => sum + item.amountFen, 0),
        feeFen: null as number | null,
      },
      feeStatus: 'NOT_RECORDED' as const,
    };
  }

  private async profitabilityFacts(
    query: FinanceOverviewFiltersDto,
    includeRefunds: boolean,
  ) {
    const range = dateRange(query);
    const campusIds = parseCampusIds(query.campusIds);
    const campusWhere: Prisma.CampusWhereInput = {
      ...(campusIds ? { id: { in: campusIds } } : {}),
      ...(query.region?.trim()
        ? { address: { contains: query.region.trim(), mode: 'insensitive' } }
        : {}),
    };
    const campuses = await this.prisma.campus.findMany({
      where: campusWhere,
      orderBy: { code: 'asc' },
      select: { id: true, name: true, address: true },
    });
    const ids = campuses.map((campus) => campus.id);
    const [partnerRows, teacherRows, refundRows, groupRefundRows] =
      await Promise.all([
        this.prisma.partnerEarningEntry.findMany({
          where: {
            campusId: { in: ids },
            status: { not: 'REJECTED' },
            createdAt: range,
          },
          select: {
            campusId: true,
            entryType: true,
            amountFen: true,
            ruleSnapshot: true,
            earningBasis: { select: { countedAttendeeCount: true } },
          },
        }),
        this.prisma.teacherEarningEntry.findMany({
          where: {
            campusId: { in: ids },
            status: { not: 'REJECTED' },
            createdAt: range,
          },
          select: { campusId: true, entryType: true, amountFen: true },
        }),
        includeRefunds
          ? this.prisma.financeRefundPayment.findMany({
              where: {
                paidAt: range,
                refund: { issuance: { receipt: { campusId: { in: ids } } } },
              },
              select: {
                amountFen: true,
                refund: {
                  select: {
                    issuance: {
                      select: { receipt: { select: { campusId: true } } },
                    },
                  },
                },
              },
            })
          : [],
        includeRefunds
          ? this.prisma.paymentTransaction.findMany({
              where: {
                type: 'REFUND',
                status: 'SUCCEEDED',
                succeededAt: range,
                enrollmentOrder: { campusId: { in: ids } },
              },
              select: {
                amountFen: true,
                enrollmentOrder: { select: { campusId: true } },
              },
            })
          : [],
      ]);
    return {
      campuses,
      partnerEntries: partnerRows.map((row) => ({
        campusId: row.campusId,
        entryType: row.entryType,
        amountFen: row.amountFen,
        unitPriceFen: snapshotInteger(row.ruleSnapshot, 'unitPriceFen'),
        countedAttendeeCount: row.earningBasis.countedAttendeeCount,
      })),
      teacherEntries: teacherRows,
      refunds: [
        ...refundRows.map((row) => ({
          campusId: row.refund.issuance.receipt.campusId,
          amountFen: row.amountFen,
        })),
        ...groupRefundRows.map((row) => ({
          campusId: row.enrollmentOrder.campusId,
          amountFen: row.amountFen,
        })),
      ],
    };
  }

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
}

type DateRange = { gte?: Date; lt?: Date };

function dateRange(query: FinanceOverviewFiltersDto): DateRange {
  const gte = query.from ? shanghaiDate(query.from) : undefined;
  const lt = query.to ? shanghaiDayAfter(query.to) : undefined;
  if (gte && lt && gte >= lt)
    throw new DomainError('BAD_REQUEST', 'Invalid report date range', 400);
  return { gte, lt };
}

function shanghaiDate(value: string) {
  const result = new Date(`${value}T00:00:00+08:00`);
  if (
    !Number.isFinite(result.getTime()) ||
    new Date(result.getTime() + 8 * 3600000).toISOString().slice(0, 10) !==
      value
  )
    throw new DomainError('BAD_REQUEST', 'Invalid calendar date', 400);
  return result;
}

function shanghaiDayAfter(value: string) {
  return new Date(shanghaiDate(value).getTime() + 24 * 60 * 60 * 1000);
}

function todayShanghai() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

function parseCampusIds(value?: string) {
  return value ? value.split(',') : undefined;
}

function enforceLimit(total: number) {
  if (total > ROW_LIMIT)
    throw new DomainError(
      'VALIDATION_FAILED',
      '最多查询或导出5000条，请缩小范围',
      400,
    );
}

function snapshotInteger(value: Prisma.JsonValue, field: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const item = (value as Record<string, Prisma.JsonValue>)[field];
  return typeof item === 'number' && Number.isSafeInteger(item) ? item : 0;
}

function shanghaiLabel(value: string) {
  return new Date(new Date(value).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');
}
