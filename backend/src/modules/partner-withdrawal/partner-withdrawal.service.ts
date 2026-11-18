import { Injectable } from '@nestjs/common';
import { Prisma, type PartnerWithdrawalStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { ManualPayoutAdapter } from '../../infrastructure/payout/manual-payout.adapter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PayoutProofService } from '../file/payout-proof.service';
import { StoredFileService } from '../file/stored-file.service';
import {
  assertSettlementActor,
  lockPartnerSettlementCampus,
  recordPartnerSettlementIssues,
  requirePartner,
  requireReviewer,
  requireSimulation,
  settlementAudit,
  settlementProfileView,
  settlementSources,
  type SettlementTx,
} from './partner-settlement-account';
import { PartnerSettlementService } from './partner-settlement.service';
import {
  allocateSettlement,
  assertPartnerWithdrawalTransition,
  withdrawalConflict,
} from './partner-withdrawal-rules';
import type {
  ManagedPartnerWithdrawalQueryDto,
  PartnerWithdrawalActionDto,
  PartnerWithdrawalCreateDto,
  PartnerWithdrawalQueryDto,
  SettlementVersionDto,
} from './partner-withdrawal.dto';
import { simulatedWithdrawalPdf } from './simulated-withdrawal-pdf';

const withdrawalInclude = {
  campus: { select: { name: true } },
  proof: { select: { fileId: true, outcome: true } },
  allocations: { select: { issue: { select: { amountFen: true } } } },
} satisfies Prisma.PartnerWithdrawalInclude;
type WithdrawalRow = Prisma.PartnerWithdrawalGetPayload<{
  include: typeof withdrawalInclude;
}>;
function view(w: WithdrawalRow) {
  return {
    id: w.id,
    campusId: w.campusId,
    campusName: w.campus.name,
    requestNo: w.requestNo,
    amountFen: w.amountFen,
    status: w.status,
    version: w.version,
    simulated: true,
    profile: w.profileSnapshot,
    requestedAt: w.createdAt.toISOString(),
    reviewedAt: w.reviewedAt?.toISOString() ?? null,
    payingAt: w.payingAt?.toISOString() ?? null,
    paidAt: w.paidAt?.toISOString() ?? null,
    reason: w.reason,
    payoutReference: w.payoutReference,
    proofFileId: w.proof?.fileId ?? null,
    proofOutcome: w.proof?.outcome ?? null,
    unresolvedFen: w.allocations.reduce(
      (sum, a) => sum + (a.issue?.amountFen ?? 0),
      0,
    ),
  };
}
function missing(): never {
  throw new DomainError(ErrorCode.RESOURCE_NOT_FOUND, '提现记录不存在', 404);
}
function invalid(message: string): never {
  throw new DomainError(ErrorCode.PAYOUT_PROOF_INVALID, message, 400);
}

@Injectable()
export class PartnerWithdrawalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly settlement: PartnerSettlementService,
    private readonly proofs: PayoutProofService,
    private readonly files: StoredFileService,
    private readonly payout: ManualPayoutAdapter,
  ) {}
  applicationTime() {
    return new Date();
  }

  ownList(actor: AuthenticatedUser, query: PartnerWithdrawalQueryDto) {
    const campusId = requirePartner(actor);
    requireSimulation();
    return this.list(actor, { campusId }, query);
  }
  managedList(
    actor: AuthenticatedUser,
    query: ManagedPartnerWithdrawalQueryDto,
  ) {
    requireReviewer(actor);
    requireSimulation();
    return this.list(
      actor,
      query.campusId ? { campusId: query.campusId } : {},
      query,
    );
  }
  private list(
    actor: AuthenticatedUser,
    where: Prisma.PartnerWithdrawalWhereInput,
    query: PartnerWithdrawalQueryDto,
  ) {
    return this.settlement.read(actor, async (tx) => {
      const total = await tx.partnerWithdrawal.count({ where });
      const rows = await tx.partnerWithdrawal.findMany({
        where,
        include: withdrawalInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return {
        data: rows.map(view),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize),
        },
      };
    });
  }
  detail(actor: AuthenticatedUser, id: string, managed = false) {
    const campusId = managed
      ? (requireReviewer(actor), undefined)
      : requirePartner(actor);
    requireSimulation();
    return this.settlement.read(actor, async (tx) =>
      view(await this.row(tx, id, campusId)),
    );
  }
  private async row(tx: SettlementTx, id: string, campusId?: string) {
    const w = await tx.partnerWithdrawal.findFirst({
      where: { id, ...(campusId ? { campusId } : {}) },
      include: withdrawalInclude,
    });
    return w ?? missing();
  }
  create(
    actor: AuthenticatedUser,
    dto: PartnerWithdrawalCreateDto,
    key: string,
  ) {
    const campusId = requirePartner(actor);
    requireSimulation();
    return this.write(
      actor,
      campusId,
      '/partners/me/withdrawals',
      dto,
      key,
      async (tx) => {
        const applicationAt = this.applicationTime();
        const s = await this.settlement.summary(tx, campusId, applicationAt);
        if (!s.profile || s.profile.version !== dto.expectedProfileVersion)
          withdrawalConflict();
        if (!s.canApply)
          withdrawalConflict('当前不可申请，请查看额度或待核对事项');
        if (dto.amountFen < s.profile.minimumAmountFen)
          throw new DomainError(
            ErrorCode.WITHDRAWAL_AMOUNT_INVALID,
            '申请金额低于最低金额',
            409,
          );
        const { sources } = await settlementSources(tx, campusId);
        const allocations = allocateSettlement(sources, dto.amountFen);
        const profile = await tx.partnerSettlementProfile.findUniqueOrThrow({
          where: { campusId },
        });
        const w = await tx.partnerWithdrawal.create({
          data: {
            campusId,
            requestNo: `SIM-PW-${randomUUID()}`,
            requestedByUserId: actor.userId,
            amountFen: dto.amountFen,
            profileSnapshot: settlementProfileView(profile),
            allocations: { create: allocations },
            createdAt: applicationAt,
          },
          include: withdrawalInclude,
        });
        await settlementAudit(
          tx,
          actor.userId,
          campusId,
          'WITHDRAWAL_CREATE',
          w.id,
          { amountFen: w.amountFen, profileVersion: profile.version },
        );
        return view(w);
      },
    );
  }
  async cancel(
    actor: AuthenticatedUser,
    id: string,
    dto: SettlementVersionDto,
    key: string,
  ) {
    const campusId = requirePartner(actor);
    requireSimulation();
    return this.write(
      actor,
      campusId,
      `/partners/me/withdrawals/${id}/cancel`,
      dto,
      key,
      async (tx) => {
        const w = await this.row(tx, id, campusId);
        if (w.version !== dto.expectedVersion) withdrawalConflict();
        assertPartnerWithdrawalTransition(w.status, 'CANCELLED');
        await tx.partnerWithdrawal.update({
          where: { id },
          data: { status: 'CANCELLED', version: { increment: 1 } },
        });
        await settlementAudit(
          tx,
          actor.userId,
          campusId,
          'WITHDRAWAL_CANCEL',
          id,
          { beforeStatus: w.status },
        );
        return view(await this.row(tx, id, campusId));
      },
    );
  }
  async action(
    actor: AuthenticatedUser,
    id: string,
    action: string,
    dto: PartnerWithdrawalActionDto,
    key: string,
  ) {
    requireReviewer(actor);
    requireSimulation();
    const identity = await this.prisma.partnerWithdrawal.findUnique({
      where: { id },
      select: { campusId: true },
    });
    if (!identity) missing();
    return this.write(
      actor,
      identity.campusId,
      `/management/partner-withdrawals/${id}/${action}`,
      dto,
      key,
      async (tx) => {
        const w = await this.row(tx, id);
        if (w.requestedByUserId === actor.userId)
          throw new DomainError(
            ErrorCode.FORBIDDEN,
            '不能处理本人提现申请',
            403,
          );
        if (w.version !== dto.expectedVersion) withdrawalConflict();
        const targets: Record<string, PartnerWithdrawalStatus> = {
          approve: 'APPROVED',
          reject: 'REJECTED',
          'mark-paying': 'PAYING',
          'mark-unknown': 'RECONCILING',
          'mark-paid': 'PAID',
          'mark-failed': 'FAILED',
        };
        if (action !== 'mock-proof' && !targets[action]) invalid('操作不存在');
        const actionFields: Record<string, string[]> = {
          approve: [],
          reject: ['reason'],
          'mark-paying': [],
          'mark-unknown': ['reason'],
          'mark-paid': [
            'amountFen',
            'accountVersion',
            'payoutReference',
            'proofFileId',
            'paidAt',
          ],
          'mark-failed': ['reason', 'confirmedUnpaid', 'proofFileId'],
          'mock-proof': ['reason', 'evidenceOutcome'],
        };
        if (
          Object.entries(dto).some(
            ([field, value]) =>
              value !== undefined &&
              field !== 'expectedVersion' &&
              !actionFields[action].includes(field),
          )
        )
          invalid('当前操作包含不适用的字段');
        if (
          ['reject', 'mark-unknown', 'mark-failed'].includes(action) &&
          !dto.reason?.trim()
        )
          invalid('请填写处理原因');
        const data: Prisma.PartnerWithdrawalUncheckedUpdateInput = {
          version: { increment: 1 },
        };
        if (action === 'mock-proof') {
          if (!dto.evidenceOutcome || !dto.reason?.trim())
            invalid('请填写模拟核对结果与原因');
          if (!['APPROVED', 'PAYING', 'RECONCILING'].includes(w.status))
            withdrawalConflict();
          if (w.status === 'APPROVED' && dto.evidenceOutcome === 'PAID')
            invalid('尚未开始出款，不能生成已付证据');
          if (w.proof && w.proof.outcome !== dto.evidenceOutcome)
            withdrawalConflict('已有证据不能覆盖为另一种核对结果');
          if (!w.proof) {
            const buffer = simulatedWithdrawalPdf(
              w.requestNo,
              w.amountFen,
              (w.profileSnapshot as { version: number }).version,
              dto.evidenceOutcome,
            );
            // File writes are retained if the surrounding business transaction rolls back.
            const stored = await this.proofs.store(actor, {
              originalname: `${w.requestNo}.pdf`,
              mimetype: 'application/pdf',
              size: buffer.length,
              buffer,
            });
            await tx.partnerPayoutProof.create({
              data: {
                withdrawalId: id,
                fileId: stored.id,
                outcome: dto.evidenceOutcome,
              },
            });
          }
        } else {
          const target = targets[action];
          assertPartnerWithdrawalTransition(w.status, target);
          data.status = target;
          if (action === 'approve' || action === 'reject') {
            data.reviewedByUserId = actor.userId;
            data.reviewedAt = new Date();
          }
          if (action === 'mark-paying') {
            if (w.proof) withdrawalConflict('已绑定核对证据，不得再开始出款');
            data.payingAt = new Date();
          }
          if (action === 'mark-paid') {
            if (
              !dto.proofFileId ||
              dto.proofFileId !== w.proof?.fileId ||
              w.proof?.outcome !== 'PAID' ||
              !dto.payoutReference?.match(/^SIM-\S+$/) ||
              !dto.paidAt ||
              !dto.amountFen ||
              !dto.accountVersion
            )
              invalid(
                '请提供本单模拟付款凭证、模拟参考号、金额、账户版本和到账时间',
              );
            if (
              dto.amountFen !== w.amountFen ||
              dto.accountVersion !==
                (w.profileSnapshot as { version: number }).version
            )
              withdrawalConflict('付款金额或账户快照不匹配');
            const paidAt = new Date(dto.paidAt);
            if (
              !Number.isFinite(paidAt.getTime()) ||
              paidAt > new Date() ||
              !w.payingAt ||
              paidAt < w.payingAt
            )
              invalid('付款时间必须在开始出款之后且不晚于当前时间');
            await this.payout.markPaid({
              withdrawalId: id,
              payoutReference: dto.payoutReference,
              payoutProofFileId: dto.proofFileId,
            });
            data.paidAt = paidAt;
            data.paidByUserId = actor.userId;
            data.payoutReference = dto.payoutReference;
          }
          if (
            action === 'mark-failed' &&
            (dto.confirmedUnpaid !== true ||
              !dto.proofFileId ||
              dto.proofFileId !== w.proof?.fileId ||
              w.proof?.outcome !== 'UNPAID')
          )
            invalid('必须核对本单模拟未付款凭证并明确确认未付款');
          if (dto.reason) data.reason = dto.reason.trim();
        }
        await tx.partnerWithdrawal.update({ where: { id }, data });
        if (action === 'mark-paid') await recordPartnerSettlementIssues(tx, id);
        await settlementAudit(
          tx,
          actor.userId,
          w.campusId,
          `WITHDRAWAL_${action.replaceAll('-', '_').toUpperCase()}`,
          id,
          {
            beforeStatus: w.status,
            afterStatus: targets[action] ?? w.status,
            reason: dto.reason ?? null,
            evidenceOutcome: dto.evidenceOutcome ?? null,
          },
        );
        return view(await this.row(tx, id));
      },
    );
  }
  async readProof(actor: AuthenticatedUser, id: string) {
    if (actor.roles[0]?.code === 'SUPER_ADMIN') requireReviewer(actor);
    else requirePartner(actor);
    requireSimulation();
    return this.settlement.read(actor, async (tx) => {
      const campusId =
        actor.roles[0].code === 'PARTNER' ? requirePartner(actor) : undefined;
      const w = await this.row(tx, id, campusId);
      if (!w.proof) missing();
      const result = await this.files.readPrivateFile(w.proof.fileId, {
        purpose: 'PAYOUT_PROOF',
        directory: 'payout-proofs',
        allowedMimeTypes: ['application/pdf'],
        maxBytes: 10 * 1024 * 1024,
        invalidCode: 'PAYOUT_PROOF_INVALID',
        label: '模拟付款凭证',
      });
      await settlementAudit(
        tx,
        actor.userId,
        w.campusId,
        'WITHDRAWAL_PROOF_READ',
        id,
      );
      return result;
    });
  }
  private async write<T extends Prisma.InputJsonObject>(
    actor: AuthenticatedUser,
    campusId: string,
    route: string,
    request: object,
    key: string,
    fn: (tx: SettlementTx) => Promise<T>,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await lockPartnerSettlementCampus(tx, campusId);
          await assertSettlementActor(tx, actor);
          const claim = await this.idempotency.claim(tx, {
            key,
            route,
            request,
            campusId,
            actorUserId: actor.userId,
          });
          if (claim.replayed) return claim.responseBody;
          const result = await fn(tx);
          await this.idempotency.complete(tx, {
            key,
            route,
            responseBody: result,
          });
          return result;
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        withdrawalConflict('付款参考或记录已被使用，请重新读取');
      throw error;
    }
  }
}
