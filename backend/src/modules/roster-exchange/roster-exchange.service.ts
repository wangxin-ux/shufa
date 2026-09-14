import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustomerImportExportService } from './customer-import-export.service';
import { RosterExcelAdapter } from './roster-excel.adapter';
import { TeacherImportExportService } from './teacher-import-export.service';
import type {
  CustomerRosterInput,
  ParsedRosterRow,
  RosterImportResult,
  RosterKind,
  RosterPreview,
  RosterRowResult,
  RosterScope,
  RosterTemplateVersion,
  TeacherRosterInput,
  UploadedRosterFile,
} from './roster.types';
import { stableRosterRowKey } from './roster-validation';

interface ResolvedRow {
  row: ParsedRosterRow;
  campusId: string | null;
  reason: string | null;
}

@Injectable()
export class RosterExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly excel: RosterExcelAdapter,
    private readonly customers: CustomerImportExportService,
    private readonly teachers: TeacherImportExportService,
  ) {}

  template(kind: RosterKind, scope: RosterScope) {
    const version = this.version(kind);
    return this.excel.createTemplate(version, scope);
  }

  async preview(
    kind: RosterKind,
    scope: RosterScope,
    campusId: string | undefined,
    file: UploadedRosterFile | undefined,
  ): Promise<RosterPreview> {
    const parsed = await this.parse(kind, scope, file);
    const rows = await this.resolveRows(parsed.rows, scope, campusId);
    const results: RosterRowResult[] = [];
    for (const resolved of rows) {
      results.push(await this.previewResolved(kind, resolved));
    }
    return {
      templateVersion: parsed.version,
      fileHash: parsed.fileHash,
      totalRows: results.length,
      validCount: results.filter(({ status }) => status === 'VALID').length,
      duplicateCount: results.filter(({ status }) => status === 'DUPLICATE').length,
      errorCount: results.filter(({ status }) => status === 'ERROR').length,
      rows: results,
    };
  }

  async import(
    actor: AuthenticatedUser,
    kind: RosterKind,
    scope: RosterScope,
    campusId: string | undefined,
    file: UploadedRosterFile | undefined,
  ): Promise<RosterImportResult> {
    const parsed = await this.parse(kind, scope, file);
    const rows = await this.resolveRows(parsed.rows, scope, campusId);
    const results: RosterRowResult[] = [];
    for (const resolved of rows) {
      if (!resolved.campusId || resolved.reason) {
        results.push(this.rowError(resolved));
        continue;
      }
      try {
        const input = this.input(kind, resolved.row, scope);
        const key = stableRosterRowKey(parsed.fileHash, parsed.version, resolved.row.rowNumber);
        results.push(
          kind === 'customers'
            ? await this.customers.importRow(
                actor,
                resolved.campusId,
                input as CustomerRosterInput,
                resolved.row.rowNumber,
                resolved.row.values,
                key,
              )
            : await this.teachers.importRow(
                actor,
                resolved.campusId,
                input as TeacherRosterInput,
                resolved.row.rowNumber,
                resolved.row.values,
                key,
              ),
        );
      } catch {
        results.push({
          rowNumber: resolved.row.rowNumber,
          status: 'ERROR',
          reason: '导入失败，请稍后重试',
          values: resolved.row.values,
        });
      }
    }
    const errors = results.filter(({ status }) => status === 'ERROR');
    const receipt = errors.length
      ? await this.excel.createReceipt(parsed.version, scope, errors)
      : null;
    const result: RosterImportResult = {
      templateVersion: parsed.version,
      fileHash: parsed.fileHash,
      totalRows: results.length,
      importedCount: results.filter(({ status }) => status === 'CREATED').length,
      duplicateCount: results.filter(({ status }) => status === 'DUPLICATE').length,
      errorCount: errors.length,
      rows: results,
      errorReceiptFileName: receipt ? `${parsed.version}-错误回执.xlsx` : null,
      errorReceiptBase64: receipt?.toString('base64') ?? null,
    };
    await this.writeBatchAudit(actor, campusId ?? null, kind, result);
    return result;
  }

  async quickCustomer(
    actor: AuthenticatedUser,
    campusId: string,
    input: CustomerRosterInput,
    idempotencyKey: string,
  ) {
    await this.requireCampus(campusId);
    return this.customers.importRow(
      actor,
      campusId,
      input,
      1,
      [input.studentName, input.parentPhone],
      idempotencyKey,
    );
  }

  async quickTeacher(
    actor: AuthenticatedUser,
    campusId: string,
    input: TeacherRosterInput,
    idempotencyKey: string,
  ) {
    await this.requireCampus(campusId);
    return this.teachers.importRow(
      actor,
      campusId,
      input,
      1,
      [input.teacherName, input.phone],
      idempotencyKey,
    );
  }

  listTeachers(campusId: string | undefined, query: string | undefined, page: number, pageSize: number) {
    return this.teachers.list(campusId, query, page, pageSize);
  }

  async export(
    actor: AuthenticatedUser,
    kind: RosterKind,
    scope: RosterScope,
    campusId: string | undefined,
    query: string | undefined,
    confirmed: boolean,
  ): Promise<Buffer> {
    if (!confirmed) {
      throw new DomainError(
        ErrorCode.ROSTER_EXPORT_CONFIRMATION_REQUIRED,
        '导出完整手机号前必须明确确认',
        400,
      );
    }
    if (campusId) await this.requireCampus(campusId);
    const rows =
      kind === 'customers'
        ? await this.customers.exportRows(campusId, query, scope === 'GLOBAL')
        : await this.teachers.exportRows(campusId, query, scope === 'GLOBAL');
    await this.prisma.auditLog.create({
      data: {
        campusId: campusId ?? null,
        actorUserId: actor.userId,
        action: kind === 'customers' ? 'CUSTOMER_ROSTER_EXPORT' : 'TEACHER_ROSTER_EXPORT',
        resourceType: 'Roster',
        resourceId: null,
        outcome: 'SUCCESS',
        details: { templateVersion: this.version(kind), rowCount: rows.length, scope },
      },
    });
    return this.excel.createExport(this.version(kind), scope, rows);
  }

  private async parse(
    kind: RosterKind,
    scope: RosterScope,
    file: UploadedRosterFile | undefined,
  ) {
    if (!file) {
      throw new DomainError(ErrorCode.ROSTER_FILE_INVALID, '请选择 Excel 文件', 400);
    }
    return this.excel.parse(file.buffer, file.originalname, this.version(kind), scope);
  }

  private async resolveRows(
    rows: ParsedRosterRow[],
    scope: RosterScope,
    campusId?: string,
  ): Promise<ResolvedRow[]> {
    if (scope === 'CAMPUS') {
      if (!campusId) throw new DomainError(ErrorCode.FORBIDDEN, '缺少校区权限', 403);
      await this.requireCampus(campusId);
      return rows.map((row) => ({ row, campusId, reason: null }));
    }
    const campuses = await this.prisma.campus.findMany({ select: { id: true, name: true } });
    const byName = new Map<string, string[]>();
    for (const campus of campuses) {
      const key = campus.name.trim().toLocaleLowerCase();
      byName.set(key, [...(byName.get(key) ?? []), campus.id]);
    }
    return rows.map((row) => {
      const name = row.values[2]?.trim().toLocaleLowerCase();
      const matches = name ? byName.get(name) ?? [] : [];
      return {
        row,
        campusId: matches.length === 1 ? matches[0] : null,
        reason:
          matches.length === 1
            ? null
            : matches.length > 1
              ? '校区名称不唯一，请先区分校区名称'
              : '校区不存在',
      };
    });
  }

  private async previewResolved(kind: RosterKind, resolved: ResolvedRow) {
    if (!resolved.campusId || resolved.reason) return this.rowError(resolved);
    const input = this.input(kind, resolved.row, resolved.row.values.length === 3 ? 'GLOBAL' : 'CAMPUS');
    return kind === 'customers'
      ? this.customers.previewRow(
          resolved.campusId,
          input as CustomerRosterInput,
          resolved.row.rowNumber,
          resolved.row.values,
        )
      : this.teachers.previewRow(
          resolved.campusId,
          input as TeacherRosterInput,
          resolved.row.rowNumber,
          resolved.row.values,
        );
  }

  private input(kind: RosterKind, row: ParsedRosterRow, _scope: RosterScope) {
    return kind === 'customers'
      ? { studentName: row.values[0] ?? '', parentPhone: row.values[1] ?? '' }
      : { teacherName: row.values[0] ?? '', phone: row.values[1] ?? '' };
  }

  private rowError(resolved: ResolvedRow): RosterRowResult {
    return {
      rowNumber: resolved.row.rowNumber,
      status: 'ERROR',
      reason: resolved.reason ?? '数据错误',
      values: resolved.row.values,
    };
  }

  private async requireCampus(campusId: string) {
    const campus = await this.prisma.campus.findUnique({
      where: { id: campusId },
      select: { id: true },
    });
    if (!campus) {
      throw new DomainError(ErrorCode.RESOURCE_NOT_FOUND, '校区不存在', 404);
    }
  }

  private version(kind: RosterKind): RosterTemplateVersion {
    return kind === 'customers' ? 'CUSTOMER_V1' : 'TEACHER_V1';
  }

  private writeBatchAudit(
    actor: AuthenticatedUser,
    campusId: string | null,
    kind: RosterKind,
    result: RosterImportResult,
  ) {
    return this.prisma.auditLog.create({
      data: {
        campusId,
        actorUserId: actor.userId,
        action: kind === 'customers' ? 'CUSTOMER_ROSTER_IMPORT' : 'TEACHER_ROSTER_IMPORT',
        resourceType: 'Roster',
        resourceId: null,
        outcome: result.errorCount === result.totalRows && result.totalRows > 0 ? 'FAILURE' : 'SUCCESS',
        details: {
          templateVersion: result.templateVersion,
          fileHash: result.fileHash,
          totalRows: result.totalRows,
          importedCount: result.importedCount,
          duplicateCount: result.duplicateCount,
          errorCount: result.errorCount,
        },
      },
    });
  }
}
