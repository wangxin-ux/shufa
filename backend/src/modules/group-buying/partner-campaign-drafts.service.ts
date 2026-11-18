import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type PartnerCampaignDraft,
  type CampaignLifecycle,
  type CampaignReviewStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  PartnerScopeService,
  type PartnerScope,
} from '../../common/auth/partner-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  PartnerCampaignDraftBasicDto,
  PartnerCampaignDraftQueryDto,
  SavePartnerCampaignDraftBasicDto,
  SavePartnerCampaignDraftContentDto,
  SavePartnerCampaignDraftFormDto,
} from './dto/partner-campaign-draft.dto';
import { normalizeRegistrationForm } from './campaign-registration-form';

const ROUTE = '/partners/me/campaign-drafts';
const FIELDS = [
  'title',
  'campaignType',
  'shareDescription',
  'contactPhone',
] as const;
const LIMITS = { title: 40, shareDescription: 1000, contactPhone: 30 };
const normalize = (input: PartnerCampaignDraftBasicDto) => ({
  title: input.title?.trim() || null,
  campaignType: input.campaignType ?? null,
  shareDescription: input.shareDescription?.trim() || null,
  contactPhone: input.contactPhone?.trim() || null,
});

@Injectable()
export class PartnerCampaignDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partnerScope: PartnerScopeService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(user: AuthenticatedUser, query: PartnerCampaignDraftQueryDto) {
    const scope = this.partnerScope.require(user);
    const result = await this.prisma.$transaction(
      async (tx) => {
        const where = {
          campusId: scope.campusId,
          ...(query.campaignType ? { campaignType: query.campaignType } : {}),
        };
        const total = await tx.partnerCampaignDraft.count({ where });
        const rows = await tx.partnerCampaignDraft.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            title: true,
            campaignType: true,
            version: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        // Prisma's nested take can fetch all history; limit each indexed lookup in SQL.
        const reviews = rows.length
          ? await tx.$queryRaw<
              Array<{
                draftId: string;
                lifecycle: CampaignLifecycle;
                sequence: number;
                sourceDraftVersion: number;
                status: CampaignReviewStatus;
                reviewReason: string | null;
              }>
            >`
              SELECT c."draftId", c."lifecycle", v."sequence",
                v."sourceDraftVersion", v."status", v."reviewReason"
              FROM "Campaign" c
              JOIN LATERAL (
                SELECT "sequence", "sourceDraftVersion", "status", "reviewReason"
                FROM "CampaignVersion"
                WHERE "campaignId" = c."id" AND "campusId" = c."campusId"
                ORDER BY "sequence" DESC LIMIT 1
              ) v ON true
              WHERE c."campusId" = ${scope.campusId}::uuid
                AND c."draftId" IN (${Prisma.join(rows.map((row) => Prisma.sql`${row.id}::uuid`))})
            `
          : [];
        const byDraft = new Map(
          reviews.map(({ draftId, lifecycle, ...latestSubmission }) => [
            draftId,
            { lifecycle, latestSubmission },
          ]),
        );
        return {
          data: rows.map((row) => ({
            ...this.receipt(row),
            title: row.title,
            campaignType: row.campaignType,
            latestSubmission: byDraft.get(row.id)?.latestSubmission ?? null,
            lifecycle: byDraft.get(row.id)?.lifecycle ?? null,
          })),
          meta: {
            page: query.page,
            pageSize: query.pageSize,
            total,
            totalPages: Math.ceil(total / query.pageSize),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    // Verify current authorization outside the list's historical data snapshot.
    return this.withActor(user, () => Promise.resolve(result));
  }

  get(user: AuthenticatedUser, id: string) {
    return this.withActor(user, async (tx, scope) => {
      const draft = await this.find(tx, scope, id);
      return {
        ...this.receipt(draft),
        basicInformation: normalize(draft),
        activityContent: draft.activityContent,
        registrationForm: normalizeRegistrationForm(draft.registrationForm),
      };
    });
  }

  create(
    user: AuthenticatedUser,
    input: PartnerCampaignDraftBasicDto,
    key: string,
  ) {
    const fields = normalize(input);
    this.validateCodePoints(fields);
    return this.withActor(user, async (tx, scope) => {
      const claim = await this.idempotency.claim(tx, {
        key,
        route: ROUTE,
        request: fields,
        actorUserId: scope.userId,
        campusId: scope.campusId,
      });
      if (claim.replayed) return claim.responseBody;
      const draft = await tx.partnerCampaignDraft.create({
        data: {
          ...fields,
          campusId: scope.campusId,
          createdByUserId: scope.userId,
        },
      });
      await this.audit(tx, scope, draft, 0, [...FIELDS]);
      const receipt = this.receipt(draft);
      await this.idempotency.complete(tx, {
        key,
        route: ROUTE,
        responseBody: receipt,
      });
      return receipt;
    });
  }

  save(
    user: AuthenticatedUser,
    id: string,
    input: SavePartnerCampaignDraftBasicDto,
  ) {
    const fields = normalize(input.basicInformation);
    this.validateCodePoints(fields);
    return this.withActor(user, async (tx, scope) => {
      await tx.$queryRaw`SELECT "id" FROM "PartnerCampaignDraft"
        WHERE "id" = ${id}::uuid AND "campusId" = ${scope.campusId}::uuid FOR UPDATE`;
      const current = await this.find(tx, scope, id);
      const changed = FIELDS.filter(
        (field) => current[field] !== fields[field],
      );
      if (
        !changed.length &&
        (input.expectedVersion === current.version ||
          input.expectedVersion === current.version - 1)
      ) {
        return this.receipt(current);
      }
      if (
        input.expectedVersion !== current.version ||
        current.version === 2_147_483_647
      ) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          '草稿已更新或版本已达上限，请重新读取后保存',
          409,
        );
      }
      const draft = await tx.partnerCampaignDraft.update({
        where: { id, campusId: scope.campusId, version: current.version },
        data: { ...fields, version: { increment: 1 } },
      });
      await this.audit(tx, scope, draft, current.version, changed);
      return this.receipt(draft);
    });
  }

  saveContent(
    user: AuthenticatedUser,
    id: string,
    input: SavePartnerCampaignDraftContentDto,
  ) {
    const activityContent = input.activityContent?.trim() || null;
    if (
      activityContent !== null &&
      (Array.from(activityContent).length > 10000 ||
        activityContent.includes('\u0000') ||
        /[\ud800-\udfff]/u.test(activityContent))
    )
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        '活动正文格式或长度不符合要求',
        400,
      );
    return this.withActor(user, async (tx, scope) => {
      await tx.$queryRaw`SELECT "id" FROM "PartnerCampaignDraft"
        WHERE "id" = ${id}::uuid AND "campusId" = ${scope.campusId}::uuid FOR UPDATE`;
      const current = await this.find(tx, scope, id);
      if (
        current.activityContent === activityContent &&
        (input.expectedVersion === current.version ||
          input.expectedVersion === current.version - 1)
      )
        return this.receipt(current);
      if (
        input.expectedVersion !== current.version ||
        current.version === 2_147_483_647
      )
        throw new DomainError(
          ErrorCode.CONFLICT,
          '草稿已更新或版本已达上限，请重新读取后保存',
          409,
        );
      const draft = await tx.partnerCampaignDraft.update({
        where: { id, campusId: scope.campusId, version: current.version },
        data: { activityContent, version: { increment: 1 } },
      });
      await this.audit(
        tx,
        scope,
        draft,
        current.version,
        ['activityContent'],
        'PARTNER_CAMPAIGN_DRAFT_CONTENT_SAVE',
      );
      return this.receipt(draft);
    });
  }

  saveRegistrationForm(
    user: AuthenticatedUser,
    id: string,
    input: SavePartnerCampaignDraftFormDto,
  ) {
    const registrationForm = normalizeRegistrationForm(input.registrationForm);
    return this.withActor(user, async (tx, scope) => {
      await tx.$queryRaw`SELECT "id" FROM "PartnerCampaignDraft"
        WHERE "id" = ${id}::uuid AND "campusId" = ${scope.campusId}::uuid FOR UPDATE`;
      const current = await this.find(tx, scope, id);
      const same =
        JSON.stringify(normalizeRegistrationForm(current.registrationForm)) ===
        JSON.stringify(registrationForm);
      if (
        same &&
        (input.expectedVersion === current.version ||
          input.expectedVersion === current.version - 1)
      )
        return this.receipt(current);
      if (
        input.expectedVersion !== current.version ||
        current.version === 2_147_483_647
      )
        throw new DomainError(
          ErrorCode.CONFLICT,
          '草稿已更新，请重新读取后保存',
          409,
        );
      const draft = await tx.partnerCampaignDraft.update({
        where: { id, campusId: scope.campusId, version: current.version },
        data: { registrationForm, version: { increment: 1 } },
      });
      await this.audit(
        tx,
        scope,
        draft,
        current.version,
        ['registrationForm'],
        'PARTNER_CAMPAIGN_DRAFT_FORM_SAVE',
      );
      return this.receipt(draft);
    });
  }

  private withActor<T>(
    user: AuthenticatedUser,
    action: (tx: Prisma.TransactionClient, scope: PartnerScope) => Promise<T>,
  ): Promise<T> {
    const requested = this.partnerScope.require(user);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.userId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "UserRole" WHERE "userId" = ${user.userId}::uuid ORDER BY "id" FOR UPDATE`;
        const current = await tx.user.findUnique({
          where: { id: user.userId },
          select: {
            status: true,
            roles: { select: { roleCode: true, campusId: true } },
          },
        });
        if (!current || current.status !== 'ACTIVE') {
          throw new DomainError(
            ErrorCode.UNAUTHORIZED,
            '登录已失效，请重新登录',
            401,
          );
        }
        const scope = this.partnerScope.require({
          userId: user.userId,
          roles: current.roles.map((role) => ({
            code: role.roleCode,
            campusId: role.campusId,
          })),
        });
        if (scope.campusId !== requested.campusId) {
          throw new DomainError(
            ErrorCode.FORBIDDEN,
            '当前账号的校区已更新，请重新登录',
            403,
          );
        }
        return action(tx, scope);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private async find(
    tx: Prisma.TransactionClient,
    scope: PartnerScope,
    id: string,
  ) {
    const draft = await tx.partnerCampaignDraft.findFirst({
      where: { id, campusId: scope.campusId },
    });
    if (!draft)
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        '活动草稿不存在',
        404,
      );
    return draft;
  }

  private receipt(
    draft: Pick<
      PartnerCampaignDraft,
      'id' | 'version' | 'createdAt' | 'updatedAt'
    >,
  ) {
    return {
      draftId: draft.id,
      status: 'DRAFT' as const,
      version: draft.version,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  private validateCodePoints(fields: ReturnType<typeof normalize>) {
    for (const [field, limit] of Object.entries(LIMITS)) {
      const value = fields[field as keyof typeof LIMITS];
      if (
        value !== null &&
        (Array.from(value).length > limit ||
          value.includes('\u0000') ||
          /[\ud800-\udfff]/u.test(value))
      ) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          '活动基础字段格式或长度不符合要求',
          400,
        );
      }
    }
  }

  private audit(
    tx: Prisma.TransactionClient,
    scope: PartnerScope,
    draft: PartnerCampaignDraft,
    previousVersion: number,
    changedFields: string[],
    action = 'PARTNER_CAMPAIGN_DRAFT_BASIC_SAVE',
  ) {
    return tx.auditLog.create({
      data: {
        campusId: scope.campusId,
        actorUserId: scope.userId,
        action,
        resourceType: 'PartnerCampaignDraft',
        resourceId: draft.id,
        outcome: 'SUCCESS',
        details: { previousVersion, version: draft.version, changedFields },
      },
    });
  }
}
