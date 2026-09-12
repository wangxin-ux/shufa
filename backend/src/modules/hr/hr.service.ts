import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Workbook } from 'exceljs';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  HrDirectoryQueryDto,
  HrTeacherQueryDto,
  HrReportQueryDto,
} from './hr.dto';

const teacherSelect = {
  id: true,
  campusId: true,
  employeeCode: true,
  specialties: true,
  isActive: true,
  user: { select: { displayName: true, status: true } },
  campus: { select: { name: true } },
  _count: { select: { classGroups: { where: { status: 'ACTIVE' } } } },
} satisfies Prisma.TeacherProfileSelect;
type TeacherRow = Prisma.TeacherProfileGetPayload<{
  select: typeof teacherSelect;
}>;

@Injectable()
export class HrService {
  constructor(private readonly prisma: PrismaService) {}
  private authorize(actor: AuthenticatedUser) {
    if (
      actor.roles.length !== 1 ||
      actor.roles[0].code !== 'HR' ||
      actor.roles[0].campusId !== null
    ) {
      throw new DomainError(
        'FORBIDDEN',
        'A single headquarters HR identity is required',
        403,
      );
    }
  }
  async campuses(actor: AuthenticatedUser, query: HrDirectoryQueryDto) {
    this.authorize(actor);
    const where: Prisma.CampusWhereInput = query.query?.trim()
      ? { name: { contains: query.query.trim(), mode: 'insensitive' } }
      : {};
    const [items, total] = await this.prisma.$transaction(
      [
        this.prisma.campus.findMany({
          where,
          select: { id: true, name: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.campus.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
  async teachers(actor: AuthenticatedUser, query: HrTeacherQueryDto) {
    this.authorize(actor);
    const where: Prisma.TeacherProfileWhereInput = {
      campusId: query.campusId,
      user: query.query?.trim()
        ? { displayName: { contains: query.query.trim(), mode: 'insensitive' } }
        : undefined,
      ...(query.status === 'ACTIVE'
        ? { AND: [{ isActive: true }, { user: { status: 'ACTIVE' } }] }
        : {}),
      ...(query.status === 'INACTIVE'
        ? { OR: [{ isActive: false }, { user: { status: { not: 'ACTIVE' } } }] }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.teacherProfile.findMany({
          where,
          select: teacherSelect,
          orderBy: [{ user: { displayName: 'asc' } }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.teacherProfile.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      items: rows.map(teacherView),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async teacher(actor: AuthenticatedUser, id: string) {
    this.authorize(actor);
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.teacherProfile.findUnique({
          where: { id },
          select: { ...teacherSelect, createdAt: true },
        });
        if (!row)
          throw new DomainError(
            'RESOURCE_NOT_FOUND',
            'Teacher profile not found',
            404,
          );
        const completedLessonCount = await tx.teachingRecord.count({
          where: { teacherId: id, campusId: row.campusId, status: 'COMPLETED' },
        });
        return {
          ...teacherView(row),
          createdAt: row.createdAt.toISOString(),
          completedLessonCount,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async teachingReport(
    actor: AuthenticatedUser,
    query: HrReportQueryDto,
    transaction?: Prisma.TransactionClient,
  ) {
    this.authorize(actor);
    const where: Prisma.TeachingRecordWhereInput = {
      campusId: query.campusId,
      teacherId: query.teacherId,
      completedAt: reportPeriod(query),
    };
    const read = async (tx: Prisma.TransactionClient) => {
      const rows = await tx.teachingRecord.findMany({
        where,
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          teacherId: true,
          lessonSessionId: true,
          completedAt: true,
          status: true,
          attendeeCount: true,
          lessonUnits: true,
          teacher: { select: { user: { select: { displayName: true } } } },
          campus: { select: { name: true } },
          lessonSession: {
            select: { classGroup: { select: { courseName: true } } },
          },
        },
      });
      const total = await tx.teachingRecord.count({ where });
      const effective = { ...where, status: 'COMPLETED' as const };
      const totals = await tx.teachingRecord.aggregate({
        where: effective,
        _count: true,
        _sum: { attendeeCount: true, lessonUnits: true },
      });
      const consumption = await tx.lessonLedgerEntry.aggregate({
        where: {
          entryType: 'CONSUME',
          lessonSession: { teachingRecord: effective },
        },
        _sum: { deltaUnits: true },
      });
      const pageConsumption = await tx.lessonLedgerEntry.groupBy({
        by: ['lessonSessionId'],
        where: {
          entryType: 'CONSUME',
          lessonSessionId: {
            in: rows
              .filter((r) => r.status === 'COMPLETED')
              .map((r) => r.lessonSessionId),
          },
        },
        _sum: { deltaUnits: true },
      });
      const units = new Map(
        pageConsumption.map((r) => [
          r.lessonSessionId,
          -(r._sum.deltaUnits ?? 0),
        ]),
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          teacherId: r.teacherId,
          teacherName: r.teacher.user.displayName,
          campusName: r.campus.name,
          courseName: r.lessonSession.classGroup.courseName,
          completedAt: r.completedAt.toISOString(),
          status: r.status,
          attendeeCount: r.attendeeCount,
          lessonUnits: r.lessonUnits,
          consumedUnits: units.get(r.lessonSessionId) ?? 0,
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
        summary: {
          completedCount: totals._count,
          attendeeCount: totals._sum.attendeeCount ?? 0,
          lessonUnits: totals._sum.lessonUnits ?? 0,
          consumedUnits: -(consumption._sum.deltaUnits ?? 0) || 0,
        },
      };
    };
    return transaction
      ? read(transaction)
      : this.prisma.$transaction(read, { isolationLevel: 'RepeatableRead' });
  }

  async earningReport(
    actor: AuthenticatedUser,
    query: HrReportQueryDto,
    transaction?: Prisma.TransactionClient,
  ) {
    this.authorize(actor);
    const where: Prisma.TeacherEarningEntryWhereInput = {
      campusId: query.campusId,
      teacherProfileId: query.teacherId,
      earningBasis: { completedAt: reportPeriod(query) },
    };
    const read = async (tx: Prisma.TransactionClient) => {
      const rows = await tx.teacherEarningEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          teacherProfileId: true,
          amountFen: true,
          entryType: true,
          status: true,
          createdAt: true,
          teacher: { select: { user: { select: { displayName: true } } } },
          campus: { select: { name: true } },
          earningBasis: { select: { completedAt: true } },
          withdrawalAllocations: {
            where: {
              withdrawal: {
                status: { in: ['PAID', 'SUBMITTED', 'APPROVED', 'PAYING'] },
              },
            },
            select: {
              amountFen: true,
              withdrawal: { select: { status: true } },
            },
          },
        },
      });
      const total = await tx.teacherEarningEntry.count({ where });
      const sums = await tx.teacherEarningEntry.groupBy({
        by: ['status'],
        where,
        _sum: { amountFen: true },
      });
      const paid = await tx.withdrawalAllocation.aggregate({
        where: { earningEntry: where, withdrawal: { status: 'PAID' } },
        _sum: { amountFen: true },
      });
      const processing = await tx.withdrawalAllocation.aggregate({
        where: {
          earningEntry: where,
          withdrawal: { status: { in: ['SUBMITTED', 'APPROVED', 'PAYING'] } },
        },
        _sum: { amountFen: true },
      });
      const byStatus = new Map(
        sums.map((r) => [r.status, r._sum.amountFen ?? 0]),
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          teacherId: r.teacherProfileId,
          teacherName: r.teacher.user.displayName,
          campusName: r.campus.name,
          completedAt: r.earningBasis.completedAt.toISOString(),
          createdAt: r.createdAt.toISOString(),
          entryType: r.entryType,
          status: r.status,
          amountFen: r.amountFen,
          paidFen: r.withdrawalAllocations
            .filter((a) => a.withdrawal.status === 'PAID')
            .reduce((sum, a) => sum + a.amountFen, 0),
          processingFen: r.withdrawalAllocations
            .filter((a) => a.withdrawal.status !== 'PAID')
            .reduce((sum, a) => sum + a.amountFen, 0),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
        summary: {
          netFen: sums
            .filter((r) => r.status !== 'REJECTED')
            .reduce((sum, r) => sum + (r._sum.amountFen ?? 0), 0),
          pendingFen: byStatus.get('PENDING_REVIEW') ?? 0,
          approvedFen: byStatus.get('AVAILABLE') ?? 0,
          paidFen: paid._sum.amountFen ?? 0,
          processingFen: processing._sum.amountFen ?? 0,
        },
      };
    };
    return transaction
      ? read(transaction)
      : this.prisma.$transaction(read, { isolationLevel: 'RepeatableRead' });
  }

  async exportReport(
    actor: AuthenticatedUser,
    kind: string,
    query: HrReportQueryDto,
  ) {
    this.authorize(actor);
    if (kind !== 'teaching' && kind !== 'earnings') {
      throw new DomainError(
        'VALIDATION_FAILED',
        'Unsupported report kind',
        400,
      );
    }
    // One snapshot for all exported pages, including their current settlement state.
    const result = await this.prisma.$transaction(
      async (tx) => {
        const filter = { ...query, page: 1, pageSize: 5000 };
        const report =
          kind === 'teaching'
            ? await this.teachingReport(actor, filter, tx)
            : await this.earningReport(actor, filter, tx);
        if (report.total > 5000)
          throw new DomainError(
            'VALIDATION_FAILED',
            '最多导出5000条，请缩小日期或校区范围',
            400,
          );
        return report;
      },
      { isolationLevel: 'RepeatableRead', timeout: 30000 },
    );
    const workbook = new Workbook();
    const scope = workbook.addWorksheet('报表口径');
    scope.addRows([
      ['报表', kind === 'teaching' ? '授课统计' : '课时费'],
      ['开始日期', query.from || '不限'],
      ['结束日期', query.to || '不限'],
      ['日期口径', '授课完成日期，北京时间，含起止日'],
      ['教师范围', query.teacherId || '全部教师'],
      ['校区范围', query.campusId || '全部校区'],
      [
        '统计口径',
        kind === 'teaching'
          ? '汇总仅计当前有效授课；明细保留撤销课次'
          : '结算为所选授课记录当前状态，不是期间现金付款额',
      ],
      ['生成时间', shanghaiDate(new Date())],
    ]);
    if (kind === 'teaching') {
      const data = result as Awaited<ReturnType<HrService['teachingReport']>>;
      scope.addRows([
        ['有效课次', data.summary.completedCount],
        ['授课人次', data.summary.attendeeCount],
        ['授课课时', data.summary.lessonUnits / 100],
        ['学员课耗', data.summary.consumedUnits / 100],
      ]);
      const sheet = workbook.addWorksheet('授课明细');
      sheet.addRow([
        '教师',
        '校区',
        '课程',
        '完成时间',
        '状态',
        '授课课时',
        '到课人次',
        '有效课耗',
      ]);
      for (const row of data.items)
        sheet.addRow([
          row.teacherName,
          row.campusName,
          row.courseName,
          shanghaiDate(new Date(row.completedAt)),
          row.status === 'COMPLETED' ? '已完成' : '已撤销',
          row.lessonUnits / 100,
          row.attendeeCount,
          row.consumedUnits / 100,
        ]);
    } else {
      const data = result as Awaited<ReturnType<HrService['earningReport']>>;
      scope.addRows([
        ['课时费净额（元）', data.summary.netFen / 100],
        ['待审核（元）', data.summary.pendingFen / 100],
        ['已审核（元）', data.summary.approvedFen / 100],
        ['当前已付（元）', data.summary.paidFen / 100],
        ['提现处理中（元）', data.summary.processingFen / 100],
      ]);
      const sheet = workbook.addWorksheet('课时费明细');
      sheet.addRow([
        '教师',
        '校区',
        '授课完成时间',
        '入账时间',
        '类型',
        '审核状态',
        '金额（元）',
        '当前已付（元）',
        '处理中（元）',
      ]);
      const statuses = {
        PENDING_REVIEW: '待审核',
        AVAILABLE: '已审核',
        REJECTED: '已驳回',
        REVERSED: '已冲正',
      };
      for (const row of data.items)
        sheet.addRow([
          row.teacherName,
          row.campusName,
          shanghaiDate(new Date(row.completedAt)),
          shanghaiDate(new Date(row.createdAt)),
          row.entryType === 'ACCRUAL' ? '计提' : '冲正',
          statuses[row.status],
          row.amountFen / 100,
          row.paidFen / 100,
          row.processingFen / 100,
        ]);
      for (const index of [7, 8, 9]) sheet.getColumn(index).numFmt = '0.00';
    }
    for (const sheet of workbook.worksheets) {
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.getRow(1).font = { bold: true };
      for (const column of sheet.columns)
        column.width = sheet.name === '报表口径' ? 45 : 24;
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        action: 'HR_REPORT_EXPORT',
        resourceType: 'HR_REPORT',
        outcome: 'SUCCESS',
        details: {
          kind,
          from: query.from ?? null,
          to: query.to ?? null,
          campusId: query.campusId ?? null,
          teacherId: query.teacherId ?? null,
          count: result.total,
        },
      },
    });
    return buffer;
  }
}
function shanghaiDate(date: Date) {
  return new Date(date.getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}
function reportPeriod(query: HrReportQueryDto): Prisma.DateTimeFilter {
  const parse = (value: string) => {
    const date = new Date(`${value}T00:00:00+08:00`);
    if (
      !Number.isFinite(date.getTime()) ||
      new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10) !==
        value
    ) {
      throw new DomainError('VALIDATION_FAILED', 'Invalid report date', 400);
    }
    return date;
  };
  const from = query.from ? parse(query.from) : undefined;
  const to = query.to ? parse(query.to) : undefined;
  if (from && to && from > to)
    throw new DomainError(
      'VALIDATION_FAILED',
      'Invalid report date range',
      400,
    );
  return { gte: from, lt: to ? new Date(to.getTime() + 86400000) : undefined };
}
function teacherView(row: TeacherRow) {
  return {
    id: row.id,
    name: row.user.displayName,
    campusId: row.campusId,
    campusName: row.campus.name,
    employeeCode: row.employeeCode,
    specialties: row.specialties,
    active: row.isActive && row.user.status === 'ACTIVE',
    activeClassCount: row._count.classGroups,
  };
}
