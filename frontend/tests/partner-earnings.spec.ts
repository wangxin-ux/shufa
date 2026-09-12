import {
  ApiPartnerDataSource,
  PartnerHttpRequest,
} from '../data/api-partner-data-source';
import { MockPartnerDataSource } from '../data/mock-partner-data-source';
import {
  PARTNER_REPORT_PERIOD_OPTIONS,
  buildPartnerPeriodQuery,
  formatPartnerPeriodLabel,
} from '../services/partner-operations.presenter';
import {
  formatPartnerEarningMoney,
  formatPartnerShare,
  partnerEarningStatusLabel,
  presentPartnerEarningEntry,
} from '../services/partner-earnings.presenter';
import { PartnerService } from '../services/partner.service';
import { PartnerEarningEntry } from '../types/partner';

const entry: PartnerEarningEntry = {
  id: 'earning-1',
  campusId: 'campus-east',
  campusName: '启明东校区',
  teachingRecordId: 'teaching-1',
  lessonSessionId: 'lesson-1',
  courseName: '创意基础',
  lessonStartsAt: '2026-09-01T14:00:00+08:00',
  completedAt: '2026-09-01T15:30:00+08:00',
  entryType: 'ACCRUAL',
  amountFen: 4000,
  status: 'PENDING_REVIEW',
  unitPriceFen: 1000,
  shareBasisPoints: 4000,
  actualAttendeeCount: 10,
  countedAttendeeCount: 10,
  perAttendeeAmountFen: 400,
  reviewableAt: '2026-09-01T15:30:00+08:00',
  reviewedAt: null,
  reviewReason: null,
  createdAt: '2026-09-01T15:30:00+08:00',
  version: 1,
};

describe('partner earnings data and presentation', () => {
  it('formats integer money, ratios, statuses, and the video example', () => {
    expect(formatPartnerEarningMoney(4000)).toBe('¥40.00');
    expect(formatPartnerEarningMoney(-4000)).toBe('-¥40.00');
    expect(formatPartnerShare(4000)).toBe('40%');
    expect(partnerEarningStatusLabel('PENDING_REVIEW')).toBe('待审核');
    expect(partnerEarningStatusLabel('AVAILABLE')).toBe('可结算');
    expect(partnerEarningStatusLabel('REJECTED')).toBe('已驳回');
    expect(partnerEarningStatusLabel('REVERSED')).toBe('已冲正');
    expect(presentPartnerEarningEntry(entry)).toMatchObject({
      courseName: '创意基础',
      attendeeLabel: '10 人',
      unitPriceLabel: '¥10.00',
      shareLabel: '40%',
      perAttendeeLabel: '¥4.00',
      amountLabel: '¥40.00',
      statusLabel: '待审核',
    });
  });

  it('uses three partner-scoped GET routes without a campus query parameter', async () => {
    const requests: Parameters<PartnerHttpRequest>[0][] = [];
    const source = new ApiPartnerDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: 'partner-token',
      request: (options) => {
        requests.push(options);
        const isPage = options.url.includes('/earnings?');
        options.success({
          statusCode: 200,
          data: isPage
            ? {
                data: [entry],
                meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
              }
            : options.url.endsWith('/earning-rule')
              ? {
                  data: {
                    id: 'rule-1',
                    campusId: 'campus-east',
                    campusName: '启明东校区',
                    unitPriceFen: 1000,
                    shareBasisPoints: 4000,
                    eligibleLessonKinds: ['REGULAR'],
                    countedAttendanceStatuses: ['PRESENT'],
                    settlementDelayDays: 0,
                    version: 1,
                    status: 'ACTIVE',
                    effectiveFrom: '2026-09-01T00:00:00+08:00',
                    effectiveTo: null,
                    createdAt: '2026-09-01T00:00:00+08:00',
                  },
                }
              : {
                  data: {
                    estimatedTotalFen: 4000,
                    pendingReviewFen: 4000,
                    availableFen: 0,
                    reversedNetFen: 0,
                    currency: 'CNY',
                  },
                },
        });
      },
    });

    await source.getEarningSummary({
      period: 'MONTH',
      anchorDate: '2026-09-01',
    });
    await source.getCurrentEarningRule();
    await source.listEarnings({
      page: 1,
      pageSize: 20,
      status: 'PENDING_REVIEW',
      period: 'MONTH',
      anchorDate: '2026-09-01',
    });

    expect(requests.map(({ url }) => url)).toEqual([
      'https://example.test/api/partners/me/earnings/summary?period=MONTH&anchorDate=2026-09-01',
      'https://example.test/api/partners/me/earning-rule',
      'https://example.test/api/partners/me/earnings?page=1&pageSize=20&status=PENDING_REVIEW&period=MONTH&anchorDate=2026-09-01',
    ]);
    expect(requests.every(({ url }) => !url.includes('campusId'))).toBe(true);
  });

  it('offers day, month and quarter filters with Chinese period labels', () => {
    expect(PARTNER_REPORT_PERIOD_OPTIONS).toEqual([
      { value: 'DAY', label: '日' },
      { value: 'MONTH', label: '月' },
      { value: 'QUARTER', label: '季度' },
    ]);
    expect(buildPartnerPeriodQuery('QUARTER', '2026-09-01')).toEqual({
      period: 'QUARTER',
      anchorDate: '2026-09-01',
    });
    expect(formatPartnerPeriodLabel('DAY', '2026-09-01')).toBe('2026年9月1日');
    expect(formatPartnerPeriodLabel('MONTH', '2026-09-01')).toBe('2026年9月');
    expect(formatPartnerPeriodLabel('QUARTER', '2026-09-01')).toBe(
      '2026年第3季度',
    );
  });

  it('provides deterministic Chinese mock earnings and honest empty state', async () => {
    const service = new PartnerService(new MockPartnerDataSource());
    await expect(service.loadEarningSummary()).resolves.toMatchObject({
      status: 'success',
      data: { estimatedTotalFen: 4000, pendingReviewFen: 4000 },
    });
    await expect(
      service.loadEarnings({ page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({
      status: 'success',
      data: { data: [expect.objectContaining({ courseName: '创意基础' })] },
    });
    await expect(
      new PartnerService(
        new MockPartnerDataSource({ scenario: 'empty' }),
      ).loadEarnings({ page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({ status: 'empty' });
  });

  it('filters mock earning summary and rows by the selected campus period', async () => {
    const service = new PartnerService(new MockPartnerDataSource());
    await expect(
      service.loadEarningSummary({
        period: 'DAY',
        anchorDate: '2026-09-02',
      }),
    ).resolves.toMatchObject({
      status: 'success',
      data: {
        estimatedTotalFen: 0,
        pendingReviewFen: 0,
        availableFen: 0,
        reversedNetFen: 0,
      },
    });
    await expect(
      service.loadEarnings({
        page: 1,
        pageSize: 20,
        period: 'DAY',
        anchorDate: '2026-09-02',
      }),
    ).resolves.toMatchObject({ status: 'empty' });
    await expect(
      service.loadEarnings({
        page: 1,
        pageSize: 20,
        period: 'QUARTER',
        anchorDate: '2026-08-15',
      }),
    ).resolves.toMatchObject({
      status: 'success',
      data: { data: [expect.objectContaining({ id: 'partner-earning-east-1' })] },
    });
  });

  it('registers a strictly read-only partner earnings page and profile entry', () => {
    const root = path.resolve(__dirname, '..');
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')) as {
      subPackages: Array<{ root: string; pages: string[] }>;
    };
    const pages = app.subPackages.find(
      (item) => item.root === 'pages/partner',
    )?.pages;
    expect(pages).toContain('earnings/index');
    const markup = fs.readFileSync(
      path.join(root, 'pages/partner/earnings/index.wxml'),
      'utf8',
    );
    expect(markup).toContain('内部预计收益');
    expect(markup).toContain('可结算');
    expect(markup).toContain('periodOptions');
    expect(markup).toContain('bindchange="onAnchorDateChange"');
    expect(markup).not.toMatch(/提现|打款|审核通过|驳回|编辑规则|自动分账/);
  });

  it('uses a restrained business-workspace hierarchy for partner earnings', () => {
    const root = path.resolve(__dirname, '..');
    const markup = fs.readFileSync(
      path.join(root, 'pages/partner/earnings/index.wxml'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.join(root, 'pages/partner/earnings/index.wxss'),
      'utf8',
    );

    expect(markup).toContain('earnings-head__accent');
    expect(markup).toContain('earnings-summary__period');
    expect(styles).toContain('background: rgba(255, 252, 244, 0.94);');
    expect(styles).toContain('border-left: 7rpx solid var(--partner-orange);');
    expect(styles).toContain('font-size: 58rpx;');
    expect(styles).not.toContain('background: #fe8419;');
    expect(styles).not.toContain('font-size: 76rpx;');
  });
});
import * as fs from 'fs';
import * as path from 'path';
