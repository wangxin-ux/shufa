import { PartnerMockScenario } from '../config/partner-env';
import {
  PARTNER_ATTENDANCE_FIXTURE,
  PARTNER_DASHBOARD_FIXTURE,
  PARTNER_EARNINGS_FIXTURE,
  PARTNER_EARNING_RULE_FIXTURE,
  PARTNER_LESSON_ACCOUNT_FIXTURE,
  PARTNER_OPERATIONS_SUMMARY_FIXTURE,
  PARTNER_PROFILE_FIXTURE,
  PARTNER_STUDENTS_FIXTURE,
  PARTNER_STUDENT_DETAILS_FIXTURE,
  PARTNER_TEACHERS_FIXTURE,
  PARTNER_WARNINGS_FIXTURE,
} from '../mock/fixtures/partner.fixture';
import {
  PartnerAttendance,
  PartnerDashboard,
  PartnerEarningEntry,
  PartnerEarningPeriodQuery,
  PartnerEarningQuery,
  PartnerEarningRule,
  PartnerEarningSummary,
  PartnerLessonAccount,
  PartnerOperationsSummary,
  PartnerPage,
  PartnerPageQuery,
  PartnerProfile,
  PartnerPeriodQuery,
  PartnerSearchQuery,
  PartnerStudent,
  PartnerStudentDetail,
  PartnerTeacher,
  PartnerWarning,
} from '../types/partner';
import {
  GroupPage,
  GroupPromotionCampaignQuery,
  GroupPromotionCampaignView,
} from '../types/group-buying';
import { GROUP_PROMOTION_CAMPAIGN_FIXTURE } from '../mock/fixtures/group-promotion.fixture';
import { PartnerDataSource, PartnerDataSourceError } from './partner-data-source';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class MockPartnerDataSource implements PartnerDataSource {
  constructor(
    private readonly options: { scenario?: PartnerMockScenario } = {},
  ) {}

  async getDashboard(): Promise<PartnerDashboard> {
    this.assertAvailable();
    if (this.options.scenario === 'empty') {
      return {
        ...clone(PARTNER_DASHBOARD_FIXTURE),
        activeStudentCount: 0,
        activeClassCount: 0,
        activeTeacherCount: 0,
        remainingMainUnits: 0,
        remainingGiftUnits: 0,
        monthConsumedUnits: 0,
        attendanceRateBasisPoints: null,
        highlight: null,
      };
    }
    return clone(PARTNER_DASHBOARD_FIXTURE);
  }

  async getProfile(): Promise<PartnerProfile> {
    this.assertAvailable();
    return clone(PARTNER_PROFILE_FIXTURE);
  }

  async listGroupPromotionCampaigns(
    query: GroupPromotionCampaignQuery,
  ): Promise<GroupPage<GroupPromotionCampaignView>> {
    this.assertAvailable();
    const data =
      this.options.scenario === 'empty'
        ? []
        : [GROUP_PROMOTION_CAMPAIGN_FIXTURE];
    const page = this.nestedPage(data, query);
    return { data: page.items, meta: page.meta };
  }

  async getGroupPromotionCampaign(
    id: string,
  ): Promise<GroupPromotionCampaignView> {
    this.assertAvailable();
    if (
      this.options.scenario === 'empty' ||
      id !== GROUP_PROMOTION_CAMPAIGN_FIXTURE.id
    ) {
      throw new PartnerDataSourceError(
        404,
        'RESOURCE_NOT_FOUND',
        '未找到拼团活动',
      );
    }
    return clone(GROUP_PROMOTION_CAMPAIGN_FIXTURE);
  }

  async listStudents(
    query: PartnerSearchQuery,
  ): Promise<PartnerPage<PartnerStudent>> {
    return this.searchPage(PARTNER_STUDENTS_FIXTURE, query, (item) =>
      item.displayName,
    );
  }

  async getStudent(studentId: string): Promise<PartnerStudentDetail> {
    this.assertAvailable();
    const detail = PARTNER_STUDENT_DETAILS_FIXTURE.find(
      (item) => item.id === studentId,
    );
    if (!detail) {
      throw new PartnerDataSourceError(
        404,
        'RESOURCE_NOT_FOUND',
        '未找到该学员',
      );
    }
    return clone(detail);
  }

  async getOperationsSummary(
    query: PartnerPeriodQuery,
  ): Promise<PartnerOperationsSummary> {
    this.assertAvailable();
    if (this.options.scenario === 'empty') {
      return {
        ...clone(PARTNER_OPERATIONS_SUMMARY_FIXTURE),
        period: query.period,
        anchorDate: query.anchorDate ?? PARTNER_OPERATIONS_SUMMARY_FIXTURE.anchorDate,
        consumedLessonUnits: 0,
        completedLessonCount: 0,
        presentCount: 0,
        absentCount: 0,
        leaveCount: 0,
        recordedCount: 0,
        attendanceRateBasisPoints: null,
        teacherMetrics: [],
      };
    }
    return {
      ...clone(PARTNER_OPERATIONS_SUMMARY_FIXTURE),
      period: query.period,
      anchorDate: query.anchorDate ?? PARTNER_OPERATIONS_SUMMARY_FIXTURE.anchorDate,
    };
  }

  async listWarnings(
    query: PartnerSearchQuery,
  ): Promise<PartnerPage<PartnerWarning>> {
    return this.searchPage(PARTNER_WARNINGS_FIXTURE, query, (item) =>
      item.studentName,
    );
  }

  async getAttendance(query: PartnerPageQuery): Promise<PartnerAttendance> {
    this.assertAvailable();
    const data = this.options.scenario === 'empty' ? [] : PARTNER_ATTENDANCE_FIXTURE.items;
    return {
      ...clone(PARTNER_ATTENDANCE_FIXTURE),
      ...(this.options.scenario === 'empty'
        ? {
            presentCount: 0,
            absentCount: 0,
            leaveCount: 0,
            recordedCount: 0,
            attendanceRateBasisPoints: null,
          }
        : {}),
      ...this.nestedPage(data, query),
    };
  }

  async listTeachers(
    query: PartnerSearchQuery,
  ): Promise<PartnerPage<PartnerTeacher>> {
    return this.searchPage(PARTNER_TEACHERS_FIXTURE, query, (item) =>
      item.displayName,
    );
  }

  async getLessonAccount(query: PartnerPageQuery): Promise<PartnerLessonAccount> {
    this.assertAvailable();
    const data = this.options.scenario === 'empty' ? [] : PARTNER_LESSON_ACCOUNT_FIXTURE.items;
    return {
      ...clone(PARTNER_LESSON_ACCOUNT_FIXTURE),
      ...(this.options.scenario === 'empty'
        ? { mainBalanceUnits: 0, giftBalanceUnits: 0, totalBalanceUnits: 0 }
        : {}),
      ...this.nestedPage(data, query),
    };
  }

  async getEarningSummary(
    query: PartnerEarningPeriodQuery = {},
  ): Promise<PartnerEarningSummary> {
    this.assertAvailable();
    const entries = this.earningEntries(query);
    return {
      estimatedTotalFen: entries.reduce((sum, item) => sum + item.amountFen, 0),
      pendingReviewFen: entries
        .filter((item) => item.status === 'PENDING_REVIEW')
        .reduce((sum, item) => sum + item.amountFen, 0),
      availableFen: entries
        .filter((item) => item.status === 'AVAILABLE')
        .reduce((sum, item) => sum + item.amountFen, 0),
      reversedNetFen: entries
        .filter((item) => item.entryType === 'REVERSAL')
        .reduce((sum, item) => sum + item.amountFen, 0),
      currency: 'CNY',
    };
  }

  async getCurrentEarningRule(): Promise<PartnerEarningRule | null> {
    this.assertAvailable();
    return this.options.scenario === 'empty'
      ? null
      : clone(PARTNER_EARNING_RULE_FIXTURE);
  }

  async listEarnings(
    query: PartnerEarningQuery,
  ): Promise<PartnerPage<PartnerEarningEntry>> {
    this.assertAvailable();
    const source = this.earningEntries(query).filter(
      (item) => !query.status || item.status === query.status,
    );
    const page = this.nestedPage(source, query);
    return { data: page.items, meta: page.meta };
  }

  private searchPage<T>(
    source: T[],
    query: PartnerSearchQuery,
    text: (item: T) => string,
  ): PartnerPage<T> {
    this.assertAvailable();
    const keyword = query.query?.trim().toLocaleLowerCase('zh-CN');
    const data =
      this.options.scenario === 'empty'
        ? []
        : source.filter(
            (item) =>
              !keyword ||
              text(item).toLocaleLowerCase('zh-CN').includes(keyword),
          );
    const page = this.nestedPage(data, query);
    return { data: page.items, meta: page.meta };
  }

  private earningEntries(
    query: PartnerEarningPeriodQuery,
  ): PartnerEarningEntry[] {
    if (this.options.scenario === 'empty') return [];
    return PARTNER_EARNINGS_FIXTURE.filter((item) =>
      matchesEarningPeriod(item.completedAt, query),
    );
  }

  private nestedPage<T>(source: T[], query: PartnerPageQuery) {
    const start = (query.page - 1) * query.pageSize;
    return {
      items: clone(source.slice(start, start + query.pageSize)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: source.length,
        totalPages:
          source.length === 0 ? 0 : Math.ceil(source.length / query.pageSize),
      },
    };
  }

  private assertAvailable(): void {
    if (this.options.scenario === 'error') {
      throw new Error('合作方端数据加载失败，请稍后重试');
    }
  }
}

function matchesEarningPeriod(
  completedAt: string,
  query: PartnerEarningPeriodQuery,
): boolean {
  if (!query.period && !query.anchorDate) return true;
  const completed = toShanghaiDateParts(completedAt);
  const anchor = query.anchorDate
    ? parseDateParts(query.anchorDate)
    : toShanghaiDateParts(new Date().toISOString());
  if (!completed || !anchor) return false;
  const period = query.period ?? 'MONTH';
  if (completed.year !== anchor.year) return false;
  if (period === 'DAY') {
    return completed.month === anchor.month && completed.day === anchor.day;
  }
  if (period === 'MONTH') return completed.month === anchor.month;
  return (
    Math.ceil(completed.month / 3) === Math.ceil(anchor.month / 3)
  );
}

function toShanghaiDateParts(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  const shifted = new Date(timestamp + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function parseDateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}
