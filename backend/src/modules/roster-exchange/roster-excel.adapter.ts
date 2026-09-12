import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Workbook, type Worksheet } from 'exceljs';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type {
  ParsedRoster,
  RosterScope,
  RosterTemplateVersion,
} from './roster.types';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DATA_ROWS = 2_000;

const HEADERS: Record<RosterTemplateVersion, Record<RosterScope, string[]>> = {
  CUSTOMER_V1: {
    GLOBAL: ['学员姓名', '家长手机号', '校区'],
    CAMPUS: ['学员姓名', '家长手机号'],
  },
  TEACHER_V1: {
    GLOBAL: ['教师姓名', '手机号', '校区'],
    CAMPUS: ['教师姓名', '手机号'],
  },
};

@Injectable()
export class RosterExcelAdapter {
  headers(version: RosterTemplateVersion, scope: RosterScope): string[] {
    return [...HEADERS[version][scope]];
  }

  async parse(
    buffer: Buffer,
    fileName: string,
    version: RosterTemplateVersion,
    scope: RosterScope,
  ): Promise<ParsedRoster> {
    if (
      buffer.length === 0 ||
      buffer.length > MAX_FILE_BYTES ||
      !fileName.toLocaleLowerCase().endsWith('.xlsx')
    ) {
      this.invalid('请选择不超过 5 MB 的 .xlsx 文件');
    }
    const workbook = new Workbook();
    try {
      await workbook.xlsx.load(buffer);
    } catch {
      this.invalid('Excel 文件无法解析');
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.name !== version) {
      this.invalid(`请使用 ${version} 模板`);
    }
    const expectedHeaders = this.headers(version, scope);
    const actualHeaders = this.readHeaders(worksheet, expectedHeaders.length);
    if (
      actualHeaders.length !== expectedHeaders.length ||
      actualHeaders.some((header, index) => header !== expectedHeaders[index])
    ) {
      this.invalid(`表头必须为：${expectedHeaders.join('、')}`);
    }
    const rows = worksheet
      .getRows(2, Math.max(worksheet.rowCount - 1, 0))
      ?.map((row) => ({
        rowNumber: row.number,
        values: expectedHeaders.map((_, index) =>
          this.cellText(row.getCell(index + 1).text),
        ),
      }))
      .filter(({ values }) => values.some(Boolean)) ?? [];
    if (rows.length > MAX_DATA_ROWS) {
      throw new DomainError(
        ErrorCode.ROSTER_ROW_LIMIT_EXCEEDED,
        '单个文件最多导入 2000 行数据',
        400,
      );
    }
    return {
      version,
      headers: expectedHeaders,
      rows,
      fileHash: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  createTemplate(
    version: RosterTemplateVersion,
    scope: RosterScope,
  ): Promise<Buffer> {
    return this.createWorkbook(version, this.headers(version, scope), []);
  }

  createExport(
    version: RosterTemplateVersion,
    scope: RosterScope,
    rows: string[][],
  ): Promise<Buffer> {
    return this.createWorkbook(version, this.headers(version, scope), rows);
  }

  createReceipt(
    version: RosterTemplateVersion,
    scope: RosterScope,
    rows: Array<{ values: string[]; status: string; reason: string }>,
  ): Promise<Buffer> {
    return this.createWorkbook(
      version,
      [...this.headers(version, scope), '处理结果', '错误原因'],
      rows.map((row) => [...row.values, row.status, row.reason]),
    );
  }

  private async createWorkbook(
    version: RosterTemplateVersion,
    headers: string[],
    rows: string[][],
  ): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = '知办家教';
    workbook.created = new Date(0);
    const worksheet = workbook.addWorksheet(version, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    worksheet.addRow(headers);
    for (const row of rows) worksheet.addRow(row);
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FF202020' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFE28A' },
    };
    worksheet.columns.forEach((column, index) => {
      column.width = Math.max(16, Math.min(index === 1 ? 20 : 28, headers[index].length * 3));
      column.numFmt = '@';
    });
    const value = await workbook.xlsx.writeBuffer();
    return Buffer.from(value);
  }

  private readHeaders(worksheet: Worksheet, count: number): string[] {
    const headers = Array.from({ length: count }, (_, index) =>
      this.cellText(worksheet.getRow(1).getCell(index + 1).text),
    );
    const extra = this.cellText(worksheet.getRow(1).getCell(count + 1).text);
    return extra ? [...headers, extra] : headers;
  }

  private cellText(value: string): string {
    return value.trim();
  }

  private invalid(message: string): never {
    throw new DomainError(ErrorCode.ROSTER_FILE_INVALID, message, 400);
  }
}
