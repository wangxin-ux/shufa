import { Injectable } from '@nestjs/common';
import type { PartnerApplication, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ApplicantRequest } from './partner-applicant.guard';
import type { SavePartnerApplicationBankDto } from './dto/partner-application-bank.dto';
import {
  BANK_LIMITS,
  PartnerApplicationPrivateCipher,
  privateBankUnavailable,
} from './partner-application-private-cipher';

type Actor = ApplicantRequest['applicant'];

@Injectable()
export class PartnerApplicationBankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PartnerApplicationPrivateCipher,
  ) {}

  getOwn(actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockAndAuthorize(tx, actor);
      const application = await tx.partnerApplication.findUnique({
        where: { applicantId: actor.applicantId },
      });
      const bank = application
        ? await this.currentBank(tx, application, actor)
        : null;
      if (bank) {
        await tx.auditLog.create({
          data: {
            campusId: null,
            actorUserId: actor.userId,
            action: 'PARTNER_APPLICATION_BANK_READ',
            resourceType: 'PartnerApplication',
            resourceId: application!.id,
            outcome: 'SUCCESS',
            details: {
              version: application!.version,
              bankRecordId: bank.record.id,
            },
          },
        });
        // Logout does not acquire the User lock. Recheck the session after the audit.
        await this.authorize(tx, actor);
      }
      return {
        applicationId: application?.id ?? null,
        status: application?.status ?? null,
        version: application?.version ?? 0,
        bankInformation: bank?.information ?? null,
        readonly:
          Boolean(application && application.status !== 'DRAFT') ||
          Boolean(await tx.userRole.count({ where: { userId: actor.userId } })),
      };
    });
  }

  saveOwn(actor: Actor, input: SavePartnerApplicationBankDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockAndAuthorize(tx, actor);
      if (await tx.userRole.count({ where: { userId: actor.userId } }))
        this.conflict('正式账号不能修改入驻草稿');
      const current = await tx.partnerApplication.findUnique({
        where: { applicantId: actor.applicantId },
      });
      if (current && current.status !== 'DRAFT')
        this.conflict('当前申请不能直接修改');
      const information = {
        bankName: input.bankInformation.bankName?.trim() || null,
        accountHolder: input.bankInformation.accountHolder?.trim() || null,
        accountNumber: input.bankInformation.accountNumber?.trim() || null,
      };
      const bank = current ? await this.currentBank(tx, current, actor) : null;
      if (
        bank &&
        Object.keys(BANK_LIMITS).every(
          (field) =>
            bank.information[field as keyof typeof information] ===
            information[field as keyof typeof information],
        ) &&
        bank.record.applicationVersion === current!.version &&
        [current!.version, current!.version - 1].includes(input.expectedVersion)
      ) {
        return this.receipt(current!.id, current!.version, bank.record.id);
      }
      if (input.expectedVersion !== (current?.version ?? 0))
        this.conflict('草稿已更新，请重新读取后保存');
      if (current?.version === 2_147_483_647)
        this.conflict('草稿版本已达上限，不能继续修改');
      const version = (current?.version ?? 0) + 1;
      const applicationId = current?.id ?? randomUUID();
      const id = randomUUID();
      const envelope = this.cipher.encrypt(
        { id, applicationId, ownerUserId: actor.userId },
        information,
      );
      if (!current)
        await tx.partnerApplication.create({
          data: { id: applicationId, applicantId: actor.applicantId },
        });
      await tx.partnerApplicationBankRecord.create({
        data: {
          id,
          applicationId,
          ownerUserId: actor.userId,
          applicationVersion: version,
          ...envelope,
        },
      });
      await tx.partnerApplication.update({
        where: { id: applicationId },
        data: { version, currentBankRecordId: id },
      });
      await tx.auditLog.create({
        data: {
          campusId: null,
          actorUserId: actor.userId,
          action: 'PARTNER_APPLICATION_BANK_SAVE',
          resourceType: 'PartnerApplication',
          resourceId: applicationId,
          outcome: 'SUCCESS',
          details: {
            previousVersion: current?.version ?? 0,
            version,
            bankRecordId: id,
          },
        },
      });
      return this.receipt(applicationId, version, id);
    });
  }

  private async currentBank(
    tx: Prisma.TransactionClient,
    application: PartnerApplication,
    actor: Actor,
  ) {
    if (!application.currentBankRecordId) return null;
    const record = await tx.partnerApplicationBankRecord.findUnique({
      where: { id: application.currentBankRecordId },
    });
    if (
      !record ||
      record.applicationId !== application.id ||
      record.ownerUserId !== actor.userId ||
      record.applicationVersion > application.version
    )
      privateBankUnavailable();
    return { record, information: this.cipher.decrypt(record, record) };
  }

  async validateForSubmission(
    tx: Prisma.TransactionClient,
    application: PartnerApplication,
    actor: Actor,
  ) {
    const bank = await this.currentBank(tx, application, actor);
    if (
      !bank ||
      Object.values(bank.information).some((value) => !value?.trim())
    )
      throw new DomainError('BAD_REQUEST', '请完整填写并保存对公账户', 400);
    return bank.record.id;
  }

  private async lockAndAuthorize(tx: Prisma.TransactionClient, actor: Actor) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "PartnerApplicantSession" WHERE "id" = ${actor.sessionId}::uuid FOR UPDATE`;
    await this.authorize(tx, actor);
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
      throw new DomainError(ErrorCode.UNAUTHORIZED, '申请登录凭证已失效', 401);
  }

  private receipt(
    applicationId: string,
    version: number,
    bankRecordId: string,
  ) {
    return { applicationId, version, bankRecordId };
  }

  private conflict(message: string): never {
    throw new DomainError(ErrorCode.CONFLICT, message, 409);
  }
}
