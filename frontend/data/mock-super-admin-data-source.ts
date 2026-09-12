import { SuperAdminMockScenario } from "../config/super-admin-env";
import {
  SUPER_ADMIN_DASHBOARD_FIXTURE,
  SUPER_ADMIN_PARTNER_EARNING_FIXTURE,
  SUPER_ADMIN_PARTNER_EARNING_RULE_FIXTURE,
  SUPER_ADMIN_PROFILE_FIXTURE,
} from "../mock/fixtures/super-admin.fixture";
import {
  SuperAdminAuditLog,
  SuperAdminCampus,
  SuperAdminCampusDetail,
  SuperAdminCampusCustomerServiceQr,
  SuperAdminCampusMapLocation,
  SuperAdminCampusMapLocationInput,
  SuperAdminCreateEarningRuleInput,
  SuperAdminCreatePartnerEarningRuleInput,
  SuperAdminCreateWithdrawalPolicyInput,
  SuperAdminCoursePackageValidityInput,
  SuperAdminCreateStaffAccountInput,
  SuperAdminDashboard,
  SuperAdminEarningRule,
  SuperAdminLessonAdjustmentInput,
  SuperAdminLessonLedgerEntry,
  SuperAdminPage,
  SuperAdminPageQuery,
  SuperAdminPartnerEarning,
  SuperAdminPartnerEarningQuery,
  SuperAdminPartnerEarningRule,
  SuperAdminPartnerEarningRuleQuery,
  SuperAdminProfile,
  SuperAdminRevenuePeriod,
  SuperAdminPayoutProof,
  SuperAdminRolePermission,
  SuperAdminSystemSettings,
  SuperAdminStudentDetail,
  SuperAdminStudentCoursePackage,
  SuperAdminStudentQuery,
  SuperAdminStudentSummary,
  SuperAdminStaffAccount,
  SuperAdminStaffAccountQuery,
  SuperAdminTeacherEarning,
  SuperAdminWithdrawal,
  SuperAdminWithdrawalPolicy,
  SuperAdminUnbindStaffWechatInput,
  SuperAdminUpdateStaffAccountStatusInput,
} from "../types/super-admin";
import {
  GroupCampaignMutationInput,
  GroupCampaignView,
  GroupOrderQuery,
  GroupOrderView,
  GroupPage,
  ManagementCourseProductQuery,
  ManagementCourseProductView,
  ManagementGroupCampaignQuery,
} from "../types/group-buying";
import { SuperAdminDataSource } from "./super-admin-data-source";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class MockSuperAdminDataSource implements SuperAdminDataSource {
  private readonly campus: SuperAdminCampusDetail = {
    id: "10000000-0000-4000-8000-000000000001",
    code: "EAST",
    name: "启明东校区",
    timezone: "Asia/Shanghai",
    contactPhone: "021-55668899",
    address: "上海市浦东新区启明路18号",
    lessonWarningThresholdUnits: 500,
    activeStudentCount: 103,
    teacherCount: 8,
    classCount: 12,
    warningStudentCount: 6,
    monthCompletedLessonCount: 93,
    mainBalanceUnits: 8600,
    giftBalanceUnits: 1200,
    latitude: 28.2282,
    longitude: 112.9388,
    mapVisible: true,
    customerServiceQrCodeUrl: null,
    version: 1,
  };
  private readonly ledger: SuperAdminLessonLedgerEntry[] = [
    {
      id: "ledger-1",
      campusId: "10000000-0000-4000-8000-000000000001",
      campusName: "启明东校区",
      studentId: "student-1",
      studentName: "林一诺",
      coursePackageId: "package-1",
      coursePackageName: "创意美术课包",
      lessonSessionId: "lesson-1",
      entryType: "CONSUME",
      bucket: "MAIN",
      deltaUnits: -100,
      balanceBeforeUnits: 1200,
      balanceAfterUnits: 1100,
      reason: "教师完成课程扣课",
      actorName: "陈老师",
      createdAt: "2026-08-31T08:00:00+08:00",
    },
  ];
  private readonly students: SuperAdminStudentDetail[] = [
    {
      id: "student-1",
      campusId: this.campus.id,
      campusName: this.campus.name,
      displayName: "林一诺",
      birthDate: "2017-04-12",
      classNames: ["创意基础A班", "创意工坊A班"],
      mainBalanceUnits: 1000,
      giftBalanceUnits: 100,
      totalBalanceUnits: 1100,
      warningThresholdUnits: this.campus.lessonWarningThresholdUnits,
      lowBalance: false,
      coursePackages: [
        {
          id: "package-1",
          name: "创意美术课包",
          mainBalanceUnits: 1000,
          giftBalanceUnits: 100,
          totalBalanceUnits: 1100,
          validFrom: "2026-08-01T00:00:00+08:00",
          expiresAt: "2027-07-31T23:59:59+08:00",
          status: "ACTIVE",
          version: 1,
        },
      ],
    },
  ];
  private readonly earnings: SuperAdminTeacherEarning[] = [
    {
      id: "earning-1",
      campusId: this.campus.id,
      teacherId: "teacher-1",
      teacherName: "陈老师",
      amountFen: 10000,
      status: "PENDING_REVIEW",
      reviewableAt: "2026-08-31T08:00:00+08:00",
      reviewedAt: null,
      reviewReason: null,
      createdAt: "2026-08-31T08:00:00+08:00",
      version: 1,
    },
  ];
  private readonly withdrawals: SuperAdminWithdrawal[] = [
    {
      id: "withdrawal-1",
      requestNo: "TX202608310001",
      campusId: this.campus.id,
      teacherId: "teacher-1",
      teacherName: "陈老师",
      amountFen: 10000,
      status: "SUBMITTED",
      requestedAt: "2026-08-31T08:00:00+08:00",
      reviewedAt: null,
      paidAt: null,
      rejectionReason: null,
      failureReason: null,
      payoutReference: null,
      payoutProofFileId: null,
      version: 1,
    },
  ];
  private readonly earningRules: SuperAdminEarningRule[] = [
    {
      id: "rule-1",
      campusId: this.campus.id,
      teacherId: null,
      basisType: "PER_COMPLETED_SESSION",
      unitAmountFen: 10000,
      eligibleLessonKinds: ["REGULAR"],
      countedAttendanceStatuses: ["PRESENT"],
      settlementDelayDays: 0,
      version: 1,
      status: "ACTIVE",
      effectiveFrom: "2026-08-01T00:00:00+08:00",
      effectiveTo: null,
      createdAt: "2026-08-01T00:00:00+08:00",
    },
  ];
  private readonly partnerEarningRules: SuperAdminPartnerEarningRule[] = [
    clone(SUPER_ADMIN_PARTNER_EARNING_RULE_FIXTURE),
  ];
  private readonly partnerEarnings: SuperAdminPartnerEarning[] = [
    clone(SUPER_ADMIN_PARTNER_EARNING_FIXTURE),
  ];
  private readonly adjustmentResults = new Map<
    string,
    SuperAdminLessonLedgerEntry
  >();
  private readonly validityResults = new Map<
    string,
    SuperAdminStudentCoursePackage
  >();
  private readonly campusMapResults = new Map<
    string,
    SuperAdminCampusMapLocation
  >();
  private readonly withdrawalPolicies: SuperAdminWithdrawalPolicy[] = [
    {
      id: "policy-1",
      minimumAmountFen: 10000,
      dailyRequestLimit: 1,
      version: 1,
      status: "ACTIVE",
      effectiveFrom: "2026-08-01T00:00:00+08:00",
      effectiveTo: null,
      createdAt: "2026-08-01T00:00:00+08:00",
    },
  ];
  private readonly groupCampaigns: GroupCampaignView[] = [
    {
      id: "30000000-0000-4000-8000-000000000001",
      code: "GROUP-1990-DEMO",
      campusId: this.campus.id,
      campusName: this.campus.name,
      courseProductId: "31000000-0000-4000-8000-000000000001",
      courseName: "创意体验课",
      title: "19.9 元创意体验课拼团",
      description: "三人同行，每位学员获得五次线下课程。",
      priceFen: 1990,
      maxPaidMembers: 3,
      startsAt: "2026-09-01T00:00:00+08:00",
      endsAt: "2026-09-30T23:59:59+08:00",
      status: "ACTIVE",
      version: 1,
      posterImages: [],
      joinableTeams: [],
      boundStudents: [],
      customerService: {
        name: "陈老师",
        phone: this.campus.contactPhone ?? "",
        qrCodeUrl: null,
      },
      createdAt: "2026-09-01T00:00:00+08:00",
      updatedAt: "2026-09-01T00:00:00+08:00",
    },
  ];
  private readonly groupOrders: GroupOrderView[] = [
    {
      id: "32000000-0000-4000-8000-000000000001",
      orderNo: "GROUP-DEMO-0001",
      campaignId: "30000000-0000-4000-8000-000000000001",
      campaignTitle: "19.9 元创意体验课拼团",
      teamId: "33000000-0000-4000-8000-000000000001",
      memberId: "34000000-0000-4000-8000-000000000001",
      campusId: this.campus.id,
      campusName: this.campus.name,
      studentId: "student-1",
      studentName: "林一诺",
      priceFen: 1990,
      memberStatus: "PAID",
      orderStatus: "PAID",
      teamStatus: "OPEN",
      paidMemberCount: 2,
      grantedMainUnits: null,
      grantedGiftUnits: null,
      paidAt: "2026-09-02T10:00:00+08:00",
      settledAt: null,
      version: 1,
      createdAt: "2026-09-02T09:58:00+08:00",
      updatedAt: "2026-09-02T10:00:00+08:00",
    },
  ];
  private readonly groupMutationResults = new Map<
    string,
    GroupCampaignView | GroupOrderView
  >();
  private readonly staffAccounts: Array<
    SuperAdminStaffAccount & { phone: string }
  > = [
    {
      id: "staff-teacher-1",
      displayName: "陈老师",
      phone: "+8613800138000",
      maskedPhone: "+86****8000",
      roleCode: "TEACHER",
      campusId: "10000000-0000-4000-8000-000000000001",
      campusName: "启明东校区",
      bindingStatus: "BOUND",
      status: "ACTIVE",
      version: 1,
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
    },
    {
      id: "staff-manager-1",
      displayName: "王校长",
      phone: "+8613700137000",
      maskedPhone: "+86****7000",
      roleCode: "CAMPUS_MANAGER",
      campusId: "10000000-0000-4000-8000-000000000001",
      campusName: "启明东校区",
      bindingStatus: "UNBOUND",
      status: "ACTIVE",
      version: 1,
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
    },
  ];
  private readonly staffMutationResults = new Map<
    string,
    SuperAdminStaffAccount
  >();
  constructor(
    private readonly options: { scenario?: SuperAdminMockScenario } = {},
  ) {}

  async getDashboard(
    period: SuperAdminRevenuePeriod = "TODAY",
  ): Promise<SuperAdminDashboard> {
    this.assertAvailable();
    const periodLabel: Record<SuperAdminRevenuePeriod, string> = {
      TODAY: "今日",
      LAST_7_DAYS: "近7天",
      CURRENT_MONTH: "本月",
      HISTORY: "历史",
    };
    if (this.options.scenario === "empty") {
      return {
        ...clone(SUPER_ADMIN_DASHBOARD_FIXTURE),
        campusCount: 0,
        activeStudentCount: 0,
        monthCompletedLessonCount: 0,
        warningStudentCount: 0,
        featuredCampus: null,
        revenue: {
          ...clone(SUPER_ADMIN_DASHBOARD_FIXTURE.revenue),
          period,
          periodLabel: periodLabel[period],
          partnerCount: 0,
          countedAttendeeCount: 0,
          grossLessonRevenueFen: 0,
          partnerEarningFen: 0,
          headquartersRetainedFen: 0,
          campuses: [],
        },
      };
    }
    return {
      ...clone(SUPER_ADMIN_DASHBOARD_FIXTURE),
      revenue: {
        ...clone(SUPER_ADMIN_DASHBOARD_FIXTURE.revenue),
        period,
        periodLabel: periodLabel[period],
      },
    };
  }

  async getProfile(): Promise<SuperAdminProfile> {
    this.assertAvailable();
    return clone(SUPER_ADMIN_PROFILE_FIXTURE);
  }

  async listStaffAccounts(
    query: SuperAdminStaffAccountQuery,
  ): Promise<SuperAdminPage<SuperAdminStaffAccount>> {
    this.assertAvailable();
    const keyword = query.query?.trim().toLocaleLowerCase() ?? "";
    const data =
      this.options.scenario === "empty"
        ? []
        : this.staffAccounts.filter(
            (account) =>
              (!keyword ||
                account.displayName.toLocaleLowerCase().includes(keyword) ||
                account.phone.includes(keyword)) &&
              (!query.roleCode || account.roleCode === query.roleCode) &&
              (!query.campusId || account.campusId === query.campusId) &&
              (!query.status || account.status === query.status),
          );
    return this.page(
      data.map(({ phone: _phone, ...account }) => account),
      query,
    );
  }

  async createStaffAccount(
    input: SuperAdminCreateStaffAccountInput,
    idempotencyKey: string,
  ): Promise<SuperAdminStaffAccount> {
    this.assertAvailable();
    const replay = this.staffMutationResults.get(idempotencyKey);
    if (replay) return clone(replay);
    if ((input.roleCode as string) === "TEACHER") {
      throw new Error("教师请从教师名册录入");
    }
    if (!["CAMPUS_MANAGER", "PARTNER", "HR", "FINANCE"].includes(input.roleCode)) {
      throw new Error("不支持创建该角色账号");
    }
    const headquarters = input.roleCode === "HR" || input.roleCode === "FINANCE";
    if (headquarters && input.campusId !== null) throw new Error("总部账号不能关联校区");
    if (!headquarters && input.campusId !== this.campus.id) throw new Error("所属校区不存在");
    const phone = input.phone.replace(/^\+?86/, "");
    if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error("请输入正确的手机号");
    const normalizedPhone = `+86${phone}`;
    if (
      this.staffAccounts.some((account) => account.phone === normalizedPhone)
    ) {
      throw new Error("该手机号已创建工作人员账号");
    }
    const now = new Date().toISOString();
    const account: SuperAdminStaffAccount & { phone: string } = {
      id: `staff-${this.staffAccounts.length + 1}`,
      displayName: input.displayName.trim(),
      phone: normalizedPhone,
      maskedPhone: `+86****${phone.slice(-4)}`,
      roleCode: input.roleCode,
      campusId: input.campusId,
      campusName: headquarters ? "总部" : this.campus.name,
      bindingStatus: "UNBOUND",
      status: "ACTIVE",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.staffAccounts.unshift(account);
    const { phone: _phone, ...view } = account;
    this.staffMutationResults.set(idempotencyKey, clone(view));
    return clone(view);
  }

  async updateStaffAccountStatus(
    id: string,
    input: SuperAdminUpdateStaffAccountStatusInput,
    idempotencyKey: string,
  ): Promise<SuperAdminStaffAccount> {
    this.assertAvailable();
    const replay = this.staffMutationResults.get(idempotencyKey);
    if (replay) return clone(replay);
    const account = this.requireStaffAccount(id, input.expectedVersion);
    account.status = input.status;
    account.version += 1;
    account.updatedAt = new Date().toISOString();
    const { phone: _phone, ...view } = account;
    this.staffMutationResults.set(idempotencyKey, clone(view));
    return clone(view);
  }

  async unbindStaffWechat(
    id: string,
    input: SuperAdminUnbindStaffWechatInput,
    idempotencyKey: string,
  ): Promise<SuperAdminStaffAccount> {
    this.assertAvailable();
    const replay = this.staffMutationResults.get(idempotencyKey);
    if (replay) return clone(replay);
    const account = this.requireStaffAccount(id, input.expectedVersion);
    account.bindingStatus = "UNBOUND";
    account.version += 1;
    account.updatedAt = new Date().toISOString();
    const { phone: _phone, ...view } = account;
    this.staffMutationResults.set(idempotencyKey, clone(view));
    return clone(view);
  }

  async listCampuses(
    query: SuperAdminPageQuery & { query?: string },
  ): Promise<SuperAdminPage<SuperAdminCampus>> {
    this.assertAvailable();
    const data = this.options.scenario === "empty" ? [] : [this.campus];
    return this.page(data, query);
  }

  async getCampus(id: string): Promise<SuperAdminCampusDetail> {
    this.assertAvailable();
    if (id !== this.campus.id) {
      throw new Error("未找到校区");
    }
    return clone(this.campus);
  }

  async updateCampusMapLocation(
    id: string,
    input: SuperAdminCampusMapLocationInput,
    idempotencyKey: string,
  ): Promise<SuperAdminCampusMapLocation> {
    this.assertAvailable();
    const replay = this.campusMapResults.get(idempotencyKey);
    if (replay) return clone(replay);
    if (id !== this.campus.id) throw new Error("未找到校区");
    if (input.expectedVersion !== this.campus.version) {
      throw new Error("地图配置已更新，请刷新后重试");
    }
    if (!input.address.trim()) throw new Error("请选择地图位置");
    this.campus.address = input.address.trim();
    this.campus.latitude = input.latitude;
    this.campus.longitude = input.longitude;
    this.campus.mapVisible = input.mapVisible;
    this.campus.version += 1;
    const result: SuperAdminCampusMapLocation = {
      id,
      address: this.campus.address,
      latitude: input.latitude,
      longitude: input.longitude,
      mapVisible: input.mapVisible,
      version: this.campus.version,
    };
    this.campusMapResults.set(idempotencyKey, clone(result));
    return clone(result);
  }

  async uploadCampusCustomerServiceQr(
    id: string,
    filePath: string,
    expectedVersion: number,
    _idempotencyKey: string,
  ): Promise<SuperAdminCampusCustomerServiceQr> {
    this.assertAvailable();
    if (id !== this.campus.id) throw new Error("未找到校区");
    if (expectedVersion !== this.campus.version) {
      throw new Error("二维码配置已更新，请刷新后重试");
    }
    this.campus.customerServiceQrCodeUrl = filePath;
    this.campus.version += 1;
    return {
      id,
      customerServiceQrCodeUrl: filePath,
      version: this.campus.version,
    };
  }

  async listStudents(
    query: SuperAdminStudentQuery,
  ): Promise<SuperAdminPage<SuperAdminStudentSummary>> {
    this.assertAvailable();
    const keyword = query.query?.trim().toLocaleLowerCase() ?? "";
    const data =
      this.options.scenario === "empty"
        ? []
        : this.students.filter(
            (student) =>
              (!query.campusId || student.campusId === query.campusId) &&
              (!keyword ||
                student.displayName.toLocaleLowerCase().includes(keyword)),
          );
    return this.page(
      data.map(({ coursePackages: _coursePackages, ...student }) => student),
      query,
    );
  }

  async getStudent(id: string): Promise<SuperAdminStudentDetail> {
    this.assertAvailable();
    const student = this.students.find((item) => item.id === id);
    if (!student) throw new Error("未找到学员");
    return clone(student);
  }

  async updateCoursePackageValidity(
    id: string,
    input: SuperAdminCoursePackageValidityInput,
    idempotencyKey: string,
  ): Promise<SuperAdminStudentCoursePackage> {
    this.assertAvailable();
    const replay = this.validityResults.get(idempotencyKey);
    if (replay) return clone(replay);
    const student = this.students.find((candidate) =>
      candidate.coursePackages.some((coursePackage) => coursePackage.id === id),
    );
    const coursePackage = student?.coursePackages.find(
      (candidate) => candidate.id === id,
    );
    if (!student || !coursePackage) throw new Error("未找到课包");
    if (coursePackage.version !== input.expectedVersion) {
      throw new Error("课包已被其他操作更新，请刷新后重试");
    }
    const validFrom = new Date(input.validFrom);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (
      Number.isNaN(validFrom.getTime()) ||
      (expiresAt &&
        (Number.isNaN(expiresAt.getTime()) || expiresAt <= validFrom))
    ) {
      throw new Error("结束日期必须晚于开始日期");
    }
    coursePackage.validFrom = input.validFrom;
    coursePackage.expiresAt = input.expiresAt;
    coursePackage.version += 1;
    coursePackage.status = this.packageStatus(coursePackage);
    this.recomputeStudentBalances(student);
    this.validityResults.set(idempotencyKey, clone(coursePackage));
    return clone(coursePackage);
  }

  async listLessonLedger(
    query: SuperAdminPageQuery & { campusId?: string; entryType?: string },
  ): Promise<SuperAdminPage<SuperAdminLessonLedgerEntry>> {
    this.assertAvailable();
    const data = this.options.scenario === "empty" ? [] : this.ledger;
    return this.page(data, query);
  }

  async adjustLessonLedger(
    input: SuperAdminLessonAdjustmentInput,
    idempotencyKey: string,
  ): Promise<SuperAdminLessonLedgerEntry> {
    this.assertAvailable();
    if (!idempotencyKey.trim()) throw new Error("幂等标识不能为空");
    const replay = this.adjustmentResults.get(idempotencyKey);
    if (replay) return clone(replay);
    const student = this.students.find((candidate) =>
      candidate.coursePackages.some(
        (coursePackage) => coursePackage.id === input.coursePackageId,
      ),
    );
    const coursePackage = student?.coursePackages.find(
      (candidate) => candidate.id === input.coursePackageId,
    );
    if (!student || !coursePackage) throw new Error("未找到课包");
    const before =
      input.bucket === "MAIN"
        ? coursePackage.mainBalanceUnits
        : coursePackage.giftBalanceUnits;
    if (before + input.deltaUnits < 0) throw new Error("调整后课时不能小于零");
    const previous = this.ledger.find(
      (item) => item.coursePackageId === input.coursePackageId,
    );
    const entry: SuperAdminLessonLedgerEntry = {
      ...(previous ?? this.ledger[0]),
      id: `adjustment-${idempotencyKey}`,
      entryType: "ADJUSTMENT",
      coursePackageId: input.coursePackageId,
      bucket: input.bucket,
      deltaUnits: input.deltaUnits,
      balanceBeforeUnits: before,
      balanceAfterUnits: before + input.deltaUnits,
      reason: input.reason,
      actorName: "系统管理员",
      createdAt: new Date().toISOString(),
    };
    if (input.bucket === "MAIN") {
      coursePackage.mainBalanceUnits = entry.balanceAfterUnits;
    } else {
      coursePackage.giftBalanceUnits = entry.balanceAfterUnits;
    }
    coursePackage.totalBalanceUnits =
      coursePackage.mainBalanceUnits + coursePackage.giftBalanceUnits;
    coursePackage.version += 1;
    this.recomputeStudentBalances(student);
    this.ledger.unshift(entry);
    this.adjustmentResults.set(idempotencyKey, clone(entry));
    return clone(entry);
  }

  async getSystemSettings(): Promise<SuperAdminSystemSettings> {
    this.assertAvailable();
    return {
      reportingTimeZone: "Asia/Shanghai",
      paymentMode: "模拟/人工",
      payoutMode: "线下人工打款",
      fileStorageMode: "本地存储适配器",
      realPaymentEnabled: false,
      automaticPayoutEnabled: false,
      automaticProfitSharingEnabled: false,
      roleCount: 6,
    };
  }

  async getRolePermissions(): Promise<SuperAdminRolePermission[]> {
    this.assertAvailable();
    return [
      {
        roleCode: "PARENT",
        roleLabel: "家长",
        permissions: ["PARENT_HOME_READ"],
      },
      { roleCode: "PARTNER", roleLabel: "合作方校区", permissions: [] },
      {
        roleCode: "TEACHER",
        roleLabel: "授课老师",
        permissions: ["TEACHER_SCHEDULE_READ"],
      },
      { roleCode: "OPERATOR", roleLabel: "招商招生运营", permissions: [] },
      {
        roleCode: "CAMPUS_MANAGER",
        roleLabel: "分校区管理员",
        permissions: ["CAMPUS_DASHBOARD_READ"],
      },
      {
        roleCode: "SUPER_ADMIN",
        roleLabel: "超级管理员",
        permissions: ["GLOBAL_DASHBOARD_READ", "GLOBAL_STUDENT_READ"],
      },
    ];
  }

  async listAuditLogs(
    query: SuperAdminPageQuery & { action?: string },
  ): Promise<SuperAdminPage<SuperAdminAuditLog>> {
    this.assertAvailable();
    const logs: SuperAdminAuditLog[] = [
      {
        id: "audit-1",
        action: "LESSON_LEDGER_ADJUST",
        resourceType: "CoursePackage",
        resourceId: "package-1",
        outcome: "SUCCESS",
        details: { reason: "后台核对调整" },
        actorName: "系统管理员",
        campusName: "启明东校区",
        createdAt: "2026-08-31T08:00:00+08:00",
      },
    ];
    return this.page(this.options.scenario === "empty" ? [] : logs, query);
  }

  async listEarningRules(
    query: SuperAdminPageQuery,
  ): Promise<SuperAdminPage<SuperAdminEarningRule>> {
    return this.page(
      this.options.scenario === "empty" ? [] : this.earningRules,
      query,
    );
  }

  async createEarningRule(
    input: SuperAdminCreateEarningRuleInput,
  ): Promise<SuperAdminEarningRule> {
    const rule: SuperAdminEarningRule = {
      id: `rule-${Date.now()}`,
      ...input,
      version: 1,
      status: "DRAFT",
      effectiveTo: null,
      createdAt: new Date().toISOString(),
    };
    this.earningRules.unshift(rule);
    return clone(rule);
  }

  async transitionEarningRule(
    id: string,
    action: "activate" | "retire",
    version: number,
  ): Promise<SuperAdminEarningRule> {
    const rule = this.earningRules.find((item) => item.id === id);
    if (!rule || rule.version !== version) throw new Error("课时费规则已更新");
    rule.status = action === "activate" ? "ACTIVE" : "RETIRED";
    rule.version += 1;
    return clone(rule);
  }

  async listTeacherEarnings(
    query: SuperAdminPageQuery & { status?: string },
  ): Promise<SuperAdminPage<SuperAdminTeacherEarning>> {
    return this.page(
      this.options.scenario === "empty" ? [] : this.earnings,
      query,
    );
  }

  async reviewTeacherEarning(
    id: string,
    action: "approve" | "reject",
    version: number,
    reason: string | undefined,
  ): Promise<SuperAdminTeacherEarning> {
    const entry = this.earnings.find((item) => item.id === id);
    if (!entry || entry.version !== version) throw new Error("收益记录已更新");
    entry.status = action === "approve" ? "AVAILABLE" : "REJECTED";
    entry.reviewReason = reason ?? null;
    entry.version += 1;
    return clone(entry);
  }

  async listPartnerEarningRules(
    query: SuperAdminPartnerEarningRuleQuery,
  ): Promise<SuperAdminPage<SuperAdminPartnerEarningRule>> {
    this.assertAvailable();
    const data =
      this.options.scenario === "empty"
        ? []
        : this.partnerEarningRules.filter(
            (item) =>
              (!query.campusId || item.campusId === query.campusId) &&
              (!query.status || item.status === query.status),
          );
    return this.page(data, query);
  }

  async createPartnerEarningRule(
    input: SuperAdminCreatePartnerEarningRuleInput,
  ): Promise<SuperAdminPartnerEarningRule> {
    this.assertAvailable();
    const latestVersion = this.partnerEarningRules
      .filter((item) => item.campusId === input.campusId)
      .reduce((latest, item) => Math.max(latest, item.version), 0);
    const rule: SuperAdminPartnerEarningRule = {
      id: `partner-rule-${Date.now()}`,
      campusName: this.campus.name,
      ...input,
      version: latestVersion + 1,
      status: "DRAFT",
      effectiveTo: null,
      createdAt: new Date().toISOString(),
    };
    this.partnerEarningRules.unshift(rule);
    return clone(rule);
  }

  async transitionPartnerEarningRule(
    id: string,
    action: "activate" | "retire",
    version: number,
  ): Promise<SuperAdminPartnerEarningRule> {
    this.assertAvailable();
    const rule = this.partnerEarningRules.find((item) => item.id === id);
    if (!rule || rule.version !== version) {
      throw new Error("合作方分成规则已更新");
    }
    rule.status = action === "activate" ? "ACTIVE" : "RETIRED";
    rule.version += 1;
    return clone(rule);
  }

  async listPartnerEarnings(
    query: SuperAdminPartnerEarningQuery,
  ): Promise<SuperAdminPage<SuperAdminPartnerEarning>> {
    this.assertAvailable();
    const data =
      this.options.scenario === "empty"
        ? []
        : this.partnerEarnings.filter(
            (item) =>
              (!query.campusId || item.campusId === query.campusId) &&
              (!query.status || item.status === query.status),
          );
    return this.page(data, query);
  }

  async reviewPartnerEarning(
    id: string,
    action: "approve" | "reject",
    version: number,
    reason: string | undefined,
  ): Promise<SuperAdminPartnerEarning> {
    this.assertAvailable();
    const entry = this.partnerEarnings.find((item) => item.id === id);
    if (
      !entry ||
      entry.version !== version ||
      entry.status !== "PENDING_REVIEW"
    ) {
      throw new Error("合作方收益记录已更新");
    }
    if (action === "reject" && !reason?.trim()) {
      throw new Error("请填写驳回原因");
    }
    entry.status = action === "approve" ? "AVAILABLE" : "REJECTED";
    entry.reviewReason = action === "reject" ? (reason?.trim() ?? null) : null;
    entry.reviewedAt = new Date().toISOString();
    entry.version += 1;
    return clone(entry);
  }

  async listWithdrawalPolicies(
    query: SuperAdminPageQuery,
  ): Promise<SuperAdminPage<SuperAdminWithdrawalPolicy>> {
    return this.page(
      this.options.scenario === "empty" ? [] : this.withdrawalPolicies,
      query,
    );
  }

  async createWithdrawalPolicy(
    input: SuperAdminCreateWithdrawalPolicyInput,
  ): Promise<SuperAdminWithdrawalPolicy> {
    const policy: SuperAdminWithdrawalPolicy = {
      id: `policy-${Date.now()}`,
      ...input,
      version: 1,
      status: "DRAFT",
      effectiveTo: null,
      createdAt: new Date().toISOString(),
    };
    this.withdrawalPolicies.unshift(policy);
    return clone(policy);
  }

  async transitionWithdrawalPolicy(
    id: string,
    action: "activate" | "retire",
    version: number,
  ): Promise<SuperAdminWithdrawalPolicy> {
    const policy = this.withdrawalPolicies.find((item) => item.id === id);
    if (!policy || policy.version !== version)
      throw new Error("提现策略已更新");
    policy.status = action === "activate" ? "ACTIVE" : "RETIRED";
    policy.version += 1;
    return clone(policy);
  }

  async listWithdrawals(
    query: SuperAdminPageQuery & { status?: string },
  ): Promise<SuperAdminPage<SuperAdminWithdrawal>> {
    return this.page(
      this.options.scenario === "empty" ? [] : this.withdrawals,
      query,
    );
  }

  async transitionWithdrawal(
    id: string,
    action: "approve" | "reject" | "mark-paying" | "mark-failed",
    version: number,
    reason: string | undefined,
  ): Promise<SuperAdminWithdrawal> {
    const item = this.withdrawals.find((entry) => entry.id === id);
    if (!item || item.version !== version) throw new Error("提现记录已更新");
    const next = {
      approve: "APPROVED",
      reject: "REJECTED",
      "mark-paying": "PAYING",
      "mark-failed": "FAILED",
    } as const;
    item.status = next[action];
    item.version += 1;
    if (action === "reject") item.rejectionReason = reason ?? null;
    if (action === "mark-failed") item.failureReason = reason ?? null;
    return clone(item);
  }

  async uploadPayoutProof(filePath: string): Promise<SuperAdminPayoutProof> {
    return {
      id: `proof-${Date.now()}`,
      originalName: filePath.split(/[\\/]/).pop() ?? "打款凭证.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      sha256: "0".repeat(64),
      createdAt: new Date().toISOString(),
    };
  }

  async markWithdrawalPaid(
    id: string,
    version: number,
    payoutReference: string,
    payoutProofFileId: string,
  ): Promise<SuperAdminWithdrawal> {
    const item = this.withdrawals.find((entry) => entry.id === id);
    if (!item || item.version !== version || item.status !== "PAYING")
      throw new Error("提现记录当前不可完成");
    item.status = "PAID";
    item.version += 1;
    item.payoutReference = payoutReference;
    item.payoutProofFileId = payoutProofFileId;
    item.paidAt = new Date().toISOString();
    return clone(item);
  }

  async listGroupCampaigns(
    query: ManagementGroupCampaignQuery,
  ): Promise<GroupPage<GroupCampaignView>> {
    this.assertAvailable();
    const data =
      this.options.scenario === "empty"
        ? []
        : this.groupCampaigns.filter(
            (item) =>
              (!query.campusId || item.campusId === query.campusId) &&
              (!query.status || item.status === query.status),
          );
    return this.groupPage(data, query);
  }

  async listCourseProducts(
    query: ManagementCourseProductQuery,
  ): Promise<GroupPage<ManagementCourseProductView>> {
    this.assertAvailable();
    const data = this.options.scenario === "empty"
      ? []
      : this.groupCampaigns
          .map((campaign) => ({
            id: campaign.courseProductId,
            campusId: campaign.campusId,
            campusName: campaign.campusName,
            name: campaign.courseName,
            summary: campaign.description,
            coverFileId: null,
            priceFen: campaign.priceFen,
            mainUnits: 100,
            giftUnits: 0,
            validityDays: 365,
            status: "ACTIVE" as const,
            version: 1,
            createdAt: campaign.createdAt,
            updatedAt: campaign.updatedAt,
          }))
          .filter(
            (product) =>
              (!query.campusId || product.campusId === query.campusId) &&
              (!query.status || product.status === query.status),
          );
    return this.groupPage(data, query);
  }

  async createGroupCampaign(
    input: GroupCampaignMutationInput,
    idempotencyKey: string,
  ): Promise<GroupCampaignView> {
    this.assertAvailable();
    const replay = this.groupMutationResults.get(idempotencyKey);
    if (replay && "code" in replay) return clone(replay);
    const now = new Date().toISOString();
    const campaign: GroupCampaignView = {
      id: `mock-group-campaign-${Date.now()}`,
      code: `GROUP-${Date.now()}`,
      ...input,
      campusName: this.campus.name,
      courseName:
        this.groupCampaigns.find(
          (item) => item.courseProductId === input.courseProductId,
        )?.courseName ?? "线下体验课",
      maxPaidMembers: 3,
      status: "DRAFT",
      version: 1,
      posterImages: [],
      joinableTeams: [],
      boundStudents: [],
      customerService: {
        name: "校区客服",
        phone: this.campus.contactPhone ?? "",
        qrCodeUrl: null,
      },
      createdAt: now,
      updatedAt: now,
    };
    this.groupCampaigns.unshift(campaign);
    this.groupMutationResults.set(idempotencyKey, clone(campaign));
    return clone(campaign);
  }

  async updateGroupCampaign(
    id: string,
    input: GroupCampaignMutationInput,
    version: number,
    idempotencyKey: string,
  ): Promise<GroupCampaignView> {
    this.assertAvailable();
    const replay = this.groupMutationResults.get(idempotencyKey);
    if (replay && "code" in replay) return clone(replay);
    const campaign = this.requireGroupCampaign(id, version);
    if (campaign.status !== "DRAFT") throw new Error("只有草稿活动可以修改");
    Object.assign(campaign, input, {
      version: campaign.version + 1,
      updatedAt: new Date().toISOString(),
    });
    this.groupMutationResults.set(idempotencyKey, clone(campaign));
    return clone(campaign);
  }

  async transitionGroupCampaign(
    id: string,
    action: "activate" | "close" | "cancel",
    version: number,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<GroupCampaignView> {
    this.assertAvailable();
    const replay = this.groupMutationResults.get(idempotencyKey);
    if (replay && "code" in replay) return clone(replay);
    const campaign = this.requireGroupCampaign(id, version);
    if (action === "cancel" && !reason?.trim())
      throw new Error("请填写取消原因");
    campaign.status =
      action === "activate"
        ? "ACTIVE"
        : action === "close"
          ? "CLOSED"
          : "CANCELLED";
    campaign.version += 1;
    campaign.updatedAt = new Date().toISOString();
    if (action === "close") this.settleMockCampaign(campaign.id);
    if (action === "cancel") this.cancelMockCampaign(campaign.id);
    this.groupMutationResults.set(idempotencyKey, clone(campaign));
    return clone(campaign);
  }

  async uploadGroupCampaignPoster(
    id: string,
    filePath: string,
    version: number,
    idempotencyKey: string,
  ): Promise<GroupCampaignView> {
    this.assertAvailable();
    const replay = this.groupMutationResults.get(idempotencyKey);
    if (replay && "code" in replay) return clone(replay);
    const campaign = this.requireMutableGroupCampaign(id, version);
    if (campaign.posterImages.length >= 6)
      throw new Error("每个活动最多上传 6 张海报");
    campaign.posterImages.push({
      id: `mock-poster-${Date.now()}-${campaign.posterImages.length}`,
      storedFileId: `mock-poster-file-${Date.now()}-${campaign.posterImages.length}`,
      sortOrder: campaign.posterImages.length,
      mimeType:
        filePath.toLowerCase().endsWith(".jpg") ||
        filePath.toLowerCase().endsWith(".jpeg")
          ? "image/jpeg"
          : "image/png",
      sizeBytes: 1,
      accessUrl: filePath,
      accessUrlExpiresAt: "2099-12-31T23:59:59.000Z",
    });
    campaign.version += 1;
    campaign.updatedAt = new Date().toISOString();
    this.groupMutationResults.set(idempotencyKey, clone(campaign));
    return clone(campaign);
  }

  async reorderGroupCampaignPosters(
    id: string,
    posterIds: string[],
    version: number,
    idempotencyKey: string,
  ): Promise<GroupCampaignView> {
    this.assertAvailable();
    const replay = this.groupMutationResults.get(idempotencyKey);
    if (replay && "code" in replay) return clone(replay);
    const campaign = this.requireMutableGroupCampaign(id, version);
    const posters = new Map(
      campaign.posterImages.map((poster) => [poster.id, poster]),
    );
    if (
      posterIds.length !== posters.size ||
      posterIds.some((posterId) => !posters.has(posterId))
    ) {
      throw new Error("海报顺序已变化，请刷新后重试");
    }
    campaign.posterImages = posterIds.map((posterId, sortOrder) => ({
      ...posters.get(posterId)!,
      sortOrder,
    }));
    campaign.version += 1;
    campaign.updatedAt = new Date().toISOString();
    this.groupMutationResults.set(idempotencyKey, clone(campaign));
    return clone(campaign);
  }

  async detachGroupCampaignPoster(
    id: string,
    posterId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<GroupCampaignView> {
    this.assertAvailable();
    const replay = this.groupMutationResults.get(idempotencyKey);
    if (replay && "code" in replay) return clone(replay);
    const campaign = this.requireMutableGroupCampaign(id, version);
    if (!campaign.posterImages.some((poster) => poster.id === posterId))
      throw new Error("海报已移除");
    campaign.posterImages = campaign.posterImages
      .filter((poster) => poster.id !== posterId)
      .map((poster, sortOrder) => ({ ...poster, sortOrder }));
    campaign.version += 1;
    campaign.updatedAt = new Date().toISOString();
    this.groupMutationResults.set(idempotencyKey, clone(campaign));
    return clone(campaign);
  }

  async listGroupOrders(
    query: GroupOrderQuery,
  ): Promise<GroupPage<GroupOrderView>> {
    this.assertAvailable();
    const data =
      this.options.scenario === "empty"
        ? []
        : this.groupOrders.filter(
            (item) =>
              (!query.campusId || item.campusId === query.campusId) &&
              (!query.status || item.memberStatus === query.status),
          );
    return this.groupPage(data, query);
  }

  async refundGroupOrder(
    id: string,
    version: number,
    reason: string,
    idempotencyKey: string,
  ): Promise<GroupOrderView> {
    this.assertAvailable();
    const replay = this.groupMutationResults.get(idempotencyKey);
    if (replay && "orderNo" in replay) return clone(replay);
    const order = this.groupOrders.find((item) => item.id === id);
    if (!order || order.version !== version) throw new Error("拼团订单已更新");
    if (!reason.trim()) throw new Error("请填写退款原因");
    if (!["PAID", "SETTLED"].includes(order.memberStatus))
      throw new Error("当前订单不可退款");
    order.memberStatus = "REFUNDED";
    order.orderStatus = "REFUNDED";
    order.version += 1;
    order.updatedAt = new Date().toISOString();
    this.groupMutationResults.set(idempotencyKey, clone(order));
    return clone(order);
  }

  private requireGroupCampaign(id: string, version: number): GroupCampaignView {
    const campaign = this.groupCampaigns.find((item) => item.id === id);
    if (!campaign || campaign.version !== version)
      throw new Error("拼团活动已更新");
    return campaign;
  }

  private requireStaffAccount(
    id: string,
    expectedVersion: number,
  ): SuperAdminStaffAccount & { phone: string } {
    const account = this.staffAccounts.find((item) => item.id === id);
    if (!account) throw new Error("工作人员账号不存在或当前不可用");
    if (account.version !== expectedVersion) {
      throw new Error("账号状态已更新，请刷新后重试");
    }
    return account;
  }

  private requireMutableGroupCampaign(
    id: string,
    version: number,
  ): GroupCampaignView {
    const campaign = this.requireGroupCampaign(id, version);
    if (!["DRAFT", "ACTIVE"].includes(campaign.status))
      throw new Error("已结束活动不能修改海报");
    return campaign;
  }

  private settleMockCampaign(campaignId: string): void {
    for (const order of this.groupOrders.filter(
      (item) => item.campaignId === campaignId && item.memberStatus === "PAID",
    )) {
      const count = Math.max(1, Math.min(3, order.paidMemberCount));
      order.memberStatus = "SETTLED";
      order.orderStatus = "EFFECTIVE";
      order.teamStatus = "SETTLED";
      order.grantedMainUnits = 100;
      order.grantedGiftUnits = count === 1 ? 0 : count === 2 ? 200 : 400;
      order.settledAt = new Date().toISOString();
      order.version += 1;
    }
  }

  private cancelMockCampaign(campaignId: string): void {
    for (const order of this.groupOrders.filter(
      (item) => item.campaignId === campaignId && item.memberStatus === "PAID",
    )) {
      order.memberStatus = "REFUNDED";
      order.orderStatus = "REFUNDED";
      order.teamStatus = "CANCELLED";
      order.version += 1;
    }
  }

  private groupPage<T>(
    data: T[],
    query: { page: number; pageSize: number },
  ): GroupPage<T> {
    const start = (query.page - 1) * query.pageSize;
    return {
      data: clone(data.slice(start, start + query.pageSize)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: data.length,
        totalPages:
          data.length === 0 ? 0 : Math.ceil(data.length / query.pageSize),
      },
    };
  }

  private packageStatus(
    coursePackage: SuperAdminStudentCoursePackage,
  ): SuperAdminStudentCoursePackage["status"] {
    if (coursePackage.status === "INACTIVE") return "INACTIVE";
    const now = new Date();
    if (new Date(coursePackage.validFrom) > now) return "UPCOMING";
    if (coursePackage.expiresAt && new Date(coursePackage.expiresAt) < now) {
      return "EXPIRED";
    }
    return "ACTIVE";
  }

  private recomputeStudentBalances(student: SuperAdminStudentDetail): void {
    for (const coursePackage of student.coursePackages) {
      coursePackage.status = this.packageStatus(coursePackage);
    }
    const activePackages = student.coursePackages.filter(
      (coursePackage) => coursePackage.status === "ACTIVE",
    );
    student.mainBalanceUnits = activePackages.reduce(
      (total, coursePackage) => total + coursePackage.mainBalanceUnits,
      0,
    );
    student.giftBalanceUnits = activePackages.reduce(
      (total, coursePackage) => total + coursePackage.giftBalanceUnits,
      0,
    );
    student.totalBalanceUnits =
      student.mainBalanceUnits + student.giftBalanceUnits;
    student.lowBalance =
      student.totalBalanceUnits <= student.warningThresholdUnits;
  }

  private page<T>(data: T[], query: SuperAdminPageQuery): SuperAdminPage<T> {
    const start = (query.page - 1) * query.pageSize;
    return {
      data: clone(data.slice(start, start + query.pageSize)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: data.length,
        totalPages:
          data.length === 0 ? 0 : Math.ceil(data.length / query.pageSize),
      },
    };
  }

  private assertAvailable(): void {
    if (this.options.scenario === "error") {
      throw new Error("总端数据加载失败，请稍后重试");
    }
  }
}
