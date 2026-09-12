import { Injectable } from '@nestjs/common';
import type { GroupMemberStatus, Prisma } from '@prisma/client';
import type { ParentScope } from '../../common/auth/parent-scope.service';
import { ParentScopeService } from '../../common/auth/parent-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StoredFileService } from '../file/stored-file.service';
import type {
  GroupPageQueryDto,
  GroupOrdersQueryDto,
  ManagementCourseProductsQueryDto,
  ManagementGroupCampaignsQueryDto,
  ManagementGroupOrdersQueryDto,
  ParentGroupCampaignsQueryDto,
} from './dto/group-buying.dto';

const campaignInclude = {
  campus: {
    include: {
      customerServiceQrFile: { select: { id: true } },
    },
  },
  courseProduct: true,
  posters: {
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
    include: { storedFile: true },
  },
  teams: {
    where: { status: 'OPEN' as const },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: {
      members: {
        include: { parent: true, student: true },
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
      },
    },
  },
} satisfies Prisma.GroupCampaignInclude;

type CampaignRecord = Prisma.GroupCampaignGetPayload<{
  include: typeof campaignInclude;
}>;

const promotionCampaignInclude = {
  campus: {
    select: {
      name: true,
      customerServiceName: true,
      contactPhone: true,
      customerServiceQrFile: { select: { id: true } },
    },
  },
  courseProduct: { select: { name: true } },
  posters: {
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
    include: {
      storedFile: {
        select: { id: true, mimeType: true, sizeBytes: true },
      },
    },
  },
} satisfies Prisma.GroupCampaignInclude;

type PromotionCampaignRecord = Prisma.GroupCampaignGetPayload<{
  include: typeof promotionCampaignInclude;
}>;

const orderInclude = {
  campaign: { include: { campus: true } },
  team: true,
  student: true,
  enrollmentOrder: true,
} satisfies Prisma.GroupMemberInclude;

type OrderRecord = Prisma.GroupMemberGetPayload<{
  include: typeof orderInclude;
}>;

type GroupOrderDb = Pick<
  Prisma.TransactionClient,
  'groupMember' | 'groupCampaign'
>;

@Injectable()
export class GroupBuyingQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parentScopeService: ParentScopeService,
    private readonly storedFileService: StoredFileService,
  ) {}

  async listParentCampaigns(
    scope: ParentScope,
    query: ParentGroupCampaignsQueryDto,
  ) {
    if (query.studentId) {
      await this.parentScopeService.resolveStudent(scope, query.studentId);
    }
    const boundStudents = await this.parentScopeService.listStudents(scope);
    const now = new Date();
    const where: Prisma.GroupCampaignWhereInput = {
      campusId: scope.campusId,
      status: 'ACTIVE',
      startsAt: { lte: now },
      endsAt: { gt: now },
    };
    const [total, campaigns] = await Promise.all([
      this.prisma.groupCampaign.count({ where }),
      this.prisma.groupCampaign.findMany({
        where,
        include: campaignInclude,
        orderBy: [{ endsAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: campaigns.map((campaign) =>
        toCampaignView(
          campaign,
          boundStudents,
          scope.userId,
          this.storedFileService,
        ),
      ),
      meta: pagination(query.page, query.pageSize, total),
    };
  }

  async getParentCampaign(
    scope: ParentScope,
    campaignId: string,
    requestedTeamId?: string,
  ) {
    const [campaign, boundStudents] = await Promise.all([
      this.prisma.groupCampaign.findFirst({
        where: { id: campaignId, campusId: scope.campusId },
        include: campaignInclude,
      }),
      this.parentScopeService.listStudents(scope),
    ]);
    if (!campaign) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Group campaign not found',
        404,
      );
    }
    if (
      requestedTeamId &&
      !campaign.teams.some(({ id }) => id === requestedTeamId)
    ) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Group team not found',
        404,
      );
    }
    const view = toCampaignView(
      campaign,
      boundStudents,
      scope.userId,
      this.storedFileService,
    );
    if (requestedTeamId) {
      view.joinableTeams = view.joinableTeams.filter(
        ({ id }) => id === requestedTeamId,
      );
    }
    return view;
  }

  async listParentOrders(scope: ParentScope, query: GroupOrdersQueryDto) {
    const where: Prisma.GroupMemberWhereInput = {
      parentUserId: scope.userId,
      campaign: { campusId: scope.campusId },
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, members] = await Promise.all([
      this.prisma.groupMember.count({ where }),
      this.prisma.groupMember.findMany({
        where,
        include: orderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: members.map(toGroupOrderView),
      meta: pagination(query.page, query.pageSize, total),
    };
  }

  async listPromotionCampaigns(campusId: string, query: GroupPageQueryDto) {
    const now = new Date();
    const where: Prisma.GroupCampaignWhereInput = {
      campusId,
      status: 'ACTIVE',
      startsAt: { lte: now },
      endsAt: { gt: now },
    };
    const [total, campaigns] = await Promise.all([
      this.prisma.groupCampaign.count({ where }),
      this.prisma.groupCampaign.findMany({
        where,
        include: promotionCampaignInclude,
        orderBy: [{ endsAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: campaigns.map((campaign) =>
        toPromotionCampaignView(campaign, this.storedFileService),
      ),
      meta: pagination(query.page, query.pageSize, total),
    };
  }

  async getPromotionCampaign(campusId: string, campaignId: string) {
    const now = new Date();
    const campaign = await this.prisma.groupCampaign.findFirst({
      where: {
        id: campaignId,
        campusId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      include: promotionCampaignInclude,
    });
    if (!campaign) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Group campaign not found',
        404,
      );
    }
    return toPromotionCampaignView(campaign, this.storedFileService);
  }

  async listManagementCampaigns(query: ManagementGroupCampaignsQueryDto) {
    const where: Prisma.GroupCampaignWhereInput = {
      ...(query.campusId ? { campusId: query.campusId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, campaigns] = await Promise.all([
      this.prisma.groupCampaign.count({ where }),
      this.prisma.groupCampaign.findMany({
        where,
        include: campaignInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: campaigns.map((campaign) =>
        toCampaignView(campaign, [], '__management__', this.storedFileService),
      ),
      meta: pagination(query.page, query.pageSize, total),
    };
  }

  async listManagementCourseProducts(query: ManagementCourseProductsQueryDto) {
    const where: Prisma.CourseProductWhereInput = {
      ...(query.campusId ? { campusId: query.campusId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, products] = await Promise.all([
      this.prisma.courseProduct.count({ where }),
      this.prisma.courseProduct.findMany({
        where,
        include: { campus: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: products.map(({ campus, ...product }) => ({
        ...product,
        campusName: campus.name,
      })),
      meta: pagination(query.page, query.pageSize, total),
    };
  }

  async listManagementOrders(query: ManagementGroupOrdersQueryDto) {
    const where: Prisma.GroupMemberWhereInput = {
      ...(query.campusId ? { campaign: { campusId: query.campusId } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, members] = await Promise.all([
      this.prisma.groupMember.count({ where }),
      this.prisma.groupMember.findMany({
        where,
        include: orderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: members.map(toGroupOrderView),
      meta: pagination(query.page, query.pageSize, total),
    };
  }
}

export async function loadGroupOrderView(
  database: GroupOrderDb,
  memberId: string,
) {
  const member = await database.groupMember.findUnique({
    where: { id: memberId },
    include: orderInclude,
  });
  if (!member) {
    throw new DomainError(
      ErrorCode.RESOURCE_NOT_FOUND,
      'Group member not found',
      404,
    );
  }
  return toGroupOrderView(member);
}

export async function loadGroupJoinView(
  database: GroupOrderDb,
  memberId: string,
  viewerUserId: string,
  prepay: {
    mode: 'MOCK' | 'WECHAT';
    outTradeNo: string;
    timeStamp?: string;
    nonceStr?: string;
    package?: string;
    signType?: 'RSA';
    paySign?: string;
  },
) {
  const order = await loadGroupOrderView(database, memberId);
  const campaign = await database.groupCampaign.findUnique({
    where: { id: order.campaignId },
    include: campaignInclude,
  });
  const team = campaign?.teams.find(({ id }) => id === order.teamId);
  if (!campaign || !team) {
    throw new DomainError(
      ErrorCode.RESOURCE_NOT_FOUND,
      'Group team not found',
      404,
    );
  }
  return {
    team: toTeamView(team, campaign.maxPaidMembers, viewerUserId),
    order,
    prepay: {
      ...prepay,
      memberId,
      orderId: order.id,
      timeStamp: prepay.timeStamp ?? null,
      nonceStr: prepay.nonceStr ?? null,
      package: prepay.package ?? null,
      signType: prepay.signType ?? null,
      paySign: prepay.paySign ?? null,
    },
  };
}

export async function loadManagementCampaignView(
  database: GroupOrderDb,
  campaignId: string,
  storedFileService: StoredFileService,
) {
  const campaign = await database.groupCampaign.findUnique({
    where: { id: campaignId },
    include: campaignInclude,
  });
  if (!campaign) {
    throw new DomainError(
      ErrorCode.RESOURCE_NOT_FOUND,
      'Group campaign not found',
      404,
    );
  }
  return toCampaignView(campaign, [], '__management__', storedFileService);
}

export function toGroupOrderView(member: OrderRecord) {
  return {
    id: member.enrollmentOrder.id,
    orderNo: member.enrollmentOrder.orderNo,
    campaignId: member.campaignId,
    campaignTitle: member.campaign.title,
    teamId: member.teamId,
    memberId: member.id,
    campusId: member.campaign.campusId,
    campusName: member.campaign.campus.name,
    studentId: member.studentId,
    studentName: member.student.displayName,
    priceFen: member.enrollmentOrder.priceFenSnapshot,
    memberStatus: member.status,
    orderStatus: member.enrollmentOrder.status,
    teamStatus: member.team.status,
    paidMemberCount: member.team.paidMemberCount,
    grantedMainUnits: member.grantedMainUnits,
    grantedGiftUnits: member.grantedGiftUnits,
    paidAt: member.paidAt?.toISOString() ?? null,
    settledAt: member.settledAt?.toISOString() ?? null,
    version: member.version,
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  };
}

function toCampaignView(
  campaign: CampaignRecord,
  boundStudents: Array<{ id: string; displayName: string }>,
  viewerUserId: string,
  storedFileService: StoredFileService,
) {
  return {
    id: campaign.id,
    code: campaign.code,
    campusId: campaign.campusId,
    campusName: campaign.campus.name,
    courseProductId: campaign.courseProductId,
    courseName: campaign.courseProduct.name,
    title: campaign.title,
    description: campaign.description,
    priceFen: campaign.priceFen,
    maxPaidMembers: campaign.maxPaidMembers,
    startsAt: campaign.startsAt.toISOString(),
    endsAt: campaign.endsAt.toISOString(),
    status: campaign.status,
    version: campaign.version,
    posterImages: campaign.posters.map((poster) =>
      storedFileService.toGroupCampaignPosterView(poster),
    ),
    joinableTeams: campaign.teams
      .map((team) => toTeamView(team, campaign.maxPaidMembers, viewerUserId))
      .filter(({ remainingSlots }) => remainingSlots > 0),
    boundStudents: boundStudents.map(({ id, displayName }) => ({
      id,
      name: displayName,
    })),
    customerService: {
      name: campaign.campus.customerServiceName ?? '校区客服',
      phone: campaign.campus.contactPhone ?? '',
      qrCodeUrl: storedFileService.toCustomerServiceQrUrl(
        campaign.campus.customerServiceQrFile,
      ),
    },
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
  };
}

function toPromotionCampaignView(
  campaign: PromotionCampaignRecord,
  storedFileService: StoredFileService,
) {
  return {
    id: campaign.id,
    code: campaign.code,
    campusId: campaign.campusId,
    campusName: campaign.campus.name,
    courseProductId: campaign.courseProductId,
    courseName: campaign.courseProduct.name,
    title: campaign.title,
    description: campaign.description,
    priceFen: campaign.priceFen,
    maxPaidMembers: campaign.maxPaidMembers,
    startsAt: campaign.startsAt.toISOString(),
    endsAt: campaign.endsAt.toISOString(),
    status: campaign.status,
    posterImages: campaign.posters.map((poster) =>
      storedFileService.toGroupCampaignPosterView(poster),
    ),
    customerService: {
      name: campaign.campus.customerServiceName ?? '校区客服',
      phone: campaign.campus.contactPhone ?? '',
      qrCodeUrl: storedFileService.toCustomerServiceQrUrl(
        campaign.campus.customerServiceQrFile,
      ),
    },
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
  };
}

export function toTeamView(
  team: CampaignRecord['teams'][number],
  maxPaidMembers: number,
  viewerUserId: string,
) {
  const activeMembers = team.members.filter((member) =>
    occupiesTeamSlot(member.status, member.reservationExpiresAt),
  );
  return {
    id: team.id,
    status: team.status,
    paidMemberCount: team.paidMemberCount,
    remainingSlots: Math.max(0, maxPaidMembers - activeMembers.length),
    finalTier: team.finalTier,
    members: activeMembers.map((member) => ({
      id: member.id,
      maskedParentName: maskName(member.parent.displayName),
      studentName:
        member.parentUserId === viewerUserId
          ? member.student.displayName
          : '团友学员',
      status: member.status,
      paidAt: member.paidAt?.toISOString() ?? null,
    })),
    shareScene: `group:${team.id}`,
    settledAt: team.settledAt?.toISOString() ?? null,
    createdAt: team.createdAt.toISOString(),
  };
}

function occupiesTeamSlot(
  status: GroupMemberStatus,
  reservationExpiresAt: Date,
): boolean {
  if (status === 'PENDING_PAYMENT') {
    return reservationExpiresAt.getTime() > Date.now();
  }
  return status !== 'CANCELLED' && status !== 'REFUNDED';
}

function maskName(name: string): string {
  return name.length > 0 ? `${name.slice(0, 1)}**` : '团友';
}

function pagination(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}
