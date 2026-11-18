import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PartnerApplicationSubmission, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ROLE_PERMISSION_MATRIX } from '../iam/role-permission.matrix';
import type { ApplicantRequest } from './partner-applicant.guard';
import type {
  PartnerApplicationReviewQueryDto,
  PartnerApplicationHistoryQueryDto,
  RejectPartnerApplicationDto,
  ReopenPartnerApplicationDto,
} from './dto/partner-application-review.dto';
import {
  PartnerApplicationPrivateCipher,
  privateBankUnavailable,
} from './partner-application-private-cipher';
import { PartnerApplicationMaterialService } from './partner-application-material.service';
import { PartnerApplicationBankService } from './partner-application-bank.service';
import { SubmitPartnerApplicationDto } from './dto/partner-application-submit.dto';
import { StaffAccountManagementService } from '../management/staff-account-management.service';

type Tx = Prisma.TransactionClient;
type Applicant = ApplicantRequest['applicant'];
const options = { maxWait: 10_000, timeout: 30_000 };

@Injectable()
export class PartnerApplicationReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly cipher: PartnerApplicationPrivateCipher,
    private readonly materials: PartnerApplicationMaterialService,
    private readonly banks: PartnerApplicationBankService,
    private readonly accounts: StaffAccountManagementService,
  ) {}

  list(actor: AuthenticatedUser, query: PartnerApplicationReviewQueryDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.admin(tx, actor);
      const where: Prisma.PartnerApplicationWhereInput = {
        applicant: { userId: { not: actor.userId } },
        submissions: { some: {} },
        ...(query.status ? { status: query.status } : {}),
        ...(query.query?.trim()
          ? {
              submissions: {
                some: {
                  institutionName: {
                    contains: query.query.trim(),
                    mode: 'insensitive',
                  },
                },
              },
            }
          : {}),
      };
      const total = await tx.partnerApplication.count({ where });
      const applications = await tx.partnerApplication.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          status: true,
          version: true,
          submissions: {
            orderBy: { applicationVersion: 'desc' },
            take: 1,
            select: {
              id: true,
              institutionName: true,
              applicationVersion: true,
              submittedAt: true,
            },
          },
        },
      });
      await this.admin(tx, actor);
      return {
        data: applications.map((item) => ({
          applicationId: item.id,
          status: item.status,
          version: item.version,
          submissionId: item.submissions[0].id,
          institutionName: item.submissions[0].institutionName,
          submissionVersion: item.submissions[0].applicationVersion,
          submittedAt: item.submissions[0].submittedAt.toISOString(),
        })),
        meta: this.meta(query, total),
      };
    });
  }

  detail(
    actor: AuthenticatedUser,
    applicationId: string,
    submissionId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const context = await this.snapshot(
        tx,
        actor,
        applicationId,
        submissionId,
      );
      const files = await this.materials.snapshotFiles(
        tx,
        this.frozenApplication(context),
        context.owner,
      );
      await this.audit(
        tx,
        actor.userId,
        applicationId,
        'PARTNER_APPLICATION_REVIEW_DETAIL_READ',
        { submissionId },
      );
      await this.snapshot(tx, actor, applicationId, submissionId);
      const { snapshot: s, application: a } = context;
      return {
        applicationId,
        submissionId,
        version: a.version,
        status: a.status,
        submissionVersion: s.applicationVersion,
        submittedAt: s.submittedAt.toISOString(),
        latest: context.latest.id === submissionId,
        basicInformation: this.basics(s),
        materials: files.map((item) => item.view),
        review: this.reviewView(s.review),
      };
    }, options);
  }

  bank(actor: AuthenticatedUser, applicationId: string, submissionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const context = await this.snapshot(
        tx,
        actor,
        applicationId,
        submissionId,
      );
      const record = await tx.partnerApplicationBankRecord.findUnique({
        where: { id: context.snapshot.bankRecordId },
      });
      if (
        !record ||
        record.applicationId !== applicationId ||
        record.ownerUserId !== context.owner ||
        record.applicationVersion > context.snapshot.sourceVersion
      )
        privateBankUnavailable();
      const information = this.cipher.decrypt(record, record);
      await this.audit(
        tx,
        actor.userId,
        applicationId,
        'PARTNER_APPLICATION_REVIEW_BANK_READ',
        { submissionId, bankRecordId: record.id },
      );
      const verified = await this.snapshot(
        tx,
        actor,
        applicationId,
        submissionId,
      );
      if (verified.snapshot.bankRecordId !== record.id) this.conflict();
      return { applicationId, submissionId, bankInformation: information };
    }, options);
  }

  async image(
    actor: AuthenticatedUser,
    applicationId: string,
    submissionId: string,
    storedFileId: string,
  ) {
    const file = await this.prisma.$transaction(async (tx) => {
      const context = await this.snapshot(
        tx,
        actor,
        applicationId,
        submissionId,
      );
      const files = await this.materials.snapshotFiles(
        tx,
        this.frozenApplication(context),
        context.owner,
      );
      const selected = files.find(
        (item) => item.file.storedFileId === storedFileId,
      );
      if (!selected) this.notFound();
      return selected.file;
    }, options);
    const buffer = await this.materials.readSnapshotFile(file);
    await this.prisma.$transaction(async (tx) => {
      const context = await this.snapshot(
        tx,
        actor,
        applicationId,
        submissionId,
      );
      const files = await this.materials.snapshotFiles(
        tx,
        this.frozenApplication(context),
        context.owner,
      );
      if (
        !files.some(
          (item) =>
            item.file.id === file.id &&
            item.file.storageKey === file.storageKey,
        )
      )
        this.conflict();
      await this.audit(
        tx,
        actor.userId,
        applicationId,
        'PARTNER_APPLICATION_REVIEW_MATERIAL_READ',
        { submissionId, storedFileId, kind: file.kind },
      );
      await this.snapshot(tx, actor, applicationId, submissionId);
    }, options);
    return { buffer, mimeType: file.mimeType!, kind: file.kind };
  }

  reject(
    actor: AuthenticatedUser,
    applicationId: string,
    submissionId: string,
    input: RejectPartnerApplicationDto,
    key: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const initial = await this.snapshot(
        tx,
        actor,
        applicationId,
        submissionId,
      );
      // Match approval's User order before any reviewer foreign-key write.
      await tx.$queryRaw`SELECT "id" FROM "User"
        WHERE "id" IN (${initial.owner}::uuid, ${actor.userId}::uuid) ORDER BY "id" FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "UserRole" WHERE "userId" = ${actor.userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "PartnerApplication" WHERE "id" = ${applicationId}::uuid FOR UPDATE`;
      const context = await this.snapshot(
        tx,
        actor,
        applicationId,
        submissionId,
      );
      if (await tx.userRole.count({ where: { userId: context.owner } }))
        this.conflict();
      const route = `/management/partner-applications/${applicationId}/submissions/${submissionId}/reject`;
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: input,
        actorUserId: actor.userId,
        campusId: null,
      });
      if (claim.replayed) {
        await this.snapshot(tx, actor, applicationId, submissionId);
        return claim.responseBody;
      }
      if (
        context.application.status !== 'SUBMITTED' ||
        context.application.version !== input.expectedVersion ||
        context.latest.id !== submissionId ||
        context.snapshot.applicationVersion !== input.expectedVersion ||
        context.snapshot.review
      )
        this.conflict();
      const version = this.next(input.expectedVersion);
      const review = await tx.partnerApplicationReview.create({
        data: {
          submissionId,
          reviewerUserId: actor.userId,
          decision: 'REJECTED',
          reason: input.reason.trim(),
          sourceVersion: input.expectedVersion,
          resultingVersion: version,
        },
      });
      await tx.partnerApplication.update({
        where: { id: applicationId },
        data: { status: 'REJECTED', version },
      });
      const receipt = {
        applicationId,
        submissionId,
        reviewId: review.id,
        status: 'REJECTED',
        version,
        reviewedAt: review.reviewedAt.toISOString(),
      };
      await this.audit(
        tx,
        actor.userId,
        applicationId,
        'PARTNER_APPLICATION_REJECT',
        {
          submissionId,
          reviewId: review.id,
          previousVersion: input.expectedVersion,
          version,
        },
      );
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: receipt,
      });
      await this.snapshot(tx, actor, applicationId, submissionId);
      return receipt;
    }, options);
  }

  approve(
    actor: AuthenticatedUser,
    applicationId: string,
    submissionId: string,
    input: SubmitPartnerApplicationDto,
    key: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const initial = await this.snapshot(
        tx,
        actor,
        applicationId,
        submissionId,
      );
      // Lock only these two users in a stable order; both precede the application.
      // The reviewer User lock also prevents inserting a second role via its FK.
      await tx.$queryRaw`SELECT "id" FROM "User"
        WHERE "id" IN (${initial.owner}::uuid, ${actor.userId}::uuid) ORDER BY "id" FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "UserRole" WHERE "userId" = ${actor.userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "PartnerApplication" WHERE "id" = ${applicationId}::uuid FOR UPDATE`;
      const context = await this.snapshot(
        tx,
        actor,
        applicationId,
        submissionId,
      );
      const route = `/management/partner-applications/${applicationId}/submissions/${submissionId}/approve`;
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: input,
        actorUserId: actor.userId,
        campusId: null,
      });
      if (claim.replayed) {
        await this.snapshot(tx, actor, applicationId, submissionId);
        return claim.responseBody;
      }
      if (
        context.application.status !== 'SUBMITTED' ||
        context.application.version !== input.expectedVersion ||
        context.latest.id !== submissionId ||
        context.snapshot.applicationVersion !== input.expectedVersion ||
        context.snapshot.review
      )
        this.conflict();
      // The identity lock prevents unbinding or moving the original identity before commit.
      await tx.$queryRaw`SELECT "id" FROM "AuthIdentity" WHERE "userId" = ${context.owner}::uuid AND "provider" = 'WECHAT' FOR UPDATE`;
      const identity = await tx.authIdentity.findUnique({
        where: {
          userId_provider: { userId: context.owner, provider: 'WECHAT' },
        },
      });
      if (
        !identity ||
        (await tx.userRole.count({ where: { userId: context.owner } })) ||
        (await tx.partnerApplicationApproval.count({
          where: { userId: context.owner },
        }))
      )
        this.conflict();
      const campus = await tx.campus.create({
        data: {
          code: `PA-${randomUUID()}`,
          name: context.snapshot.institutionName,
          address: context.snapshot.detailedAddress,
          contactPhone: context.snapshot.contactPhone,
          mapVisible: false,
        },
      });
      await this.accounts.activateApprovedPartner(tx, context.owner, campus.id);
      const version = this.next(input.expectedVersion);
      const review = await tx.partnerApplicationReview.create({
        data: {
          submissionId,
          reviewerUserId: actor.userId,
          decision: 'APPROVED',
          reason: '',
          sourceVersion: input.expectedVersion,
          resultingVersion: version,
        },
      });
      await tx.partnerApplicationApproval.create({
        data: {
          submissionId,
          userId: context.owner,
          campusId: campus.id,
        },
      });
      await tx.partnerApplication.update({
        where: { id: applicationId },
        data: { status: 'APPROVED', version },
      });
      const receipt = {
        applicationId,
        submissionId,
        reviewId: review.id,
        userId: context.owner,
        campusId: campus.id,
        status: 'APPROVED',
        version,
        reviewedAt: review.reviewedAt.toISOString(),
      };
      await this.audit(
        tx,
        actor.userId,
        applicationId,
        'PARTNER_APPLICATION_APPROVE',
        {
          submissionId,
          reviewId: review.id,
          userId: context.owner,
          campusId: campus.id,
          previousVersion: input.expectedVersion,
          version,
        },
      );
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: receipt,
      });
      await this.snapshot(tx, actor, applicationId, submissionId);
      const originalIdentity = await tx.authIdentity.findUnique({
        where: { id: identity.id },
      });
      const roles = await tx.userRole.findMany({
        where: { userId: context.owner },
      });
      if (
        !originalIdentity ||
        originalIdentity.userId !== context.owner ||
        originalIdentity.provider !== 'WECHAT' ||
        originalIdentity.subject !== identity.subject ||
        roles.length !== 1 ||
        roles[0].roleCode !== 'PARTNER' ||
        roles[0].campusId !== campus.id
      )
        this.conflict();
      return receipt;
    }, options);
  }

  history(actor: Applicant, query: PartnerApplicationHistoryQueryDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.applicant(tx, actor);
      const application = await tx.partnerApplication.findUnique({
        where: { applicantId: actor.applicantId },
      });
      const where = { application: { applicantId: actor.applicantId } };
      const total = await tx.partnerApplicationSubmission.count({ where });
      const submissions = await tx.partnerApplicationSubmission.findMany({
        where,
        include: { review: true },
        orderBy: { applicationVersion: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      await this.applicant(tx, actor);
      return {
        applicationId: application?.id ?? null,
        status: application?.status ?? null,
        version: application?.version ?? 0,
        editSourceSubmissionId: application?.editSourceSubmissionId ?? null,
        data: submissions.map((s) => ({
          submissionId: s.id,
          submissionVersion: s.applicationVersion,
          submittedAt: s.submittedAt.toISOString(),
          institutionName: s.institutionName,
          review: this.reviewView(s.review),
        })),
        meta: this.meta(query, total),
      };
    });
  }

  reopen(actor: Applicant, input: ReopenPartnerApplicationDto, key: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "PartnerApplicantSession" WHERE "id" = ${actor.sessionId}::uuid FOR UPDATE`;
      await this.applicant(tx, actor);
      if (await tx.userRole.count({ where: { userId: actor.userId } }))
        this.conflict();
      const route = '/partner-applicants/me/application/reopen';
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: input,
        actorUserId: actor.userId,
        campusId: null,
      });
      if (claim.replayed) return claim.responseBody;
      const a = await tx.partnerApplication.findUnique({
        where: { applicantId: actor.applicantId },
        include: {
          submissions: {
            orderBy: { applicationVersion: 'desc' },
            take: 1,
            include: { review: true },
          },
        },
      });
      const s = a?.submissions[0];
      if (
        !a ||
        !s ||
        a.status !== 'REJECTED' ||
        a.version !== input.expectedVersion ||
        s.id !== input.submissionId ||
        s.review?.decision !== 'REJECTED' ||
        s.review.resultingVersion !== a.version
      )
        this.conflict();
      const frozen = {
        ...a,
        ...this.basics(s),
        currentBankRecordId: s.bankRecordId,
        currentMaterialRecordId: s.materialRecordId,
        version: s.applicationVersion,
      };
      await this.banks.validateForSubmission(tx, frozen, actor);
      await this.materials.validateForSubmission(tx, actor, frozen);
      const version = this.next(a.version);
      await tx.partnerApplication.update({
        where: { id: a.id },
        data: {
          ...this.basics(s),
          status: 'DRAFT',
          version,
          currentBankRecordId: s.bankRecordId,
          currentMaterialRecordId: s.materialRecordId,
          editSourceSubmissionId: s.id,
        },
      });
      const receipt = {
        applicationId: a.id,
        sourceSubmissionId: s.id,
        version,
        status: 'DRAFT',
      };
      await this.audit(tx, actor.userId, a.id, 'PARTNER_APPLICATION_REOPEN', {
        sourceSubmissionId: s.id,
        previousVersion: a.version,
        version,
      });
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: receipt,
      });
      await this.applicant(tx, actor);
      return receipt;
    }, options);
  }

  private async snapshot(
    tx: Tx,
    actor: AuthenticatedUser,
    applicationId: string,
    submissionId: string,
  ) {
    await this.admin(tx, actor);
    const snapshot = await tx.partnerApplicationSubmission.findFirst({
      where: { id: submissionId, applicationId },
      include: {
        review: true,
        application: {
          include: {
            applicant: {
              select: { userId: true, user: { select: { status: true } } },
            },
            submissions: {
              orderBy: { applicationVersion: 'desc' },
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    });
    if (!snapshot) this.notFound();
    const application = snapshot.application;
    const owner = application.applicant.userId;
    if (owner === actor.userId)
      throw new DomainError('FORBIDDEN', '不能审核本人的入驻申请', 403);
    if (application.applicant.user.status !== 'ACTIVE') this.conflict();
    return { snapshot, application, owner, latest: application.submissions[0] };
  }
  private frozenApplication(
    context: Awaited<ReturnType<PartnerApplicationReviewService['snapshot']>>,
  ) {
    return {
      ...context.application,
      version: context.snapshot.applicationVersion,
      currentMaterialRecordId: context.snapshot.materialRecordId,
      currentBankRecordId: context.snapshot.bankRecordId,
    };
  }
  private async admin(tx: Tx, actor: AuthenticatedUser) {
    const user = await tx.user.findUnique({
      where: { id: actor.userId },
      select: {
        status: true,
        roles: { select: { roleCode: true, campusId: true } },
      },
    });
    if (!user || user.status !== 'ACTIVE')
      throw new DomainError('UNAUTHORIZED', '审核登录已失效', 401);
    if (
      user.roles.length !== 1 ||
      user.roles[0].roleCode !== 'SUPER_ADMIN' ||
      user.roles[0].campusId !== null ||
      !ROLE_PERMISSION_MATRIX.SUPER_ADMIN.includes('PARTNER_APPLICATION_REVIEW')
    )
      throw new DomainError('FORBIDDEN', '无入驻审核权限', 403);
  }
  private async applicant(tx: Tx, actor: Applicant) {
    if (
      !(await tx.partnerApplicantSession.findFirst({
        where: {
          id: actor.sessionId,
          applicantId: actor.applicantId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          applicant: { userId: actor.userId, user: { status: 'ACTIVE' } },
        },
        select: { id: true },
      }))
    )
      throw new DomainError('UNAUTHORIZED', '申请登录已失效', 401);
  }
  private basics(s: PartnerApplicationSubmission) {
    return {
      institutionName: s.institutionName,
      province: s.province,
      city: s.city,
      district: s.district,
      detailedAddress: s.detailedAddress,
      contactPhone: s.contactPhone,
    };
  }
  private reviewView(
    review: {
      id: string;
      decision: string;
      reason: string;
      reviewedAt: Date;
    } | null,
  ) {
    return review
      ? {
          reviewId: review.id,
          decision: review.decision,
          reason: review.reason,
          reviewedAt: review.reviewedAt.toISOString(),
        }
      : null;
  }
  private meta(query: PartnerApplicationHistoryQueryDto, total: number) {
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }
  private audit(
    tx: Tx,
    userId: string,
    applicationId: string,
    action: string,
    details: Prisma.InputJsonObject,
  ) {
    return tx.auditLog.create({
      data: {
        actorUserId: userId,
        campusId: null,
        resourceType: 'PartnerApplication',
        resourceId: applicationId,
        action,
        outcome: 'SUCCESS',
        details,
      },
    });
  }
  private next(version: number) {
    if (version >= 2_147_483_647) this.conflict();
    return version + 1;
  }
  private notFound(): never {
    throw new DomainError('RESOURCE_NOT_FOUND', '申请版本或材料不存在', 404);
  }
  private conflict(): never {
    throw new DomainError('CONFLICT', '申请状态或版本已更新，请重新读取', 409);
  }
}
