import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ApplicantRequest } from './partner-applicant.guard';
import type { SubmitPartnerApplicationDto } from './dto/partner-application-submit.dto';
import { PartnerApplicationBankService } from './partner-application-bank.service';
import { PartnerApplicationMaterialService } from './partner-application-material.service';
import {
  PARTNER_APPLICATION_REGION_CATALOG,
  type PartnerApplicationRegionCatalog,
} from './partner-application-region-catalog';
import { privateBankUnavailable } from './partner-application-private-cipher';

type Actor = ApplicantRequest['applicant'];
const route = '/partner-applicants/me/application/submit';

@Injectable()
export class PartnerApplicationSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly banks: PartnerApplicationBankService,
    private readonly materials: PartnerApplicationMaterialService,
    @Inject(PARTNER_APPLICATION_REGION_CATALOG)
    private readonly regions: PartnerApplicationRegionCatalog,
  ) {}

  submit(actor: Actor, input: SubmitPartnerApplicationDto, key: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "PartnerApplicantSession" WHERE "id" = ${actor.sessionId}::uuid FOR UPDATE`;
        await this.authorize(tx, actor);
        if (await tx.userRole.count({ where: { userId: actor.userId } }))
          this.conflict('正式账号不能提交入驻申请');
        const claim = await this.idempotency.claim(tx, {
          key,
          route,
          request: { expectedVersion: input.expectedVersion },
          campusId: null,
          actorUserId: actor.userId,
        });
        if (claim.replayed) return claim.responseBody;
        const application = await tx.partnerApplication.findUnique({
          where: { applicantId: actor.applicantId },
        });
        if (!application || application.status !== 'DRAFT')
          this.conflict('当前申请不能送审，请读取最新状态');
        if (application.version !== input.expectedVersion)
          this.conflict('草稿已更新，请读取最新版本后送审');
        if (application.version === 2_147_483_647)
          this.conflict('草稿版本已达上限，不能送审');
        const {
          institutionName,
          province,
          city,
          district,
          detailedAddress,
          contactPhone,
        } = application;
        if (
          ![
            institutionName,
            province,
            city,
            district,
            detailedAddress,
            contactPhone,
          ].every((value) => Boolean(value?.trim()))
        )
          throw new DomainError(
            'BAD_REQUEST',
            '请完整填写并保存机构基础信息',
            400,
          );
        const phone = contactPhone!;
        const digits = phone.replace(/\D/g, '');
        if (
          !/^\+?[\d ()-]+$/.test(phone) ||
          digits.length < 7 ||
          digits.length > 15 ||
          !/^[^()]*?(?:\(\d+\)[^()]*)?$/.test(phone)
        )
          throw new DomainError('BAD_REQUEST', '请检查联系电话格式并保存', 400);
        if (!this.regions.version || this.regions.version.length > 100)
          privateBankUnavailable();
        if (!this.regions.matches(province!, city!, district!))
          throw new DomainError(
            'BAD_REQUEST',
            '省市区不属于同一地区层级，请重新选择并保存',
            400,
          );
        const bankRecordId = await this.banks.validateForSubmission(
          tx,
          application,
          actor,
        );
        const materialRecordId = await this.materials.validateForSubmission(
          tx,
          actor,
          application,
        );
        const version = application.version + 1;
        const snapshot = await tx.partnerApplicationSubmission.create({
          data: {
            applicationId: application.id,
            applicationVersion: version,
            sourceVersion: application.version,
            institutionName: institutionName!,
            province: province!,
            city: city!,
            district: district!,
            detailedAddress: detailedAddress!,
            contactPhone: phone,
            regionCatalogVersion: this.regions.version,
            bankRecordId,
            materialRecordId,
          },
        });
        await tx.partnerApplication.update({
          where: { id: application.id },
          data: { status: 'SUBMITTED', version },
        });
        const receipt = {
          applicationId: application.id,
          submissionId: snapshot.id,
          version,
          status: 'SUBMITTED',
          submittedAt: snapshot.submittedAt.toISOString(),
        };
        await tx.auditLog.create({
          data: {
            campusId: null,
            actorUserId: actor.userId,
            action: 'PARTNER_APPLICATION_SUBMIT',
            resourceType: 'PartnerApplication',
            resourceId: application.id,
            outcome: 'SUCCESS',
            details: {
              submissionId: snapshot.id,
              previousVersion: application.version,
              version,
              bankRecordId,
              materialRecordId,
            },
          },
        });
        await this.idempotency.complete(tx, {
          key,
          route,
          responseBody: receipt,
        });
        await this.authorize(tx, actor);
        return receipt;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  private async authorize(tx: Prisma.TransactionClient, actor: Actor) {
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
      throw new DomainError('UNAUTHORIZED', '申请登录凭证已失效', 401);
  }

  private conflict(message: string): never {
    throw new DomainError('CONFLICT', message, 409);
  }
}
