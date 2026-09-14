import { Workbook } from 'exceljs';
import { DomainError } from '../../common/errors/domain-error';
import { RosterExcelAdapter } from './roster-excel.adapter';

describe('roster excel adapter', () => {
  const adapter = new RosterExcelAdapter();

  it.each([
    ['CUSTOMER_V1', 'GLOBAL', ['学员姓名', '家长手机号', '校区']],
    ['CUSTOMER_V1', 'CAMPUS', ['学员姓名', '家长手机号']],
    ['TEACHER_V1', 'GLOBAL', ['教师姓名', '手机号', '校区']],
    ['TEACHER_V1', 'CAMPUS', ['教师姓名', '手机号']],
  ] as const)('round-trips %s %s headers', async (version, scope, headers) => {
    const buffer = await adapter.createTemplate(version, scope);
    const parsed = await adapter.parse(buffer, '模板.xlsx', version, scope);
    expect(parsed.headers).toEqual(headers);
    expect(parsed.rows).toEqual([]);
  });

  it('preserves Chinese receipt columns and phone text', async () => {
    const buffer = await adapter.createReceipt('CUSTOMER_V1', 'CAMPUS', [
      { values: ['陈小满', '13800138000'], status: '失败', reason: '手机号格式错误' },
    ]);
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      '学员姓名',
      '家长手机号',
      '处理结果',
      '错误原因',
    ]);
    expect(sheet.getRow(2).getCell(2).text).toBe('13800138000');
  });

  it('rejects a renamed worksheet and an incorrect header', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['姓名', '手机号']);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(
      adapter.parse(bytes, '错误模板.xlsx', 'CUSTOMER_V1', 'CAMPUS'),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
