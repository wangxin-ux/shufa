import { ParentMockScenario } from '../config/env';
import {
  EMPTY_PARENT_FIXTURE,
  NORMAL_PARENT_FIXTURE,
  ParentFixture,
} from '../mock/fixtures/parent.fixture';
import { VISUAL_PARENT_FIXTURE } from '../mock/fixtures/parent-visual.fixture';
import {
  LeaveDraft,
  LeavePageView,
  LeaveRecord,
  ParentHomeSummary,
  ParentCampusLocation,
  ParentCampusPage,
  ParentCampusQuery,
  ParentCourseCatalogQuery,
  ParentCourseCatalogPage,
  ParentCourseQuote,
  ParentHoursView,
  ParentHoursQuery,
  ParentProfileView,
  ParentProfileUpdateInput,
  ParentUpdatesView,
  ParentGrowthStudent,
  ParentReviewDraft,
  ParentLessonReview,
  ParentPhotoUpload,
  ParentProfileSetupView,
  ParentProfileSetupInput,
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
import { ParentDataSource, ParentDataSourceError } from './parent-data-source';

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
  private readonly reviewSubmissions = new Map<string, ParentLessonReview>();
  private readonly photoSubmissions = new Map<string, ParentGrowthStudent>();
  private readonly stagedPhotos = new Map<string, { studentId: string; file: ParentPhotoUpload; filePath: string }>();
  private readonly setupSubmissions = new Map<string, { request: string; view: ParentProfileSetupView }>();
  private birthDate: string | null = null;
  private setupCompleted = false;
  private nextLeaveSequence = 1;

  constructor(options: MockParentDataSourceOptions = {}) {
    this.scenario = options.scenario ?? 'normal';
    this.fixture = cloneFixtureValue(
      this.scenario === 'empty' ? EMPTY_PARENT_FIXTURE :
        this.scenario === 'visual' ? VISUAL_PARENT_FIXTURE : NORMAL_PARENT_FIXTURE,
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
    this.refreshBirthdayAge();
    return { ...cloneFixtureValue(this.fixture.home),
      profileSetupRequired: this.scenario === 'profile-setup' && !this.setupCompleted && !!this.fixture.profile.student };
  }

  async listCourseCatalog(query: ParentCourseCatalogQuery): Promise<ParentCourseCatalogPage> {
    this.assertAvailable();
    if (this.scenario === 'empty') return this.page([], query);
    const campuses = (await this.listCampuses({ page: 1, pageSize: 100 })).data;
    const courses = [
      ['专业美术', 488000], ['硬笔规范字', 388000], ['软笔书法', 388000],
      ['演讲与口才', 498000], ['第一乐章', 488000],
    ] as const;
    return this.page(courses.map(([courseName, priceFen], index) => {
      const regular = campuses.map(({ distanceMeters: _distance, ...campus }, campusIndex): ParentCourseQuote => ({
        productId: `catalog-${index}-${campusIndex}`, productName: `${courseName}学习班`,
        classType: '学习班', priceFen, mainUnits: 4800, giftUnits: 0, validityDays: 365, campus,
      }));
      const individual: ParentCourseQuote = {
        ...regular[0], productId: `catalog-${index}-individual`,
        productName: `${courseName}一对一`, classType: '一对一', priceFen: 15000, mainUnits: 100,
      };
      return { courseName, primaryQuote: regular[0], classTypes: [
        { name: '学习班', quotes: regular }, { name: '一对一', quotes: [individual] },
      ] };
    }).filter((course) => !query.courseName || course.courseName === query.courseName), query);
  }

  async getHoursView(query?: ParentHoursQuery): Promise<ParentHoursView> {
    this.assertAvailable();
    const view = cloneFixtureValue(this.fixture.hours);
    const allEntries = view.entries.map((entry) => ({ ...entry, courseName: entry.courseName ?? '未分类' }));
    const entries = allEntries.filter((entry) =>
      (!query?.courseName || query.courseName === entry.courseName) &&
      (query?.direction === 'debit' ? entry.delta < 0 : query?.direction === 'credit' ? entry.delta > 0 : true));
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;
    return { ...view, courseNames: [...new Set(allEntries.map((entry) => entry.courseName))].sort(),
      entries: entries.slice((page - 1) * pageSize, page * pageSize),
      meta: { page, pageSize, total: entries.length, totalPages: Math.ceil(entries.length / pageSize) },
    };
  }

  async getLeavePage(studentId?: string): Promise<LeavePageView> {
    this.assertAvailable();
    if (studentId && !this.fixture.leave.students.some((student) => student.id === studentId)) {
      throw new ParentDataSourceError(403, 'FORBIDDEN', '无权查看该学员');
    }
    return {
      ...cloneFixtureValue(this.fixture.leave),
      weeklyWarnings: cloneFixtureValue(this.fixture.leave.weeklyWarnings ?? []),
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
      contactWarning: null,
    };
    this.nextLeaveSequence += 1;
    this.leaveRecords.unshift(record);
    this.submissions.set(normalizedKey, cloneFixtureValue(record));
    return cloneFixtureValue(record);
  }

  async getProfile(): Promise<ParentProfileView> {
    this.assertAvailable();
    this.refreshBirthdayAge();
    return cloneFixtureValue(this.fixture.profile);
  }

  async getProfileSetup(): Promise<ParentProfileSetupView> {
    this.assertAvailable();
    this.refreshBirthdayAge();
    const student = this.fixture.profile.student;
    return cloneFixtureValue({
      required: this.scenario === 'profile-setup' && !this.setupCompleted && !!student,
      student: student ? {
        id: student.id, name: student.name, age: student.age, birthDate: this.birthDate,
        profileVersion: student.profileVersion, photo: this.fixture.updates.student?.photo ?? null,
      } : null,
    });
  }

  async completeProfileSetup(studentId: string, input: ParentProfileSetupInput, key: string): Promise<ParentProfileSetupView> {
    this.assertAvailable();
    const student = this.fixture.profile.student;
    if (!student || student.id !== studentId) throw new ParentDataSourceError(403, 'FORBIDDEN', '无权修改此学员资料');
    if (!key.trim()) throw new ParentDataSourceError(400, 'INVALID_IDEMPOTENCY_KEY', '提交标识不能为空');
    const request = JSON.stringify([studentId, input.name, input.birthDate, input.fileId, input.expectedVersion]);
    const replay = this.setupSubmissions.get(key);
    if (replay) {
      if (replay.request !== request) throw new ParentDataSourceError(409, 'IDEMPOTENCY_CONFLICT', '提交内容已变化');
      return cloneFixtureValue(replay.view);
    }
    if (this.setupCompleted) throw new ParentDataSourceError(409, 'PARENT_PROFILE_ALREADY_COMPLETED', '孩子资料已完善');
    if (student.profileVersion !== input.expectedVersion) throw new ParentDataSourceError(409, 'STUDENT_PROFILE_VERSION_CONFLICT', '资料已更新，请刷新后重试');
    const date = new Date(`${input.birthDate}T00:00:00Z`);
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    if (!input.name.trim() || input.name.trim().length > 100 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.birthDate || input.birthDate > today ||
      this.birthdayAge(input.birthDate) > 120) {
      throw new ParentDataSourceError(400, 'VALIDATION_FAILED', '请正确填写姓名和出生日期');
    }
    const staged = this.stagedPhotos.get(input.fileId);
    const currentPhoto = this.fixture.updates.student?.photo;
    const photo = currentPhoto?.id === input.fileId ? currentPhoto :
      staged?.studentId === studentId ? { ...staged.file, accessUrl: staged.filePath,
        accessUrlExpiresAt: new Date(Date.now() + 900000).toISOString() } : null;
    if (!photo) throw new ParentDataSourceError(400, 'STUDENT_PHOTO_INVALID', '请重新选择照片');
    this.birthDate = input.birthDate;
    this.setupCompleted = true;
    student.name = input.name.trim();
    student.profileVersion += 1;
    student.profileSetupCompleted = true;
    this.fixture.updates.student = { id: student.id, name: student.name, age: this.birthdayAge(input.birthDate),
      profileVersion: student.profileVersion, photo };
    this.refreshBirthdayAge();
    const view = await this.getProfileSetup();
    this.setupSubmissions.set(key, { request, view: cloneFixtureValue(view) });
    return view;
  }

  private birthdayAge(birthDate: string): number {
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    return Math.max(0, Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4)) -
      (today.slice(5) < birthDate.slice(5) ? 1 : 0));
  }

  private refreshBirthdayAge() {
    const student = this.fixture.profile.student;
    if (!this.setupCompleted || !this.birthDate || !student) return;
    student.age = this.birthdayAge(this.birthDate);
    this.fixture.home.student = { id: student.id, name: student.name, age: student.age };
    this.fixture.leave.students = this.fixture.leave.students.map((bound) => bound.id === student.id ? { ...bound, name: student.name } : bound);
    if (this.fixture.updates.student) Object.assign(this.fixture.updates.student, {
      name: student.name, age: student.age, profileVersion: student.profileVersion,
    });
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
    if (this.setupCompleted && input.age !== undefined) throw new ParentDataSourceError(400, 'VALIDATION_FAILED', '年龄按生日自动更新');
    if (input.age !== undefined) student.age = input.age;
    student.homeAddress = input.homeAddress.trim() || null;
    student.profileVersion += 1;
    const result = cloneFixtureValue(this.fixture.profile);
    this.profileSubmissions.set(normalizedKey, result);
    return cloneFixtureValue(result);
  }

  async getUpdates(): Promise<ParentUpdatesView> {
    this.assertAvailable();
    this.refreshBirthdayAge();
    const profile = this.fixture.profile.student;
    if (profile && this.fixture.updates.student) {
      this.fixture.updates.student = { ...this.fixture.updates.student, name: profile.name,
        age: profile.age, profileVersion: profile.profileVersion };
    }
    return cloneFixtureValue(this.fixture.updates);
  }

  async uploadStudentPhoto(studentId: string, filePath: string): Promise<ParentPhotoUpload> {
    this.assertAvailable();
    if (this.fixture.profile.student?.id !== studentId) throw new ParentDataSourceError(403, 'FORBIDDEN', '无权修改此学员照片');
    const id = `mock-photo-${this.stagedPhotos.size + 1}`;
    const file: ParentPhotoUpload = { id, mimeType: 'image/jpeg', sizeBytes: 100 };
    this.stagedPhotos.set(id, { studentId, file, filePath });
    return cloneFixtureValue(file);
  }

  async replaceStudentPhoto(studentId: string, input: { fileId: string; expectedVersion: number }, key: string): Promise<ParentGrowthStudent> {
    this.assertAvailable();
    const replay = this.photoSubmissions.get(key);
    if (replay) return cloneFixtureValue(replay);
    const student = this.fixture.profile.student;
    const staged = this.stagedPhotos.get(input.fileId);
    if (!student || student.id !== studentId) throw new ParentDataSourceError(403, 'FORBIDDEN', '无权修改此学员照片');
    if (!staged || staged.studentId !== studentId) throw new ParentDataSourceError(400, 'STUDENT_PHOTO_INVALID', '请重新选择照片');
    if (student.profileVersion !== input.expectedVersion) throw new ParentDataSourceError(409, 'STUDENT_PROFILE_VERSION_CONFLICT', '资料已更新，请刷新后重试');
    student.profileVersion += 1;
    const result: ParentGrowthStudent = { id: student.id, name: student.name, age: student.age,
      profileVersion: student.profileVersion, photo: { ...staged.file, accessUrl: staged.filePath,
        accessUrlExpiresAt: new Date(Date.now() + 900000).toISOString() } };
    this.fixture.updates.student = result;
    this.photoSubmissions.set(key, cloneFixtureValue(result));
    return cloneFixtureValue(result);
  }

  async submitLessonReview(lessonId: string, studentId: string, draft: ParentReviewDraft, key: string): Promise<ParentLessonReview> {
    this.assertAvailable();
    const replay = this.reviewSubmissions.get(key);
    if (replay) return cloneFixtureValue(replay);
    if (studentId !== this.fixture.profile.student?.id) throw new ParentDataSourceError(403, 'FORBIDDEN', '无权评价此学员');
    const record = this.fixture.updates.records.find((item) => item.lessonSessionId === lessonId);
    if (!record || record.lessonStatus !== 'COMPLETED' || record.attendanceStatus !== 'PRESENT') {
      throw new ParentDataSourceError(409, 'PARENT_REVIEW_NOT_ALLOWED', '该课次当前不可评价');
    }
    if (record.review) throw new ParentDataSourceError(409, 'PARENT_REVIEW_ALREADY_EXISTS', '这节课已经评价');
    if (['teaching', 'communication', 'environment', 'overall'].some((field) => {
      const value = draft[field as keyof ParentReviewDraft];
      return typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10;
    }) || draft.note.trim().length > 500) throw new ParentDataSourceError(400, 'VALIDATION_FAILED', '请完整填写四项评分');
    const result: ParentLessonReview = { ...draft, note: draft.note.trim(), id: `mock-review-${lessonId}`,
      lessonSessionId: lessonId, studentId, valid: true, createdAt: new Date().toISOString() };
    record.review = result;
    record.canReview = false;
    this.reviewSubmissions.set(key, cloneFixtureValue(result));
    return cloneFixtureValue(result);
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
