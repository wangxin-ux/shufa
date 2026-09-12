import {
  ApiSuperAdminDataSource,
  SuperAdminHttpRequest,
  SuperAdminUploadFile,
} from '../data/api-super-admin-data-source';

const campaign = {
  id: 'campaign-1',
  code: 'GROUP-1990-DEMO',
  campusId: 'campus-1',
  campusName: '启明东校区',
  courseProductId: 'course-1',
  courseName: '创意体验课',
  title: '19.9 元创意体验课拼团',
  description: '三人同行，每人获得五次线下课程。',
  priceFen: 1990,
  maxPaidMembers: 3,
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-09-30T15:59:59.000Z',
  status: 'DRAFT',
  version: 1,
  posterImages: [],
  joinableTeams: [],
  boundStudents: [],
  customerService: { name: '校区客服', phone: '010-12345678', qrCodeUrl: null },
  createdAt: '2026-09-02T08:00:00.000Z',
  updatedAt: '2026-09-02T08:00:00.000Z',
} as const;

describe('super admin group buying data source', () => {
  it('loads active course products without depending on existing campaigns', async () => {
    const requests: Parameters<SuperAdminHttpRequest>[0][] = [];
    const source = new ApiSuperAdminDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: 'super-token',
      request: (options) => {
        requests.push(options);
        options.success({
          statusCode: 200,
          data: {
            data: [{
              id: 'course-1',
              campusId: 'campus-1',
              campusName: '启明东校区',
              name: '创意体验课',
              summary: '线下体验课程',
              coverFileId: null,
              priceFen: 1990,
              mainUnits: 100,
              giftUnits: 0,
              validityDays: 365,
              status: 'ACTIVE',
              version: 1,
              createdAt: '2026-09-01T00:00:00.000Z',
              updatedAt: '2026-09-01T00:00:00.000Z',
            }],
            meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
            requestId: 'course-products-1',
          },
        });
      },
    });

    await expect(source.listCourseProducts({
      page: 1,
      pageSize: 100,
      status: 'ACTIVE',
    })).resolves.toMatchObject({
      data: [expect.objectContaining({ id: 'course-1', name: '创意体验课' })],
      meta: { total: 1 },
    });
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: 'https://example.test/api/management/course-products?page=1&pageSize=100&status=ACTIVE',
      header: { Authorization: 'Bearer super-token' },
    });
  });

  it('creates, activates and closes campaigns with versions and idempotency keys', async () => {
    const requests: Parameters<SuperAdminHttpRequest>[0][] = [];
    const source = new ApiSuperAdminDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: 'super-token',
      request: (options) => {
        requests.push(options);
        options.success({
          statusCode: 200,
          data: {
            data: { ...campaign, version: requests.length },
            requestId: `request-${requests.length}`,
          },
        });
      },
    });

    const input = {
      campusId: 'campus-1',
      courseProductId: 'course-1',
      title: campaign.title,
      description: campaign.description,
      priceFen: 1990,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
    };
    await source.createGroupCampaign(input, 'group-campaign-create-1');
    await source.transitionGroupCampaign(
      'campaign-1',
      'activate',
      1,
      undefined,
      'group-campaign-activate-1',
    );
    await source.transitionGroupCampaign(
      'campaign-1',
      'close',
      2,
      undefined,
      'group-campaign-close-1',
    );

    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/api/management/group-campaigns',
      header: expect.objectContaining({
        'Idempotency-Key': 'group-campaign-create-1',
      }),
      data: input,
    });
    expect(requests[1]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/api/management/group-campaigns/campaign-1/activate',
      data: { expectedVersion: 1 },
    });
    expect(requests[2]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/api/management/group-campaigns/campaign-1/close',
      data: { expectedVersion: 2 },
    });
  });

  it('requires a reason and version when refunding an order', async () => {
    const requests: Parameters<SuperAdminHttpRequest>[0][] = [];
    const source = new ApiSuperAdminDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'super-token',
      request: (options) => {
        requests.push(options);
        options.success({
          statusCode: 200,
          data: { data: { id: 'order-1' }, requestId: 'refund-1' },
        });
      },
    });

    await source.refundGroupOrder(
      'order-1',
      3,
      '家长申请退款',
      'group-refund-1',
    );

    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/management/group-orders/order-1/refund',
      header: expect.objectContaining({ 'Idempotency-Key': 'group-refund-1' }),
      data: { expectedVersion: 3, reason: '家长申请退款' },
    });
  });

  it('uploads, reorders, and detaches campaign posters with version guards', async () => {
    const requests: Parameters<SuperAdminHttpRequest>[0][] = [];
    const uploads: Parameters<SuperAdminUploadFile>[0][] = [];
    const source = new ApiSuperAdminDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: 'super-token',
      request: (options) => {
        requests.push(options);
        options.success({
          statusCode: 200,
          data: { data: campaign, requestId: 'poster-mutation' },
        });
      },
      uploadFile: (options) => {
        uploads.push(options);
        options.success({
          statusCode: 200,
          data: JSON.stringify({
            data: {
              ...campaign,
              posterImages: [{
                id: 'poster-1', storedFileId: 'file-1', sortOrder: 0,
                mimeType: 'image/png', sizeBytes: 1024,
                accessUrl: '/media/group-campaign-posters/file-1?expires=1&signature=abc',
                accessUrlExpiresAt: '2026-09-03T10:00:00.000Z',
              }],
            },
            requestId: 'poster-upload',
          }),
        });
      },
    });

    const uploaded = await source.uploadGroupCampaignPoster(
      'campaign-1',
      'wxfile://poster.png',
      1,
      'group-poster-upload-1',
    );
    await source.reorderGroupCampaignPosters(
      'campaign-1',
      ['poster-2', 'poster-1'],
      2,
      'group-poster-reorder-1',
    );
    await source.detachGroupCampaignPoster(
      'campaign-1',
      'poster-1',
      3,
      'group-poster-detach-1',
    );

    expect(uploads[0]).toMatchObject({
      url: 'https://example.test/api/management/group-campaigns/campaign-1/posters',
      filePath: 'wxfile://poster.png',
      name: 'file',
      formData: { expectedVersion: '1' },
      header: expect.objectContaining({
        Authorization: 'Bearer super-token',
        'Idempotency-Key': 'group-poster-upload-1',
      }),
    });
    expect(uploaded.posterImages[0].accessUrl).toBe(
      'https://example.test/api/media/group-campaign-posters/file-1?expires=1&signature=abc',
    );
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/api/management/group-campaigns/campaign-1/posters/reorder',
      data: { expectedVersion: 2, posterIds: ['poster-2', 'poster-1'] },
    });
    expect(requests[1]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/api/management/group-campaigns/campaign-1/posters/poster-1/detach',
      data: { expectedVersion: 3 },
    });
  });
});
