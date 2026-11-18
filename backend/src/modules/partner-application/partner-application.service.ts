import { Injectable } from '@nestjs/common';
import type { PartnerApplication } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PartnerScopeService } from '../../common/auth/partner-scope.service';
import type { ApplicantRequest } from './partner-applicant.guard';
import type { SavePartnerApplicationBasicDto } from './dto/partner-application-basic.dto';

const BASIC_FIELDS = [
  'institutionName',
  'province',
  'city',
  'district',
  'detailedAddress',
  'contactPhone',
] as const;

@Injectable()
export class PartnerApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partnerScope: PartnerScopeService,
  ) {}

  async getOwnForPartner(user: AuthenticatedUser) {
    const scope = this.partnerScope.require(user);
    const application = await this.prisma.partnerApplication.findFirst({
      where: {
        applicant: { userId: scope.userId, user: { status: 'ACTIVE' } },
      },
    });
    return application ? this.view(application) : null;
  }

  async getOwn(actor: ApplicantRequest['applicant']) {
    const application = await this.prisma.partnerApplication.findUnique({
      where: { applicantId: actor.applicantId },
    });
    return application ? this.view(application) : null;
  }

  saveBasics(
    actor: ApplicantRequest['applicant'],
    input: SavePartnerApplicationBasicDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // User locking also serializes first saves and formal-account activation.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "PartnerApplicantSession" WHERE "id" = ${actor.sessionId}::uuid FOR UPDATE`;
      const session = await tx.partnerApplicantSession.findFirst({
        where: {
          id: actor.sessionId,
          applicantId: actor.applicantId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          applicant: { userId: actor.userId, user: { status: 'ACTIVE' } },
        },
        select: { id: true },
      });
      if (!session)
        throw new DomainError(
          ErrorCode.UNAUTHORIZED,
          '申请登录凭证已失效',
          401,
        );
      if (await tx.userRole.count({ where: { userId: actor.userId } })) {
        this.conflict('正式账号不能重新创建或修改入驻草稿');
      }
      const current = await tx.partnerApplication.findUnique({
        where: { applicantId: actor.applicantId },
      });
      if (current && current.status !== 'DRAFT')
        this.conflict('当前申请不能直接修改');
      const fields = {
        institutionName: input.basicInformation.institutionName?.trim() || null,
        province: input.basicInformation.province?.trim() || null,
        city: input.basicInformation.city?.trim() || null,
        district: input.basicInformation.district?.trim() || null,
        detailedAddress: input.basicInformation.detailedAddress?.trim() || null,
        // Older clients omit this new field; only explicit values replace it.
        contactPhone:
          input.basicInformation.contactPhone === undefined
            ? (current?.contactPhone ?? null)
            : input.basicInformation.contactPhone?.trim() || null,
      };
      const identical =
        current &&
        BASIC_FIELDS.every((field) => current[field] === fields[field]);
      if (
        identical &&
        (input.expectedVersion === current.version ||
          input.expectedVersion === current.version - 1)
      )
        return this.view(current);
      if (input.expectedVersion !== (current?.version ?? 0))
        this.conflict('草稿已更新，请重新读取后保存');
      if (current?.version === 2_147_483_647)
        this.conflict('草稿版本已达上限，不能继续修改');

      const application = current
        ? await tx.partnerApplication.update({
            where: { id: current.id },
            data: { ...fields, version: { increment: 1 } },
          })
        : await tx.partnerApplication.create({
            data: { applicantId: actor.applicantId, ...fields },
          });
      await tx.auditLog.create({
        data: {
          campusId: null,
          actorUserId: actor.userId,
          action: 'PARTNER_APPLICATION_BASIC_SAVE',
          resourceType: 'PartnerApplication',
          resourceId: application.id,
          outcome: 'SUCCESS',
          details: {
            previousVersion: current?.version ?? 0,
            version: application.version,
            changedFields: BASIC_FIELDS.filter(
              (field) => !current || current[field] !== fields[field],
            ),
          },
        },
      });
      return this.view(application);
    });
  }

  private view(application: PartnerApplication) {
    return {
      applicationId: application.id,
      status: application.status,
      version: application.version,
      basicInformation: {
        institutionName: application.institutionName,
        province: application.province,
        city: application.city,
        district: application.district,
        detailedAddress: application.detailedAddress,
        contactPhone: application.contactPhone,
      },
      createdAt: application.createdAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
    };
  }

  private conflict(message: string): never {
    throw new DomainError(ErrorCode.CONFLICT, message, 409);
  }
}
