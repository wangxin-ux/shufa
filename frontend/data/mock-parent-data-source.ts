import { ParentMockScenario } from '../config/env';
import {
  EMPTY_PARENT_FIXTURE,
  NORMAL_PARENT_FIXTURE,
  ParentFixture,
} from '../mock/fixtures/parent.fixture';
import {
  LeaveDraft,
  LeavePageView,
  LeaveRecord,
  ParentHomeSummary,
  ParentCampusLocation,
  ParentCampusPage,
  ParentCampusQuery,
  ParentHoursView,
  ParentProfileView,
  ParentProfileUpdateInput,
  ParentUpdatesView,
} from '../types/parent';
import {
  GroupCampaignView,
  GroupJoinInput,
  GroupJoinView,
  GroupOrderQuery,
  GroupOrderView,
  GroupPage,
  GroupPrepayView,
  GroupTeamView,
  ParentGroupCampaignQuery,
} from '../types/group-buying';
import { formatDateTimeLabel } from '../utils/format';
import { ParentDataSource } from './parent-data-source';

export interface MockParentDataSourceOptions {
  scenario?: ParentMockScenario;
}

const MOCK_ERROR_MESSAGE = '家长端 Mock 请求失败';

function cloneFixtureValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MockParentDataSource implements ParentDataSource {
  private readonly scenario: ParentMockScenario;
  private readonly fixture: ParentFixture;
  private readonly leaveRecords: LeaveRecord[];
  private readonly submissions = new Map<string, LeaveRecord>();
  private readonly groupSubmissions = new Map<string, GroupJoinView>();
  private readonly groupOrders: GroupOrderView[] = [];
  private readonly groupCampaigns: GroupCampaignView[];
  private readonly profileSubmissions = new Map<string, ParentProfileView>();
  private nextLeaveSequence = 1;

  constructor(options: MockParentDataSourceOptions = {}) {
    this.scenario = options.scenario ?? 'normal';
    this.fixture = cloneFixtureValue(
      this.scenario === 'empty' ? EMPTY_PARENT_FIXTURE : NORMAL_PARENT_FIXTURE,
    );
    this.leaveRecords = cloneFixtureValue(this.fixture.leave.records);
    this.groupCampaigns = this.scenario === 'empty' ? [] : [this.createGroupCampaignFixture()];
  }

  async listCampuses(query: ParentCampusQuery): Promise<ParentCampusPage> {
    this.assertAvailable();
    const hasLocation =
      query.latitude !== undefined && query.longitude !== undefined;
    const campuses: ParentCampusLocation[] =
      this.scenario === 'empty'
        ? []
        : [
            {
              id: '10000000-0000-4000-8000-000000000001',
              name: '启明东校区',
              address: '长沙市岳麓区启明路 18 号',
              contactPhone: '0731-88886666',
              latitude: 28.2282,
              longitude: 112.9388,
              distanceMeters: hasLocation ? 860 : null,
            },
            {
              id: '10000000-0000-4000-8000-000000000002',
              name: '启明西校区',
              address: '长沙市岳麓区枫林路 66 号',
              contactPhone: '0731-88885555',
              latitude: 28.2053,
              longitude: 112.8891,
              distanceMeters: hasLocation ? 5200 : null,
            },
          ];
    return this.page(campuses, query);
  }

  async getHomeSummary(): Promise<ParentHomeSummary> {
    this.assertAvailable();
    return cloneFixtureValue(this.fixture.home);
  }

  async getHoursView(): Promise<ParentHoursView> {
    this.assertAvailable();
    return cloneFixtureValue(this.fixture.hours);
  }

  async getLeavePage(): Promise<LeavePageView> {
    this.assertAvailable();
    return {
      ...cloneFixtureValue(this.fixture.leave),
      records: cloneFixtureValue(this.leaveRecords),
    };
  }

  async submitLeave(draft: LeaveDraft, idempotencyKey: string): Promise<LeaveRecord> {
    this.assertAvailable();
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey) {
      throw new Error('幂等标识不能为空');
    }
    if (!draft.studentId.trim() || !draft.lessonId.trim() || !draft.reason.trim()) {
      throw new Error('请完整填写请假信息');
    }

    const submitted = this.submissions.get(normalizedKey);
    if (submitted) {
      return cloneFixtureValue(submitted);
    }

    const student = this.fixture.leave.students.find((item) => item.id === draft.studentId);
    const lesson = this.fixture.leave.lessons.find((item) => item.id === draft.lessonId);
    if (!student || !lesson) {
      throw new Error('请选择有效的学员和课程');
    }

    const record: LeaveRecord = {
      id: `mock-leave-${String(this.nextLeaveSequence).padStart(3, '0')}`,
      courseName: lesson.title,
      lessonTimeLabel: formatDateTimeLabel(lesson.startsAt),
      reason: draft.reason.trim(),
      status: 'pending',
    };
    this.nextLeaveSequence += 1;
    this.leaveRecords.unshift(record);
    this.submissions.set(normalizedKey, cloneFixtureValue(record));
    return cloneFixtureValue(record);
  }

  async getProfile(): Promise<ParentProfileView> {
    this.assertAvailable();
    return cloneFixtureValue(this.fixture.profile);
  }

  async updateProfile(
    input: ParentProfileUpdateInput,
    idempotencyKey: string,
  ): Promise<ParentProfileView> {
    this.assertAvailable();
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey) throw new Error('幂等标识不能为空');
    const replay = this.profileSubmissions.get(normalizedKey);
    if (replay) return cloneFixtureValue(replay);
    const student = this.fixture.profile.student;
    if (!student) throw new Error('暂未绑定学员');
    if (student.profileVersion !== input.expectedVersion) {
      throw new Error('资料已更新，请刷新后重试');
    }
    student.age = input.age;
    student.homeAddress = input.homeAddress.trim() || null;
    student.profileVersion += 1;
    const result = cloneFixtureValue(this.fixture.profile);
    this.profileSubmissions.set(normalizedKey, result);
    return cloneFixtureValue(result);
  }

  async getUpdates(): Promise<ParentUpdatesView> {
    this.assertAvailable();
    return cloneFixtureValue(this.fixture.updates);
  }

  async listGroupCampaigns(
    query: ParentGroupCampaignQuery,
  ): Promise<GroupPage<GroupCampaignView>> {
    this.assertAvailable();
    return this.page(this.groupCampaigns, query);
  }

  async getGroupCampaign(campaignId: string, teamId?: string): Promise<GroupCampaignView> {
    this.assertAvailable();
    const campaign = this.groupCampaigns.find((item) => item.id === campaignId);
    if (!campaign) throw new Error('未找到拼团活动');
    const view = cloneFixtureValue(campaign);
    if (teamId) view.joinableTeams = view.joinableTeams.filter((team) => team.id === teamId);
    return view;
  }

  async listGroupOrders(query: GroupOrderQuery): Promise<GroupPage<GroupOrderView>> {
    this.assertAvailable();
    const orders = query.status
      ? this.groupOrders.filter((item) => item.memberStatus === query.status)
      : this.groupOrders;
    return this.page(orders, query);
  }

  async createGroupTeam(input: GroupJoinInput, idempotencyKey: string): Promise<GroupJoinView> {
    this.assertAvailable();
    const replay = this.groupSubmissions.get(idempotencyKey);
    if (replay) return cloneFixtureValue(replay);
    const campaign = this.requireGroupCampaign(input.campaignId, input.studentId);
    const sequence = this.groupOrders.length + 1;
    const team: GroupTeamView = {
      id: `mock-team-${sequence}`,
      status: 'OPEN',
      paidMemberCount: 0,
      remainingSlots: 2,
      finalTier: null,
      members: [],
      shareScene: `group:mock-team-${sequence}`,
      settledAt: null,
      createdAt: new Date().toISOString(),
    };
    campaign.joinableTeams.unshift(team);
    return this.createPendingGroupOrder(campaign, team, input.studentId, idempotencyKey);
  }

  async joinGroupTeam(teamId: string, studentId: string, idempotencyKey: string): Promise<GroupJoinView> {
    this.assertAvailable();
    const replay = this.groupSubmissions.get(idempotencyKey);
    if (replay) return cloneFixtureValue(replay);
    const campaign = this.groupCampaigns.find((item) => item.joinableTeams.some((team) => team.id === teamId));
    if (!campaign) throw new Error('该拼团队伍已不可加入');
    this.requireGroupCampaign(campaign.id, studentId);
    const team = campaign.joinableTeams.find((item) => item.id === teamId)!;
    if (team.remainingSlots <= 0) throw new Error('该拼团队伍已满');
    return this.createPendingGroupOrder(campaign, team, studentId, idempotencyKey);
  }

  async retryGroupPrepay(memberId: string, expectedVersion: number): Promise<GroupPrepayView> {
    this.assertAvailable();
    const order = this.groupOrders.find((item) => item.memberId === memberId);
    if (!order || order.version !== expectedVersion || order.memberStatus !== 'PENDING_PAYMENT') {
      throw new Error('拼团订单状态已更新');
    }
    return this.mockPrepay(order);
  }

  async confirmMockGroupPayment(memberId: string, outTradeNo: string): Promise<GroupOrderView> {
    this.assertAvailable();
    const order = this.groupOrders.find((item) => item.memberId === memberId);
    if (!order) throw new Error('未找到拼团订单');
    if (order.memberStatus !== 'PENDING_PAYMENT') return cloneFixtureValue(order);
    if (!outTradeNo.trim()) throw new Error('支付单号不能为空');
    order.memberStatus = 'PAID';
    order.orderStatus = 'PAID';
    order.paidAt = new Date().toISOString();
    order.version += 1;
    const campaign = this.groupCampaigns.find((item) => item.id === order.campaignId)!;
    const team = campaign.joinableTeams.find((item) => item.id === order.teamId)!;
    team.paidMemberCount += 1;
    team.members.push({
      id: order.memberId,
      maskedParentName: '林**',
      studentName: order.studentName,
      status: 'PAID',
      paidAt: order.paidAt,
    });
    order.paidMemberCount = team.paidMemberCount;
    return cloneFixtureValue(order);
  }

  private createGroupCampaignFixture(): GroupCampaignView {
    const student = this.fixture.leave.students[0] ?? { id: 'student-lin-xiao-he', name: '林小禾' };
    return {
      id: 'mock-group-campaign-1',
      code: 'GROUP-1990-DEMO',
      campusId: '10000000-0000-4000-8000-000000000001',
      campusName: '启明东校区',
      courseProductId: 'mock-course-product-1',
      courseName: '创意体验课',
      title: '19.9 元创意体验课拼团',
      description: '好友同行更划算，三人拼成后每位学员可获得五次线下体验课。',
      priceFen: 1990,
      maxPaidMembers: 3,
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-09-30T15:59:59.000Z',
      status: 'ACTIVE',
      version: 1,
      posterImages: [],
      joinableTeams: [],
      boundStudents: [student],
      customerService: { name: '陈老师', phone: '021-55668899', qrCodeUrl: null },
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    };
  }

  private requireGroupCampaign(campaignId: string, studentId: string): GroupCampaignView {
    const campaign = this.groupCampaigns.find((item) => item.id === campaignId);
    if (!campaign || campaign.status !== 'ACTIVE') throw new Error('拼团活动当前不可参与');
    if (!campaign.boundStudents.some((student) => student.id === studentId)) throw new Error('请选择已绑定学员');
    if (this.groupOrders.some((order) => order.campaignId === campaignId && order.studentId === studentId && order.memberStatus !== 'CANCELLED' && order.memberStatus !== 'REFUNDED')) {
      throw new Error('该学员已参与本活动');
    }
    return campaign;
  }

  private createPendingGroupOrder(campaign: GroupCampaignView, team: GroupTeamView, studentId: string, idempotencyKey: string): GroupJoinView {
    const studentName = campaign.boundStudents.find((item) => item.id === studentId)?.name ?? '学员';
    const sequence = this.groupOrders.length + 1;
    const now = new Date().toISOString();
    const order: GroupOrderView = {
      id: `mock-group-order-${sequence}`,
      orderNo: `GROUP-MOCK-${String(sequence).padStart(4, '0')}`,
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      teamId: team.id,
      memberId: `mock-group-member-${sequence}`,
      campusId: campaign.campusId,
      campusName: campaign.campusName,
      studentId,
      studentName,
      priceFen: campaign.priceFen,
      memberStatus: 'PENDING_PAYMENT',
      orderStatus: 'AWAITING_PAYMENT',
      teamStatus: 'OPEN',
      paidMemberCount: team.paidMemberCount,
      grantedMainUnits: null,
      grantedGiftUnits: null,
      paidAt: null,
      settledAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.groupOrders.unshift(order);
    team.remainingSlots = Math.max(0, team.remainingSlots - 1);
    const result = { team: cloneFixtureValue(team), order: cloneFixtureValue(order), prepay: this.mockPrepay(order) };
    this.groupSubmissions.set(idempotencyKey, cloneFixtureValue(result));
    return result;
  }

  private mockPrepay(order: GroupOrderView): GroupPrepayView {
    return {
      mode: 'MOCK', memberId: order.memberId, orderId: order.id,
      outTradeNo: `MOCK-${order.orderNo}`, timeStamp: null, nonceStr: null,
      package: null, signType: null, paySign: null,
    };
  }

  private page<T>(data: T[], query: { page: number; pageSize: number }): GroupPage<T> {
    const start = (query.page - 1) * query.pageSize;
    return {
      data: cloneFixtureValue(data.slice(start, start + query.pageSize)),
      meta: {
        page: query.page, pageSize: query.pageSize, total: data.length,
        totalPages: data.length === 0 ? 0 : Math.ceil(data.length / query.pageSize),
      },
    };
  }

  private assertAvailable(): void {
    if (this.scenario === 'error') {
      throw new Error(MOCK_ERROR_MESSAGE);
    }
  }
}
