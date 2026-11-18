import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type {
  FreeCampaignPhaseQueryDto,
  FreeRegistrationInputDto,
  FreeRegistrationQueryDto,
  FreeVersionedActionDto,
} from './dto/free-campaign.dto';
import type { GroupPageQueryDto } from './dto/group-buying.dto';
import {
  availability,
  configuration,
  MAX_VERSION,
  notFound,
  pageMeta,
  registrationDetail,
  registrationReceipt,
  remaining,
  unavailable,
} from './free-campaign-policy';
import { FreeCampaignScopeService } from './free-campaign-scope.service';
import { StoredFileService } from '../file/stored-file.service';

@Injectable()
export class FreeCampaignRegistrationService {
  constructor(
    private readonly scope: FreeCampaignScopeService,
    private readonly idempotency: IdempotencyService,
    private readonly files: StoredFileService,
  ) {}

  listOwnedCampaigns(
    user: AuthenticatedUser,
    query: FreeCampaignPhaseQueryDto,
  ) {
    return this.scope.snapshot(user, 'PARTNER', async (tx, actor) => {
      const campusId = this.scope.campus(actor);
      const now = new Date();
      const where: Prisma.CampaignWhereInput = {
        campusId,
        publishedVersion: {
          status: 'APPROVED',
          campaignType: 'FREE_REGISTRATION',
          ...(query.phase === 'ONGOING' ? { endsAt: { gt: now } } : {}),
        },
        ...(query.phase === 'ONGOING'
          ? { lifecycle: 'OPEN' }
          : {
              OR: [
                { lifecycle: 'CLOSED' },
                { publishedVersion: { endsAt: { lte: now } } },
              ],
            }),
      };
      const total = await tx.campaign.count({ where });
      const rows = await tx.campaign.findMany({
        where,
        include: { publishedVersion: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      const counts = rows.length
        ? await tx.campaignRegistration.groupBy({
            by: ['campaignId'],
            where: {
              campusId,
              campaignId: { in: rows.map((row) => row.id) },
              status: 'REGISTERED',
            },
            _count: { _all: true },
          })
        : [];
      const occupied = new Map(
        counts.map((row) => [row.campaignId, row._count._all]),
      );
      return {
        data: rows.map((campaign) => {
          const version = campaign.publishedVersion!;
          const count = occupied.get(campaign.id) ?? 0;
          return {
            campaignId: campaign.id,
            versionId: version.id,
            draftId: campaign.draftId,
            sequence: version.sequence,
            title: version.title,
            startsAt: version.startsAt.toISOString(),
            endsAt: version.endsAt.toISOString(),
            timezone: version.timezone,
            availability: availability(campaign, version, count, now),
            registeredCount: count,
            maxRegistrations: version.maxRegistrations,
            remainingRegistrations: remaining(version, count),
          };
        }),
        meta: pageMeta(query, total),
      };
    });
  }

  listCampaigns(user: AuthenticatedUser, query: GroupPageQueryDto) {
    return this.scope.snapshot(user, 'PARENT', async (tx, actor) => {
      const where = {
        campusId: this.scope.campus(actor),
        publishedVersion: { status: 'APPROVED' as const },
      };
      const total = await tx.campaign.count({ where });
      const rows = await tx.campaign.findMany({
        where,
        include: { publishedVersion: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      const counts = await tx.campaignRegistration.groupBy({
        by: ['campaignId'],
        where: {
          campaignId: { in: rows.map((r) => r.id) },
          status: 'REGISTERED',
        },
        _count: { _all: true },
      });
      const occupied = new Map(
        counts.map((c) => [c.campaignId, c._count._all]),
      );
      const now = new Date();
      return {
        data: rows.map((c) => {
          const v = c.publishedVersion!;
          const count = occupied.get(c.id) ?? 0;
          return {
            campaignId: c.id,
            versionId: v.id,
            title: v.title,
            startsAt: v.startsAt.toISOString(),
            endsAt: v.endsAt.toISOString(),
            timezone: v.timezone,
            availability: availability(c, v, count, now),
            registeredCount: count,
            maxRegistrations: v.maxRegistrations,
            remainingRegistrations: remaining(v, count),
          };
        }),
        meta: pageMeta(query, total),
      };
    });
  }

  async getCampaign(user: AuthenticatedUser, id: string, versionId?: string) {
    const result = await this.scope.snapshot(
      user,
      'PARENT',
      async (tx, actor) => {
        const campusId = this.scope.campus(actor);
        const campaign = await tx.campaign.findFirst({
          where: { id, campusId, publishedVersionId: { not: null } },
        });
        if (!campaign) notFound();
        const version = await tx.campaignVersion.findFirst({
          where: {
            id: versionId ?? campaign.publishedVersionId!,
            campaignId: id,
            campusId,
            status: 'APPROVED',
          },
          include: { coverImage: true, shareImage: true },
        });
        if (!version) notFound();
        const students = await tx.student.findMany({
          where: {
            campusId,
            isActive: true,
            parentBindings: { some: { parentUserId: actor.userId, campusId } },
          },
          select: { id: true, displayName: true },
          orderBy: { id: 'asc' },
        });
        const registrations = await tx.campaignRegistration.findMany({
          where: {
            campaignId: id,
            studentId: { in: students.map((s) => s.id) },
          },
        });
        const prior = new Map(registrations.map((r) => [r.studentId, r]));
        const count = await tx.campaignRegistration.count({
          where: { campaignId: id, status: 'REGISTERED' },
        });
        return {
          studentIds: students.map((s) => s.id),
          response: {
            campaignId: id,
            versionId: version.id,
            configuration: configuration(version, this.files),
            availability: availability(campaign, version, count, new Date()),
            registeredCount: count,
            remainingRegistrations: remaining(version, count),
            eligibleStudents: students.map((s) => {
              const row = prior.get(s.id);
              return {
                studentId: s.id,
                displayName: s.displayName,
                eligibility: row ? 'ALREADY_REGISTERED' : 'ELIGIBLE',
                registration:
                  row?.parentUserId === actor.userId
                    ? registrationReceipt(row)
                    : null,
              };
            }),
          },
        };
      },
      (tx, actor, result) =>
        this.scope.boundStudents(tx, actor, result.studentIds),
    );
    return result.response;
  }

  register(
    user: AuthenticatedUser,
    id: string,
    input: FreeRegistrationInputDto,
    key: string,
  ) {
    const route = `/parents/me/free-campaigns/${id}/registrations`;
    return this.scope.withActor(user, 'PARENT', async (tx, actor) => {
      const campusId = this.scope.campus(actor);
      await this.scope.boundStudents(tx, actor, [input.studentId]);
      const campaign = await this.scope.campaign(tx, id, campusId);
      if (!campaign.publishedVersionId) notFound();
      const version = await tx.campaignVersion.findFirst({
        where: {
          id: input.versionId,
          campaignId: id,
          campusId,
          status: 'APPROVED',
        },
      });
      if (!version) notFound();
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: input,
        actorUserId: actor.userId,
        campusId,
      });
      if (claim.replayed) return claim.responseBody;
      if (
        await tx.campaignRegistration.findUnique({
          where: {
            campaignId_studentId: {
              campaignId: id,
              studentId: input.studentId,
            },
          },
        })
      )
        throw new DomainError(
          ErrorCode.FREE_CAMPAIGN_ALREADY_REGISTERED,
          '该学员已使用本活动的一次报名资格',
          409,
        );
      const count = await tx.campaignRegistration.count({
        where: { campaignId: id, status: 'REGISTERED' },
      });
      const state = availability(campaign, version, count, new Date());
      if (state === 'FULL')
        throw new DomainError(
          ErrorCode.FREE_CAMPAIGN_FULL,
          '报名名额已满',
          409,
        );
      if (
        state !== 'AVAILABLE' ||
        version.campaignType !== 'FREE_REGISTRATION' ||
        version.benefitMode !== 'NONE'
      )
        unavailable();
      const row = await tx.campaignRegistration.create({
        data: {
          campaignId: id,
          campusId,
          versionId: version.id,
          studentId: input.studentId,
          parentUserId: actor.userId,
          registeredAt: new Date(),
        },
      });
      await this.audit(
        tx,
        actor.userId,
        campusId,
        'FREE_CAMPAIGN_REGISTER',
        row.id,
        { campaignId: id, versionId: version.id, version: row.version },
      );
      const receipt = registrationReceipt(row);
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: receipt,
      });
      return receipt;
    });
  }

  cancel(
    user: AuthenticatedUser,
    id: string,
    input: FreeVersionedActionDto,
    key: string,
  ) {
    const route = `/parents/me/campaign-registrations/${id}/cancel`;
    return this.scope.withActor(user, 'PARENT', async (tx, actor) => {
      const campusId = this.scope.campus(actor);
      const locator = await tx.campaignRegistration.findFirst({
        where: { id, campusId, parentUserId: actor.userId },
      });
      if (!locator) notFound();
      await this.scope.boundStudents(tx, actor, [locator.studentId]);
      await this.scope.campaign(tx, locator.campaignId, campusId);
      await tx.$queryRaw`SELECT "id" FROM "CampaignRegistration" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const current = await tx.campaignRegistration.findUniqueOrThrow({
        where: { id },
        include: { campaignVersion: true },
      });
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: input,
        actorUserId: actor.userId,
        campusId,
      });
      if (claim.replayed) return claim.responseBody;
      const now = new Date();
      if (
        current.version !== input.expectedVersion ||
        current.version === MAX_VERSION ||
        current.status !== 'REGISTERED' ||
        now >= current.campaignVersion.endsAt
      )
        throw new DomainError(
          ErrorCode.FREE_REGISTRATION_STATUS_CONFLICT,
          '报名状态已更新或撤销期限已过',
          409,
        );
      const row = await tx.campaignRegistration.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          version: { increment: 1 },
          cancelledAt: now,
          cancelledByUserId: actor.userId,
        },
      });
      await this.audit(tx, actor.userId, campusId, 'FREE_CAMPAIGN_CANCEL', id, {
        campaignId: row.campaignId,
        versionId: row.versionId,
        previousVersion: current.version,
        version: row.version,
      });
      const receipt = registrationReceipt(row);
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: receipt,
      });
      return receipt;
    });
  }

  getRegistration(user: AuthenticatedUser, id: string) {
    return this.scope.withActor(user, 'PARENT', async (tx, actor) => {
      const where = {
        id,
        campusId: this.scope.campus(actor),
        parentUserId: actor.userId,
      };
      const locator = await tx.campaignRegistration.findFirst({
        where,
        select: { studentId: true },
      });
      if (!locator) notFound();
      await this.scope.boundStudents(tx, actor, [locator.studentId]);
      const row = await tx.campaignRegistration.findFirstOrThrow({
        where,
        include: { campaignVersion: true },
      });
      return registrationDetail(row, row.campaignVersion, new Date());
    });
  }

  async listRegistrations(user: AuthenticatedUser, query: GroupPageQueryDto) {
    const result = await this.scope.snapshot(
      user,
      'PARENT',
      async (tx, actor) => {
        const campusId = this.scope.campus(actor);
        const where: Prisma.CampaignRegistrationWhereInput = {
          campusId,
          parentUserId: actor.userId,
          student: {
            isActive: true,
            campusId,
            parentBindings: { some: { parentUserId: actor.userId, campusId } },
          },
        };
        const total = await tx.campaignRegistration.count({ where });
        const rows = await tx.campaignRegistration.findMany({
          where,
          include: { campaignVersion: true },
          orderBy: [{ registeredAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        });
        return {
          studentIds: rows.map((r) => r.studentId),
          response: {
            data: rows.map((r) =>
              registrationDetail(r, r.campaignVersion, new Date()),
            ),
            meta: pageMeta(query, total),
          },
        };
      },
      (tx, actor, result) =>
        this.scope.boundStudents(tx, actor, result.studentIds),
    );
    return result.response;
  }

  async partnerRegistrations(
    user: AuthenticatedUser,
    id: string,
    query: FreeRegistrationQueryDto,
  ) {
    const result = await this.scope.snapshot(
      user,
      'PARTNER',
      async (tx, actor) => {
        const campusId = this.scope.campus(actor);
        await this.scope.draft(tx, id, campusId);
        const where = {
          campusId,
          campaign: { draftId: id },
          ...(query.status ? { status: query.status } : {}),
        };
        const total = await tx.campaignRegistration.count({ where });
        const rows = await tx.campaignRegistration.findMany({
          where,
          include: {
            student: {
              select: {
                id: true,
                displayName: true,
                isActive: true,
                campusId: true,
              },
            },
          },
          orderBy: [{ registeredAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        });
        const named = (r: (typeof rows)[number]) =>
          r.student.isActive && r.student.campusId === campusId;
        return {
          studentIds: rows.filter(named).map((r) => r.studentId),
          response: {
            data: rows.map((r) => ({
              registrationId: r.id,
              versionId: r.versionId,
              status: r.status,
              registeredAt: r.registeredAt.toISOString(),
              cancelledAt: r.cancelledAt?.toISOString() ?? null,
              studentName: named(r) ? r.student.displayName : null,
            })),
            meta: pageMeta(query, total),
          },
        };
      },
      async (tx, actor, result) => {
        const campusId = this.scope.campus(actor);
        await this.scope.draft(tx, id, campusId);
        await this.scope.namedStudents(tx, campusId, result.studentIds);
      },
    );
    return result.response;
  }

  private audit(
    tx: Prisma.TransactionClient,
    userId: string,
    campusId: string,
    action: string,
    id: string,
    details: Prisma.InputJsonObject,
  ) {
    return tx.auditLog.create({
      data: {
        campusId,
        actorUserId: userId,
        action,
        resourceType: 'CampaignRegistration',
        resourceId: id,
        outcome: 'SUCCESS',
        details,
      },
    });
  }
}
