import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StaffAccountManagementService } from '../management/staff-account-management.service';
import type { RosterRowResult, TeacherRosterInput } from './roster.types';
import { maskRosterPhone, normalizeRosterName, normalizeRosterPhone } from './roster-validation';

interface NormalizedTeacherRow {
  teacherName: string;
  phone: string;
}

export interface TeacherRosterView {
  id: string;
  teacherName: string;
  maskedPhone: string;
  campusId: string;
  campusName: string;
  status: 'ACTIVE' | 'DISABLED';
}

@Injectable()
export class TeacherImportExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAccounts: StaffAccountManagementService,
  ) {}

  async previewRow(
    campusId: string,
    input: TeacherRosterInput,
    rowNumber: number,
    values: string[],
  ): Promise<RosterRowResult> {
    const normalized = this.normalize(input);
    if ('reason' in normalized) return this.result(rowNumber, 'ERROR', normalized.reason, values);
    const existing = await this.findPhoneOwner(normalized.phone);
    return this.classifyExisting(existing, campusId, rowNumber, values);
  }

  async importRow(
    actor: AuthenticatedUser,
    campusId: string,
    input: TeacherRosterInput,
    rowNumber: number,
    values: string[],
    idempotencyKey: string,
  ): Promise<RosterRowResult> {
    const normalized = this.normalize(input);
    if ('reason' in normalized) return this.result(rowNumber, 'ERROR', normalized.reason, values);
    const before = await this.findPhoneOwner(normalized.phone);
    const classification = this.classifyExisting(before, campusId, rowNumber, values);
    if (classification.status !== 'VALID') return classification;
    try {
      await this.staffAccounts.createAccount(
        actor,
        {
          displayName: normalized.teacherName,
          phone: normalized.phone,
          roleCode: 'TEACHER',
          campusId,
        },
        idempotencyKey,
      );
      return this.result(rowNumber, 'CREATED', '已导入', values);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'STAFF_PHONE_ALREADY_EXISTS'
      ) {
        const after = await this.findPhoneOwner(normalized.phone);
        return this.classifyExisting(after, campusId, rowNumber, values);
      }
      throw error;
    }
  }

  async list(
    campusId: string | undefined,
    query: string | undefined,
    page: number,
    pageSize: number,
  ) {
    const where = this.teacherWhere(campusId, query);
    const [total, teachers] = await Promise.all([
      this.prisma.teacherProfile.count({ where }),
      this.prisma.teacherProfile.findMany({
        where,
        orderBy: [
          { campus: { name: 'asc' } },
          { user: { displayName: 'asc' } },
          { id: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          campusId: true,
          campus: { select: { name: true } },
          user: { select: { displayName: true, staffPhone: true, status: true } },
        },
      }),
    ]);
    return {
      data: teachers.map(({ id, campusId: idOfCampus, campus, user }) => ({
        id,
        teacherName: user.displayName,
        maskedPhone: maskRosterPhone(user.staffPhone),
        campusId: idOfCampus,
        campusName: campus.name,
        status: user.status,
      } satisfies TeacherRosterView)),
      meta: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  async exportRows(
    campusId?: string,
    query?: string,
    includeCampusColumn = false,
  ): Promise<string[][]> {
    const teachers = await this.prisma.teacherProfile.findMany({
      where: this.teacherWhere(campusId, query),
      orderBy: [
        { campus: { name: 'asc' } },
        { user: { displayName: 'asc' } },
        { id: 'asc' },
      ],
      select: {
        campus: { select: { name: true } },
        user: { select: { displayName: true, staffPhone: true } },
      },
    });
    return teachers.map(({ campus, user }) => [
      user.displayName,
      user.staffPhone?.replace(/^\+86/, '') ?? '',
      ...(includeCampusColumn ? [campus.name] : []),
    ]);
  }

  private teacherWhere(campusId?: string, query?: string) {
    return {
      ...(campusId ? { campusId } : {}),
      ...(query?.trim()
        ? { user: { displayName: { contains: query.trim(), mode: 'insensitive' as const } } }
        : {}),
    };
  }

  private normalize(
    input: TeacherRosterInput,
  ): NormalizedTeacherRow | { reason: string } {
    const teacherName = normalizeRosterName(input.teacherName);
    if (!teacherName) return { reason: '教师姓名不能为空' };
    if (teacherName.length > 100) return { reason: '教师姓名不能超过100个字符' };
    const phone = normalizeRosterPhone(input.phone);
    if (!phone) return { reason: '手机号格式错误' };
    return { teacherName, phone };
  }

  private findPhoneOwner(phone: string) {
    return this.prisma.user.findFirst({
      where: { OR: [{ staffPhone: phone }, { parentPhone: phone }] },
      select: {
        id: true,
        staffPhone: true,
        parentPhone: true,
        roles: { select: { roleCode: true, campusId: true } },
        teacherProfile: { select: { campusId: true } },
      },
    });
  }

  private classifyExisting(
    existing: Awaited<ReturnType<TeacherImportExportService['findPhoneOwner']>>,
    campusId: string,
    rowNumber: number,
    values: string[],
  ): RosterRowResult {
    if (!existing) return this.result(rowNumber, 'VALID', '可以导入', values);
    if (
      existing.parentPhone ||
      !existing.staffPhone ||
      existing.roles.length !== 1 ||
      existing.roles[0].roleCode !== 'TEACHER' ||
      !existing.teacherProfile
    ) {
      return this.result(rowNumber, 'ERROR', '该手机号已属于其他角色', values);
    }
    if (
      existing.roles[0].campusId !== campusId ||
      existing.teacherProfile.campusId !== campusId
    ) {
      return this.result(rowNumber, 'ERROR', '该教师属于其他校区', values);
    }
    return this.result(rowNumber, 'DUPLICATE', '该教师已存在，已跳过', values);
  }

  private result(
    rowNumber: number,
    status: RosterRowResult['status'],
    reason: string,
    values: string[],
  ): RosterRowResult {
    return { rowNumber, status, reason, values };
  }
}
