import {
  balanceAtCutoff,
  FinanceOverviewService,
  summarizeFinanceProfitability,
} from './finance-overview.service';

describe('finance overview calculations', () => {
  it('rewinds every later ledger delta to the requested cutoff balance', () => {
    expect(balanceAtCutoff(740, [-100, 40, -20])).toBe(820);
  });

  it('keeps revenue and both earning costs separate by campus', () => {
    const report = summarizeFinanceProfitability(
      [
        { id: 'campus-a', name: '甲校区', address: '长沙市岳麓区' },
        { id: 'campus-b', name: '乙校区', address: null },
      ],
      [
        {
          campusId: 'campus-a',
          entryType: 'ACCRUAL',
          amountFen: 400,
          unitPriceFen: 1000,
          countedAttendeeCount: 1,
        },
        {
          campusId: 'campus-a',
          entryType: 'REVERSAL',
          amountFen: -400,
          unitPriceFen: 1000,
          countedAttendeeCount: 1,
        },
      ],
      [
        { campusId: 'campus-a', entryType: 'ACCRUAL', amountFen: 300 },
        { campusId: 'campus-a', entryType: 'REVERSAL', amountFen: -300 },
      ],
      [{ campusId: 'campus-a', amountFen: 200 }],
    );

    expect(report.rows).toEqual([
      {
        campusId: 'campus-a',
        campusName: '甲校区',
        regionLabel: '长沙市岳麓区',
        grossLessonRevenueFen: 0,
        teacherEarningFen: 0,
        partnerEarningFen: 0,
        refundFen: 200,
        knownContributionFen: -200,
        feeFen: null,
        netProfitFen: null,
      },
      {
        campusId: 'campus-b',
        campusName: '乙校区',
        regionLabel: '地区未维护',
        grossLessonRevenueFen: 0,
        teacherEarningFen: 0,
        partnerEarningFen: 0,
        refundFen: 0,
        knownContributionFen: 0,
        feeFen: null,
        netProfitFen: null,
      },
    ]);
    expect(report.summary).toEqual({
      grossLessonRevenueFen: 0,
      teacherEarningFen: 0,
      partnerEarningFen: 0,
      refundFen: 200,
      knownContributionFen: -200,
      feeFen: null,
      netProfitFen: null,
    });
    expect(report.feeStatus).toBe('NOT_RECORDED');
  });
});

describe('finance student hours overview', () => {
  it('summarizes the full filtered result while returning one requested page', async () => {
    const packages = [
      {
        id: 'package-a',
        campusId: 'campus-a',
        name: '甲课包',
        validFrom: new Date('2026-08-31T16:00:00.000Z'),
        expiresAt: new Date('2027-08-31T15:59:59.999Z'),
        mainBalanceUnits: 300,
        giftBalanceUnits: 100,
        mainReservedUnits: 0,
        giftReservedUnits: 0,
        campus: { name: '甲校区' },
        student: { id: 'student-a', displayName: '甲同学' },
        financeIssuance: { originalAmountFen: 30000, initialMainUnits: 300 },
        sourceOrder: null,
        lessonLedger: [
          { bucket: 'MAIN', deltaUnits: -100 },
          { bucket: 'GIFT', deltaUnits: -100 },
        ],
      },
      {
        id: 'package-b',
        campusId: 'campus-b',
        name: '乙课包',
        validFrom: new Date('2026-08-31T16:00:00.000Z'),
        expiresAt: null,
        mainBalanceUnits: 200,
        giftBalanceUnits: 0,
        mainReservedUnits: 0,
        giftReservedUnits: 0,
        campus: { name: '乙校区' },
        student: { id: 'student-b', displayName: '乙同学' },
        financeIssuance: { originalAmountFen: 20000, initialMainUnits: 200 },
        sourceOrder: null,
        lessonLedger: [{ bucket: 'MAIN', deltaUnits: -200 }],
      },
    ];
    const coursePackageFindMany = jest.fn(
      (args: {
        skip?: number;
        take?: number;
        select?: { validFrom?: boolean; expiresAt?: boolean };
      }) => {
        if (args.take === undefined) return packages;
        return packages.slice(args.skip ?? 0, (args.skip ?? 0) + args.take);
      },
    );
    const prisma = {
      coursePackage: {
        count: jest.fn().mockResolvedValue(packages.length),
        findMany: coursePackageFindMany,
      },
      lessonLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new FinanceOverviewService(prisma as never, {} as never);

    const result = await service.studentHours(
      {
        userId: 'finance-user',
        roles: [{ code: 'FINANCE', campusId: null }],
      },
      { page: 1, pageSize: 1 },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      validFrom: '2026-08-31T16:00:00.000Z',
      expiresAt: '2027-08-31T15:59:59.999Z',
    });
    expect(coursePackageFindMany.mock.calls[0]?.[0].select).toMatchObject({
      validFrom: true,
      expiresAt: true,
    });
    expect(result.total).toBe(2);
    expect(result.summary).toEqual({
      studentCount: 2,
      consumedMainUnits: 300,
      consumedGiftUnits: 100,
      remainingUnits: 600,
    });
  });
});
