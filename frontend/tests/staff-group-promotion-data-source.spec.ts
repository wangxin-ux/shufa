import {
  ApiTeacherDataSource,
  TeacherHttpRequest,
} from '../data/api-teacher-data-source';
import {
  ApiPartnerDataSource,
  PartnerHttpRequest,
} from '../data/api-partner-data-source';
import {
  buildGroupPromotionShareCopy,
  groupPromotionRecipientPath,
  presentGroupPromotionCampaign,
} from '../services/group-promotion.presenter';
import { GroupPromotionCampaignView } from '../types/group-buying';
import { MockPartnerDataSource } from '../data/mock-partner-data-source';
import { presentPartnerPromotionCampaign } from '../pages/partner/runtime/group-promotion';

const campaign: GroupPromotionCampaignView = {
  id: 'campaign-1',
  code: 'GROUP-1990-DEMO',
  campusId: 'campus-1',
  campusName: '启明东校区',
  courseProductId: 'course-1',
  courseName: '创意体验课',
  title: '19.9 元创意美术拼团课',
  description: '三人成团，每位学员获得五次线下体验课。',
  priceFen: 1990,
  maxPaidMembers: 3,
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-09-30T15:59:59.000Z',
  status: 'ACTIVE',
  posterImages: [
    {
      id: 'poster-1',
      storedFileId: 'file-1',
      sortOrder: 0,
      mimeType: 'image/png',
      sizeBytes: 1024,
      accessUrl:
        '/media/group-campaign-posters/file-1?expires=1&signature=abc',
      accessUrlExpiresAt: '2026-09-03T10:00:00.000Z',
    },
  ],
  customerService: {
    name: '启明课程顾问',
    phone: '0731-88886666',
    qrCodeUrl: '/media/customer-service-qr/file-2?expires=1&signature=def',
  },
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
};

describe('staff group promotion data sources', () => {
  it('uses teacher promotion routes and normalizes poster URLs', async () => {
    const requests: Parameters<TeacherHttpRequest>[0][] = [];
    const request: TeacherHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data:
          requests.length === 1
            ? {
                data: [campaign],
                meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
                requestId: 'teacher-list',
              }
            : { data: campaign, requestId: 'teacher-detail' },
      });
    };
    const source = new ApiTeacherDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: 'teacher-token',
      request,
    });

    const page = await source.listGroupPromotionCampaigns({
      page: 1,
      pageSize: 20,
    });
    const detail = await source.getGroupPromotionCampaign('campaign-1');

    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      {
        method: 'GET',
        url: 'https://example.test/api/teachers/me/group-campaigns?page=1&pageSize=20',
      },
      {
        method: 'GET',
        url: 'https://example.test/api/teachers/me/group-campaigns/campaign-1',
      },
    ]);
    expect(page.data[0].posterImages[0].accessUrl).toBe(
      'https://example.test/api/media/group-campaign-posters/file-1?expires=1&signature=abc',
    );
    expect(detail.posterImages[0].accessUrl).toBe(
      'https://example.test/api/media/group-campaign-posters/file-1?expires=1&signature=abc',
    );
    expect(detail.customerService.qrCodeUrl).toBe(
      'https://example.test/api/media/customer-service-qr/file-2?expires=1&signature=def',
    );
  });

  it('uses partner promotion routes and normalizes poster URLs', async () => {
    const requests: Parameters<PartnerHttpRequest>[0][] = [];
    const request: PartnerHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data:
          requests.length === 1
            ? {
                data: [campaign],
                meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
                requestId: 'partner-list',
              }
            : { data: campaign, requestId: 'partner-detail' },
      });
    };
    const source = new ApiPartnerDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: 'partner-token',
      request,
    });

    const page = await source.listGroupPromotionCampaigns({
      page: 1,
      pageSize: 20,
    });
    const detail = await source.getGroupPromotionCampaign('campaign-1');

    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      {
        method: 'GET',
        url: 'https://example.test/api/partners/me/group-campaigns?page=1&pageSize=20',
      },
      {
        method: 'GET',
        url: 'https://example.test/api/partners/me/group-campaigns/campaign-1',
      },
    ]);
    expect(page.data[0].posterImages[0].accessUrl).toContain(
      'https://example.test/api/media/group-campaign-posters/file-1',
    );
    expect(detail.posterImages[0].accessUrl).toContain(
      'https://example.test/api/media/group-campaign-posters/file-1',
    );
    expect(detail.customerService.qrCodeUrl).toBe(
      'https://example.test/api/media/customer-service-qr/file-2?expires=1&signature=def',
    );
  });
});

describe('staff group promotion presenter', () => {
  it('formats Chinese activity facts and a parent recipient path', () => {
    const view = presentGroupPromotionCampaign(campaign);

    expect(view.priceLabel).toBe('¥19.9');
    expect(view.endsAtLabel).toBe('2026-09-30 23:59');
    expect(view.deadlineLabel).toBe('截至 2026-09-30 23:59');
    expect(groupPromotionRecipientPath(campaign.id)).toBe(
      '/pages/parent/group-detail/index?id=campaign-1',
    );
  });

  it('builds role-neutral copy without pretending staff joined', () => {
    const copy = buildGroupPromotionShareCopy(
      presentGroupPromotionCampaign(campaign),
    );

    expect(copy).toContain('19.9 元创意美术拼团课');
    expect(copy).toContain('启明东校区');
    expect(copy).toContain('3 人拼团');
    expect(copy).not.toContain('我正在参加');
    expect(copy).not.toContain('学员');
  });

  it.each(['ACTIVE', 'CLOSED'] as const)('labels ended %s history from the server flag', (status) => {
    const view = presentPartnerPromotionCampaign({
      ...campaign, status, canPromote: false,
    });
    expect(view).toMatchObject({ canPromote: false, statusLabel: '已结束' });
  });
});

describe('partner campaign history data sources', () => {
  it('forwards ENDED and preserves the server flag while normalizing URLs', async () => {
    const requests: Parameters<PartnerHttpRequest>[0][] = [];
    const ended = { ...campaign, canPromote: false };
    const source = new ApiPartnerDataSource({
      baseUrl: 'https://example.test/api',
      accessToken: 'partner-token',
      request: (options) => {
        requests.push(options);
        options.success({ statusCode: 200, data: requests.length === 1
          ? { data: [ended], meta: { page: 2, pageSize: 1, total: 2, totalPages: 2 } }
          : { data: ended },
        });
      },
    });
    const page = await source.listGroupPromotionCampaigns({ page: 2, pageSize: 1, phase: 'ENDED' });
    const detail = await source.getGroupPromotionCampaign(campaign.id);
    expect(requests[0].url).toBe(
      'https://example.test/api/partners/me/group-campaigns?page=2&pageSize=1&phase=ENDED',
    );
    expect(page.data[0]).toMatchObject({ status: 'ACTIVE', canPromote: false });
    expect(detail).toMatchObject({ canPromote: false });
    expect(detail.posterImages[0].accessUrl).toContain('https://example.test/api/media/');
  });

  it('keeps mock phases separate and ended details readable across pagination', async () => {
    const source = new MockPartnerDataSource();
    const ongoing = await source.listGroupPromotionCampaigns({ page: 1, pageSize: 1 });
    const ended = await source.listGroupPromotionCampaigns({ page: 1, pageSize: 1, phase: 'ENDED' });
    const beyond = await source.listGroupPromotionCampaigns({ page: 2, pageSize: 1, phase: 'ENDED' });
    expect(ongoing.data).toHaveLength(1);
    expect(ongoing.data[0].canPromote).toBe(true);
    expect(ended.data).toHaveLength(1);
    expect(ended.data[0]).toMatchObject({ status: 'CLOSED', canPromote: false });
    expect(ended.data[0].id).not.toBe(ongoing.data[0].id);
    expect(await source.getGroupPromotionCampaign(ended.data[0].id)).toMatchObject({
      id: ended.data[0].id, canPromote: false,
    });
    expect(beyond).toMatchObject({ data: [], meta: { total: 1 } });
  });
});
