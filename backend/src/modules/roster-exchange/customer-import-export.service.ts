import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { CustomerRosterInput, RosterRowResult } from './roster.types';
import { normalizeRosterName, normalizeRosterPhone } from './roster-validation';

const CUSTOMER_ROW_ROUTE = '/rosters/customers/rows';

interface NormalizedCustomerRow {
  studentName: string;
  parentPhone: string;
}

@Injectable()
export class CustomerImportExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async previewRow(
    campusId: string,
    input: CustomerRosterInput,
    rowNumber: number,
    values: string[],
  ): Promise<RosterRowResult> {
    const normalized = this.normalize(input);
    if ('reason' in normalized) return this.result(rowNumber, 'ERROR', normalized.reason, values);
    const existing = await this.findPhoneOwner(this.prisma, normalized.parentPhone);
    return this.classifyExisting(existing, campusId, normalized.studentName, rowNumber, values);
  }

  async importRow(
    actor: AuthenticatedUser,
    campusId: string,
    input: CustomerRosterInput,
    rowNumber: number,
    values: string[],
    idempotencyKey: string,
  ): Promise<RosterRowResult> {
    const normalized = this.normalize(input);
    if ('reason' in normalized) return this.result(rowNumber, 'ERROR', normalized.reason, values);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (transaction) => {
          const claim = await this.idempotency.claim(transaction, {
            key: idempotencyKey,
            route: CUSTOMER_ROW_ROUTE,
            request: { ...normalized, campusId, rowNumber },
            campusId,
            actorUserId: actor.userId,
          });
          if (claim.replayed) return claim.responseBody as unknown as RosterRowResult;

          let parent = await this.findPhoneOwner(transaction, normalized.parentPhone);
          if (parent) {
            await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${parent.id}::uuid FOR UPDATE`;
            parent = await this.findPhoneOwner(transaction, normalized.parentPhone);
          }
          const classification = this.classifyExisting(
            parent,
            campusId,
            normalized.studentName,
            rowNumber,
            values,
          );
          if (classification.status !== 'VALID') {
            await this.complete(transaction, idempotencyKey, classification);
            return classification;
          }

          let parentUserId = parent?.id;
          if (!parentUserId) {
            const createdParent = await transaction.user.create({
              data: {
                displayName: `${normalized.studentName}家长`,
                parentPhone: normalized.parentPhone,
                status: 'ACTIVE',
                roles: { create: { roleCode: 'PARENT', campusId } },
              },
              select: { id: true },
            });
            parentUserId = createdParent.id;
          }
          const previousBindingCount = await transaction.parentStudentBinding.count({
            where: { parentUserId },
          });
          const student = await transaction.student.create({
            data: { campusId, displayName: normalized.studentName, isActive: true },
            select: { id: true },
          });
          await transaction.parentStudentBinding.create({
            data: {
              campusId,
              parentUserId,
              studentId: student.id,
              isPrimary: previousBindingCount === 0,
            },
          });
          const response = this.result(rowNumber, 'CREATED', '已导入', values);
          await transaction.auditLog.create({
            data: {
              campusId,
              actorUserId: actor.userId,
              action: 'CUSTOMER_ROSTER_ENTRY_CREATE',
              resourceType: 'Student',
              resourceId: student.id,
              outcome: 'SUCCESS',
              details: {
                templateVersion: 'CUSTOMER_V1',
                rowNumber,
                reusedParent: Boolean(parent),
                phoneLast4: normalized.parentPhone.slice(-4),
              },
            },
          });
          await this.complete(transaction, idempotencyKey, response);
          return response;
        });
      } catch (error) {
        if (attempt === 0 && this.isUniqueConstraint(error)) continue;
        throw error;
      }
    }
    return this.result(rowNumber, 'ERROR', '手机号并发写入冲突，请重试', values);
  }

  async exportRows(
    campusId?: string,
    query?: string,
    includeCampusColumn = false,
  ): Promise<string[][]> {
    const bindings = await this.prisma.parentStudentBinding.findMany({
      where: {
        ...(campusId ? { campusId } : {}),
        student: {
          isActive: true,
          ...(query?.trim()
            ? { displayName: { contains: query.trim(), mode: 'insensitive' } }
            : {}),
        },
      },
      orderBy: [
        { campus: { name: 'asc' } },
        { student: { displayName: 'asc' } },
        { id: 'asc' },
      ],
      select: {
        campus: { select: { name: true } },
        student: { select: { displayName: true } },
        parentUser: { select: { parentPhone: true } },
      },
    });
    return bindings.map(({ student, parentUser, campus }) => [
      student.displayName,
      parentUser.parentPhone?.replace(/^\+86/, '') ?? '',
      ...(includeCampusColumn ? [campus.name] : []),
    ]);
  }

  private normalize(
    input: CustomerRosterInput,
  ): NormalizedCustomerRow | { reason: string } {
    const studentName = normalizeRosterName(input.studentName);
    if (!studentName) return { reason: '学员姓名不能为空' };
    if (studentName.length > 100) return { reason: '学员姓名不能超过100个字符' };
    const parentPhone = normalizeRosterPhone(input.parentPhone);
    if (!parentPhone) return { reason: '手机号格式错误' };
    return { studentName, parentPhone };
  }

  private async findPhoneOwner(
    client: Pick<Prisma.TransactionClient, 'user'>,
    phone: string,
  ) {
    return client.user.findFirst({
      where: { OR: [{ parentPhone: phone }, { staffPhone: phone }] },
      select: {
        id: true,
        parentPhone: true,
        staffPhone: true,
        roles: { select: { roleCode: true, campusId: true } },
        parentStudentBindings: {
          select: {
            campusId: true,
            student: { select: { displayName: true, isActive: true } },
          },
        },
      },
    });
  }

  private classifyExisting(
    existing: Awaited<ReturnType<CustomerImportExportService['findPhoneOwner']>>,
    campusId: string,
    studentName: string,
    rowNumber: number,
    values: string[],
  ): RosterRowResult {
    if (!existing) return this.result(rowNumber, 'VALID', '可以导入', values);
    if (
      existing.staffPhone ||
      !existing.parentPhone ||
      existing.roles.length !== 1 ||
      existing.roles[0].roleCode !== 'PARENT'
    ) {
      return this.result(rowNumber, 'ERROR', '该手机号已属于其他角色', values);
    }
    if (existing.roles[0].campusId !== campusId) {
      return this.result(rowNumber, 'ERROR', '该家长属于其他校区', values);
    }
    const duplicate = existing.parentStudentBindings.some(
      ({ campusId: bindingCampusId, student }) =>
        bindingCampusId === campusId &&
        student.isActive &&
        student.displayName === studentName,
    );
    return duplicate
      ? this.result(rowNumber, 'DUPLICATE', '该学员已绑定此家长，已跳过', values)
      : this.result(rowNumber, 'VALID', '可以导入', values);
  }

  private result(
    rowNumber: number,
    status: RosterRowResult['status'],
    reason: string,
    values: string[],
  ): RosterRowResult {
    return { rowNumber, status, reason, values };
  }

  private complete(
    transaction: Prisma.TransactionClient,
    key: string,
    response: RosterRowResult,
  ) {
    return this.idempotency.complete(transaction, {
      key,
      route: CUSTOMER_ROW_ROUTE,
      responseBody: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue,
    });
  }

  private isUniqueConstraint(error: unknown): boolean {
    return Boolean(
      typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'P2002',
    );
  }
}
