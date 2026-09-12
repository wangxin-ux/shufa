import {
  ApiSuperAdminDataSource,
  SuperAdminHttpRequest,
} from '../data/api-super-admin-data-source';
import { MockSuperAdminDataSource } from '../data/mock-super-admin-data-source';
import {
  formatSuperAdminPartnerMoney,
  formatSuperAdminPartnerShare,
  presentSuperAdminPartnerEarning,
} from '../services/super-admin-partner-earnings.presenter';
import { SuperAdminDataSource } from '../data/super-admin-data-source';

describe('super admin partner earning management', () => {
  it('formats rule and review values without calculating business totals', () => {
    expect(formatSuperAdminPartnerMoney(4000)).toBe('¥40.00');
    expect(formatSuperAdminPartnerShare(4000)).toBe('40%');
    expect(
      presentSuperAdminPartnerEarning({
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
      }),
    ).toMatchObject({
      campusName: '启明东校区',
      attendeeLabel: '10 人',
      perAttendeeLabel: '¥4.00',
      amountLabel: '¥40.00',
      canReview: true,
    });
  });

  it('sends partner rule and review mutations with versions and idempotency keys', async () => {
    const requests: Parameters<SuperAdminHttpRequest>[0][] = [];
    const source = new ApiSuperAdminDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: 'super-token',
      request: (options) => {
        requests.push(options);
        options.success({
          statusCode: 200,
          data: options.method === 'GET'
            ? { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }
            : { data: { id: 'result-1', version: 2, status: 'ACTIVE' } },
        });
      },
    });

    await source.listPartnerEarningRules({ page: 1, pageSize: 20, campusId: 'campus-east' });
    await source.createPartnerEarningRule(
      {
        campusId: 'campus-east',
        unitPriceFen: 1000,
        shareBasisPoints: 4000,
        eligibleLessonKinds: ['REGULAR'],
        countedAttendanceStatuses: ['PRESENT'],
        settlementDelayDays: 0,
        effectiveFrom: '2026-09-01T00:00:00+08:00',
      },
      'partner-rule-create-1',
    );
    await source.transitionPartnerEarningRule(
      'rule-1',
      'activate',
      1,
      'partner-rule-activate-1',
    );
    await source.reviewPartnerEarning(
      'earning-1',
      'reject',
      1,
      '课次数据需复核',
      'partner-earning-reject-1',
    );

    expect(requests.map(({ url }) => url)).toEqual([
      'https://example.test/api/management/partner-earning-rules?page=1&pageSize=20&campusId=campus-east',
      'https://example.test/api/management/partner-earning-rules',
      'https://example.test/api/management/partner-earning-rules/rule-1/activate',
      'https://example.test/api/management/partner-earnings/earning-1/reject',
    ]);
    expect(requests.slice(1).map(({ header }) => header['Idempotency-Key'])).toEqual([
      'partner-rule-create-1',
      'partner-rule-activate-1',
      'partner-earning-reject-1',
    ]);
    expect(requests[2].data).toEqual({ expectedVersion: 1 });
    expect(requests[3].data).toEqual({
      expectedVersion: 1,
      reason: '课次数据需复核',
    });
  });

  it('keeps mock partner rules and review state after mutation', async () => {
    const source: SuperAdminDataSource = new MockSuperAdminDataSource();
    const created = await source.createPartnerEarningRule(
      {
        campusId: '10000000-0000-4000-8000-000000000001',
        unitPriceFen: 1000,
        shareBasisPoints: 4000,
        eligibleLessonKinds: ['REGULAR'],
        countedAttendanceStatuses: ['PRESENT'],
        settlementDelayDays: 0,
        effectiveFrom: '2026-09-01T00:00:00+08:00',
      },
      'mock-create',
    );
    const active = await source.transitionPartnerEarningRule(
      created.id,
      'activate',
      created.version,
      'mock-activate',
    );
    expect(active.status).toBe('ACTIVE');

    const earnings = await source.listPartnerEarnings({ page: 1, pageSize: 20 });
    const reviewed = await source.reviewPartnerEarning(
      earnings.data[0].id,
      'approve',
      earnings.data[0].version,
      undefined,
      'mock-approve',
    );
    expect(reviewed.status).toBe('AVAILABLE');
  });

  it('registers total-client partner rule and review pages', () => {
    const root = path.resolve(__dirname, '..');
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')) as {
      subPackages: Array<{ root: string; pages: string[] }>;
    };
    const pages = app.subPackages.find(
      (item) => item.root === 'pages/super-admin',
    )?.pages;
    expect(pages).toEqual(
      expect.arrayContaining([
        'partner-earning-rules/index',
        'partner-earnings/index',
      ]),
    );
    const ruleMarkup = fs.readFileSync(
      path.join(root, 'pages/super-admin/partner-earning-rules/index.wxml'),
      'utf8',
    );
    const earningMarkup = fs.readFileSync(
      path.join(root, 'pages/super-admin/partner-earnings/index.wxml'),
      'utf8',
    );
    expect(ruleMarkup).toContain('课耗单价（元/人次）');
    expect(ruleMarkup).toContain('合作方比例（%）');
    expect(earningMarkup).toContain('合作方收益审核');
    expect(earningMarkup).toContain('bindtap="onReview"');
    expect(earningMarkup).not.toMatch(/提现|打款|自动分账/);
  });
});
import * as fs from 'fs';
import * as path from 'path';
