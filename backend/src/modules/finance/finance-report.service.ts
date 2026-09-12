import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Workbook } from 'exceljs';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  allocateLessonConsumptionAmounts,
  type FinanceAllocationInput,
} from './finance-report-allocation';
import type {
  FinanceReportExportQueryDto,
  FinanceReportFiltersDto,
  FinanceReportKind,
} from './finance-report.dto';
import { FinanceReportQueryDto } from './finance-report.dto';

const REPORT_ROW_LIMIT = 5000;
const consumptionSelect = {
  id: true,
  campusId: true,
  coursePackageId: true,
  entryType: true,
  bucket: true,
  deltaUnits: true,
  reversalOfId: true,
  campus: { select: { name: true } },
  student: { select: { displayName: true } },
  coursePackage: { select: { name: true } },
  lessonSession: {
    select: {
      completedAt: true,
      classGroup: { select: { courseName: true } },
    },
  },
} satisfies Prisma.LessonLedgerEntrySelect;
type ConsumptionRecord = Prisma.LessonLedgerEntryGetPayload<{
  select: typeof consumptionSelect;
}>;

const allocationSelect = {
  id: true,
  coursePackageId: true,
  entryType: true,
  bucket: true,
  deltaUnits: true,
  reversalOfId: true,
  createdAt: true,
  coursePackage: {
    select: {
      financeIssuance: {
        select: { originalAmountFen: true, initialMainUnits: true },
      },
    },
  },
} satisfies Prisma.LessonLedgerEntrySelect;

const paidRefundSelect = {
  id: true,
  mainUnits: true,
  giftUnits: true,
  payment: { select: { paidAt: true, amountFen: true } },
  issuance: {
    select: {
      name: true,
      receipt: {
        select: {
          campusId: true,
          campus: { select: { name: true } },
          student: { select: { displayName: true } },
        },
      },
    },
  },
} satisfies Prisma.FinanceRefundRequestSelect;
type PaidRefundRecord = Prisma.FinanceRefundRequestGetPayload<{
  select: typeof paidRefundSelect;
}>;

type ConsumptionView = ReturnType<typeof consumptionView>;
type PaidRefundView = ReturnType<typeof paidRefundView>;

@Injectable()
export class FinanceReportService {
  constructor(private readonly prisma: PrismaService) {}

  lessonConsumption(actor: AuthenticatedUser, query: FinanceReportQueryDto) {
    this.authorize(actor);
    const range = reportRange(query);
    return this.prisma.$transaction(
      (tx) => this.loadConsumption(tx, query, range),
      { isolationLevel: 'RepeatableRead', timeout: 30000 },
    );
  }

  refunds(actor: AuthenticatedUser, query: FinanceReportQueryDto) {
    this.authorize(actor);
    const range = reportRange(query);
    return this.prisma.$transaction(
      (tx) => this.loadRefunds(tx, query, range),
      { isolationLevel: 'RepeatableRead', timeout: 30000 },
    );
  }

  async export(
    actor: AuthenticatedUser,
    kind: FinanceReportKind,
    query: FinanceReportExportQueryDto,
  ) {
    this.authorize(actor);
    const range = reportRange(query);
    const listQuery = Object.assign(new FinanceReportQueryDto(), query, {
      page: 1,
      pageSize: 50,
    });
    let buffer: Buffer;
    let count: number;
    if (kind === 'lesson-consumption') {
      const report = await this.prisma.$transaction(
        (tx) => this.loadConsumption(tx, listQuery, range, true),
        { isolationLevel: 'RepeatableRead', timeout: 30000 },
      );
      buffer = await consumptionWorkbook(report, query);
      count = report.total;
    } else {
      const report = await this.prisma.$transaction(
        (tx) => this.loadRefunds(tx, listQuery, range, true),
        { isolationLevel: 'RepeatableRead', timeout: 30000 },
      );
      buffer = await refundWorkbook(report, query);
      count = report.total;
    }
    await this.prisma.auditLog.create({
      data: {
        campusId: null,
        actorUserId: actor.userId,
        action: 'FINANCE_REPORT_EXPORT',
        resourceType: 'FinanceReport',
        outcome: 'SUCCESS',
        details: {
          kind,
          campusId: query.campusId ?? null,
          from: query.from ?? null,
          to: query.to ?? null,
          count,
        },
      },
    });
    return buffer;
  }

  private async loadConsumption(
    tx: Prisma.TransactionClient,
    query: FinanceReportQueryDto,
    range: DateRange,
    exporting = false,
  ): Promise<ConsumptionReport> {
    const where = consumptionWhere(query, range);
    const total = await tx.lessonLedgerEntry.count({ where });
    enforceReportLimit(total, exporting);
    const filtered = await tx.lessonLedgerEntry.findMany({
      where,
      select: consumptionSelect,
      orderBy: [{ lessonSession: { completedAt: 'desc' } }, { id: 'desc' }],
    });
    const packageIds = [...new Set(filtered.map((row) => row.coursePackageId))];
    const history =
      packageIds.length === 0
        ? []
        : await tx.lessonLedgerEntry.findMany({
            where: {
              coursePackageId: { in: packageIds },
              OR: [
                { entryType: 'CONSUME' },
                {
                  entryType: 'REVERSAL',
                  reversalOf: { is: { entryType: 'CONSUME' } },
                },
              ],
            },
            select: allocationSelect,
            orderBy: [
              { coursePackageId: 'asc' },
              { createdAt: 'asc' },
              { id: 'asc' },
            ],
          });
    const allocation = allocateLessonConsumptionAmounts(
      history.map((row): FinanceAllocationInput => ({
        id: row.id,
        coursePackageId: row.coursePackageId,
        entryType: row.entryType as 'CONSUME' | 'REVERSAL',
        bucket: row.bucket,
        deltaUnits: row.deltaUnits,
        reversalOfId: row.reversalOfId,
        createdAt: row.createdAt,
        issuance: row.coursePackage.financeIssuance,
      })),
    );
    const allItems = filtered.map((row) =>
      consumptionView(row, allocation.get(row.id)),
    );
    const summary = allItems.reduce(
      (value, item) => ({
        mainUnits: value.mainUnits + (item.bucket === 'MAIN' ? item.units : 0),
        giftUnits: value.giftUnits + (item.bucket === 'GIFT' ? item.units : 0),
        knownAmountFen: value.knownAmountFen + (item.amountFen ?? 0),
        pendingCheckCount:
          value.pendingCheckCount +
          (item.amountStatus === 'PENDING_CHECK' ? 1 : 0),
      }),
      { mainUnits: 0, giftUnits: 0, knownAmountFen: 0, pendingCheckCount: 0 },
    );
    return page(allItems, total, query, summary, exporting);
  }

  private async loadRefunds(
    tx: Prisma.TransactionClient,
    query: FinanceReportQueryDto,
    range: DateRange,
    exporting = false,
  ): Promise<RefundReport> {
    const where = refundWhere(query, range);
    const total = await tx.financeRefundRequest.count({ where });
    enforceReportLimit(total, exporting);
    const rows = await tx.financeRefundRequest.findMany({
      where,
      select: paidRefundSelect,
      orderBy: [{ payment: { paidAt: 'desc' } }, { id: 'desc' }],
    });
    const allItems = rows.map(paidRefundView);
    const summary = allItems.reduce(
      (value, item) => ({
        actualRefundFen: value.actualRefundFen + item.amountFen,
        mainUnits: value.mainUnits + item.mainUnits,
        giftUnits: value.giftUnits + item.giftUnits,
      }),
      { actualRefundFen: 0, mainUnits: 0, giftUnits: 0 },
    );
    return page(allItems, total, query, summary, exporting);
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
type ConsumptionReport = {
  items: ConsumptionView[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    mainUnits: number;
    giftUnits: number;
    knownAmountFen: number;
    pendingCheckCount: number;
  };
};
type RefundReport = {
  items: PaidRefundView[];
  total: number;
  page: number;
  pageSize: number;
  summary: { actualRefundFen: number; mainUnits: number; giftUnits: number };
};

function reportRange(query: FinanceReportFiltersDto): DateRange {
  const from = query.from ? shanghaiDate(query.from) : undefined;
  const to = query.to ? shanghaiDate(query.to) : undefined;
  if (from && to && from > to) {
    throw new DomainError('BAD_REQUEST', 'Invalid report date range', 400);
  }
  return {
    gte: from,
    lt: to ? new Date(to.getTime() + 24 * 60 * 60 * 1000) : undefined,
  };
}

function shanghaiDate(value: string): Date {
  const date = new Date(`${value}T00:00:00+08:00`);
  if (
    !Number.isFinite(date.getTime()) ||
    new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10) !== value
  ) {
    throw new DomainError('BAD_REQUEST', 'Invalid calendar date', 400);
  }
  return date;
}

function consumptionWhere(
  query: FinanceReportFiltersDto,
  range: DateRange,
): Prisma.LessonLedgerEntryWhereInput {
  return {
    campusId: query.campusId,
    OR: [
      { entryType: 'CONSUME' },
      { entryType: 'REVERSAL', reversalOf: { is: { entryType: 'CONSUME' } } },
    ],
    lessonSession: { is: { completedAt: range } },
  };
}

function refundWhere(
  query: FinanceReportFiltersDto,
  range: DateRange,
): Prisma.FinanceRefundRequestWhereInput {
  return {
    status: 'PAID',
    issuance: { receipt: { campusId: query.campusId } },
    payment: { is: { paidAt: range } },
  };
}

function consumptionView(
  record: ConsumptionRecord,
  allocation?: {
    amountFen: number | null;
    amountStatus: 'KNOWN' | 'PENDING_CHECK';
  },
) {
  if (!record.lessonSession?.completedAt)
    throw new Error('Filtered lesson ledger entry has no completion time');
  return {
    id: record.id,
    entryType: record.entryType as 'CONSUME' | 'REVERSAL',
    campusId: record.campusId,
    campusName: record.campus.name,
    studentName: record.student.displayName,
    packageName: record.coursePackage.name,
    courseName: record.lessonSession.classGroup.courseName,
    lessonCompletedAt: record.lessonSession.completedAt.toISOString(),
    bucket: record.bucket,
    units: -record.deltaUnits,
    amountFen: allocation?.amountFen ?? null,
    amountStatus: allocation?.amountStatus ?? ('PENDING_CHECK' as const),
  };
}

function paidRefundView(record: PaidRefundRecord) {
  if (!record.payment) throw new Error('PAID refund has no payment fact');
  return {
    id: record.id,
    campusId: record.issuance.receipt.campusId,
    campusName: record.issuance.receipt.campus.name,
    studentName: record.issuance.receipt.student.displayName,
    packageName: record.issuance.name,
    paidAt: record.payment.paidAt.toISOString(),
    amountFen: record.payment.amountFen,
    mainUnits: record.mainUnits,
    giftUnits: record.giftUnits,
  };
}

function page<T, S>(
  items: T[],
  total: number,
  query: FinanceReportQueryDto,
  summary: S,
  exporting: boolean,
) {
  return {
    items: exporting
      ? items
      : items.slice(
          (query.page - 1) * query.pageSize,
          query.page * query.pageSize,
        ),
    total,
    page: query.page,
    pageSize: query.pageSize,
    summary,
  };
}

function enforceReportLimit(total: number, exporting: boolean) {
  if (total > REPORT_ROW_LIMIT) {
    throw new DomainError(
      'VALIDATION_FAILED',
      exporting
        ? '最多导出5000条，请缩小日期或校区范围'
        : '最多查询5000条，请缩小日期或校区范围',
      400,
    );
  }
}

async function consumptionWorkbook(
  report: ConsumptionReport,
  query: FinanceReportFiltersDto,
) {
  const workbook = workbookWithScope('课耗报表', query, report.total, [
    ['购买课时', report.summary.mainUnits / 100],
    ['赠送课时', report.summary.giftUnits / 100],
    ['已核算课耗金额（元）', report.summary.knownAmountFen / 100],
    ['待核对笔数', report.summary.pendingCheckCount],
  ]);
  const sheet = workbook.addWorksheet('课耗明细');
  sheet.addRow([
    '类型',
    '学员姓名',
    '校区',
    '课包',
    '课程',
    '课次完成时间（北京时间）',
    '课时类型',
    '课时数量（节）',
    '课耗金额（元）',
    '金额状态',
  ]);
  for (const item of report.items)
    sheet.addRow([
      item.entryType === 'CONSUME' ? '扣课' : '撤销',
      item.studentName,
      item.campusName,
      item.packageName,
      item.courseName,
      shanghaiTimestamp(item.lessonCompletedAt),
      item.bucket === 'MAIN' ? '购买课时' : '赠送课时',
      item.units / 100,
      item.amountFen === null ? '待核对' : item.amountFen / 100,
      item.amountStatus === 'KNOWN' ? '已核算' : '待核对',
    ]);
  formatSheet(sheet, [8, 9]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function refundWorkbook(
  report: RefundReport,
  query: FinanceReportFiltersDto,
) {
  const workbook = workbookWithScope('实际退费报表', query, report.total, [
    ['实际退款（元）', report.summary.actualRefundFen / 100],
    ['退回购买课时', report.summary.mainUnits / 100],
    ['退回赠送课时', report.summary.giftUnits / 100],
  ]);
  const sheet = workbook.addWorksheet('实际退费明细');
  sheet.addRow([
    '学员姓名',
    '校区',
    '课包',
    '实际退款时间（北京时间）',
    '实际退款金额（元）',
    '退回购买课时',
    '退回赠送课时',
  ]);
  for (const item of report.items)
    sheet.addRow([
      item.studentName,
      item.campusName,
      item.packageName,
      shanghaiTimestamp(item.paidAt),
      item.amountFen / 100,
      item.mainUnits / 100,
      item.giftUnits / 100,
    ]);
  formatSheet(sheet, [5, 6, 7]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function workbookWithScope(
  title: string,
  query: FinanceReportFiltersDto,
  total: number,
  summary: Array<[string, string | number]>,
) {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('报表概览');
  sheet.addRows([
    ['报表', title],
    ['开始日期', query.from ?? '不限'],
    ['结束日期', query.to ?? '不限'],
    ['校区筛选ID', query.campusId ?? '全部校区'],
    ['明细笔数', total],
    ...summary,
  ]);
  sheet.getColumn(1).font = { bold: true };
  sheet.columns.forEach((column) => {
    column.width = 24;
  });
  return workbook;
}

function formatSheet(
  sheet: ReturnType<Workbook['addWorksheet']>,
  numericColumns: number[],
) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column) => {
    column.width = 24;
  });
  numericColumns.forEach((column) => {
    sheet.getColumn(column).numFmt = '0.00';
  });
}

function shanghaiTimestamp(value: string) {
  return new Date(new Date(value).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}
