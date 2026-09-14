import {
  ApiParentDataSource,
  ParentHttpRequest,
} from '../data/api-parent-data-source';
import { ParentGroupBuyingWorkflow } from '../services/parent-group-buying.workflow';

function createJoinResponse() {
  return {
    team: {
      id: 'team-1',
      status: 'OPEN',
      paidMemberCount: 0,
      remainingSlots: 2,
      finalTier: null,
      members: [],
      shareScene: 'group:team-1',
      settledAt: null,
      createdAt: '2026-09-02T08:00:00.000Z',
    },
    order: {
      id: 'order-1',
      orderNo: 'GROUP-ORDER-1',
      campaignId: 'campaign-1',
      campaignTitle: '19.9 元创意体验课拼团',
      teamId: 'team-1',
      memberId: 'member-1',
      campusId: 'campus-1',
      campusName: '启明东校区',
      studentId: 'student-1',
      studentName: '林小禾',
      priceFen: 1990,
      memberStatus: 'PENDING_PAYMENT',
      orderStatus: 'AWAITING_PAYMENT',
      teamStatus: 'OPEN',
      paidMemberCount: 0,
      grantedMainUnits: null,
      grantedGiftUnits: null,
      paidAt: null,
      settledAt: null,
      version: 1,
      createdAt: '2026-09-02T08:00:00.000Z',
      updatedAt: '2026-09-02T08:00:00.000Z',
    },
    prepay: {
      mode: 'MOCK',
      memberId: 'member-1',
      orderId: 'order-1',
      outTradeNo: 'GROUP-PAY-1',
      timeStamp: null,
      nonceStr: null,
      package: null,
      signType: null,
      paySign: null,
    },
  } as const;
}

describe('parent group buying data source', () => {
  it('shows a Chinese message when the selected student already joined the campaign', async () => {
    const request: ParentHttpRequest = (options) => options.success({
      statusCode: 409,
      data: {
        code: 'GROUP_ALREADY_JOINED',
        message: 'The student has already joined this campaign',
        details: {},
        requestId: 'group-already-joined',
      },
    });
    const source = new ApiParentDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'parent-token',
      request,
    });

    await expect(
      source.createGroupTeam(
        { campaignId: 'campaign-1', studentId: 'student-1' },
        'group-create-duplicate-1',
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'GROUP_ALREADY_JOINED',
      message: '该学员已参加本活动',
    });
  });

  it('maps campaign poster and customer-service QR URLs to the configured API origin', async () => {
    const request: ParentHttpRequest = (options) => options.success({
      statusCode: 200,
      data: {
        data: {
          id: 'campaign-1',
          posterImages: [{
            id: 'poster-1', storedFileId: 'file-1', sortOrder: 0,
            mimeType: 'image/png', sizeBytes: 1024,
            accessUrl: '/media/group-campaign-posters/file-1?expires=1&signature=abc',
            accessUrlExpiresAt: '2026-09-03T10:00:00.000Z',
          }],
          customerService: {
            name: '启明校区客服',
            phone: '0731-88886666',
            qrCodeUrl: '/media/customer-service-qr/file-2?expires=1&signature=def',
          },
        },
        requestId: 'campaign-detail',
      },
    });
    const source = new ApiParentDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: 'parent-token',
      request,
    });

    const result = await source.getGroupCampaign('campaign-1');

    expect(result.posterImages[0].accessUrl).toBe(
      'https://example.test/api/media/group-campaign-posters/file-1?expires=1&signature=abc',
    );
    expect(result.customerService.qrCodeUrl).toBe(
      'https://example.test/api/media/customer-service-qr/file-2?expires=1&signature=def',
    );
  });

  it('sends stable idempotency keys for opening a team and confirming mock payment', async () => {
    const requests: Parameters<ParentHttpRequest>[0][] = [];
    const join = createJoinResponse();
    const request: ParentHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data: {
          data:
            requests.length === 1
              ? join
              : {
                  ...join.order,
                  memberStatus: 'PAID',
                  orderStatus: 'PAID',
                  paidMemberCount: 1,
                  version: 2,
                },
          requestId: `request-${requests.length}`,
        },
      });
    };
    const source = new ApiParentDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'parent-token',
      request,
    });

    const created = await source.createGroupTeam(
      { campaignId: 'campaign-1', studentId: 'student-1' },
      'group-create-1',
    );
    await source.confirmMockGroupPayment(
      created.prepay.memberId,
      created.prepay.outTradeNo,
      'group-confirm-1',
    );

    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/parents/me/group-teams',
      header: expect.objectContaining({
        Authorization: 'Bearer parent-token',
        'Idempotency-Key': 'group-create-1',
      }),
      data: { campaignId: 'campaign-1', studentId: 'student-1' },
    });
    expect(requests[1]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/parents/me/group-members/member-1/mock-payment-confirmation',
      header: expect.objectContaining({
        'Idempotency-Key': 'group-confirm-1',
      }),
      data: { outTradeNo: 'GROUP-PAY-1' },
    });
  });

  it('keeps the selected student while mock payment enters server-confirming state', async () => {
    const join = createJoinResponse();
    const source = {
      createGroupTeam: jest.fn().mockResolvedValue(join),
      joinGroupTeam: jest.fn(),
      retryGroupPrepay: jest.fn(),
      confirmMockGroupPayment: jest
        .fn()
        .mockResolvedValue({ ...join.order, memberStatus: 'PAID', version: 2 }),
    };
    const workflow = new ParentGroupBuyingWorkflow(source);

    const invocation = await workflow.start(
      { campaignId: 'campaign-1', studentId: 'student-1' },
      'group-create-1',
    );
    expect(invocation).toEqual({ kind: 'mock', memberId: 'member-1' });
    expect(workflow.getState()).toMatchObject({
      status: 'payment-confirming',
      draft: { campaignId: 'campaign-1', studentId: 'student-1' },
    });
    expect(source.confirmMockGroupPayment).toHaveBeenCalledWith(
      'member-1',
      'GROUP-PAY-1',
      expect.stringContaining('group-confirm'),
    );
  });
});
