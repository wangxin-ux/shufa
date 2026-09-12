import type { RosterKind } from '../types/roster';
import { RosterClientError, RosterFileTransferClient } from './roster-file-transfer';

function message(error: unknown): string {
  return error instanceof RosterClientError ? error.message : '操作失败，请稍后重试';
}

function modal(options: WechatMiniprogram.ShowModalOption): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({ ...options, success: ({ confirm }) => resolve(confirm), fail: () => resolve(false) });
  });
}

export async function openRosterImportMenu(
  client: RosterFileTransferClient,
  prefix: string,
  kind: RosterKind,
): Promise<boolean> {
  try {
    const action = await new Promise<number | null>((resolve) => {
      wx.showActionSheet({
        itemList: ['下载 Excel 模板', '选择 Excel 导入'],
        success: ({ tapIndex }) => resolve(tapIndex),
        fail: () => resolve(null),
      });
    });
    if (action === null) return false;
    if (action === 0) {
      await client.openTemplate(prefix, kind);
      return false;
    }
    const filePath = await client.chooseWorkbook();
    if (!filePath) return false;
    wx.showLoading({ title: '正在预检', mask: true });
    const preview = await client.preview(prefix, kind, filePath);
    wx.hideLoading();
    const confirmed = await modal({
      title: '确认导入',
      content: `共 ${preview.totalRows} 行，可导入 ${preview.validCount} 行，重复 ${preview.duplicateCount} 行，错误 ${preview.errorCount} 行。`,
      confirmText: '开始导入',
    });
    if (!confirmed) return false;
    wx.showLoading({ title: '正在导入', mask: true });
    const result = await client.import(prefix, kind, filePath);
    wx.hideLoading();
    const openReceipt = await modal({
      title: '导入完成',
      content: `成功 ${result.importedCount} 行，跳过重复 ${result.duplicateCount} 行，失败 ${result.errorCount} 行。`,
      confirmText: result.errorReceiptBase64 ? '打开回执' : '知道了',
      showCancel: Boolean(result.errorReceiptBase64),
      cancelText: '关闭',
    });
    if (openReceipt && result.errorReceiptBase64) await client.openReceipt(result);
    return result.importedCount > 0;
  } catch (error) {
    wx.hideLoading();
    wx.showToast({ title: message(error), icon: 'none' });
    return false;
  }
}

export async function confirmRosterExport(
  client: RosterFileTransferClient,
  prefix: string,
  kind: RosterKind,
  query: Record<string, string | undefined>,
): Promise<void> {
  const confirmed = await modal({
    title: '导出完整手机号',
    content: 'Excel 将包含完整手机号，请仅用于业务迁移并妥善保管。是否继续？',
    confirmText: '确认导出',
  });
  if (!confirmed) return;
  try {
    wx.showLoading({ title: '正在导出', mask: true });
    await client.openExport(prefix, kind, query);
  } catch (error) {
    wx.showToast({ title: message(error), icon: 'none' });
  } finally {
    wx.hideLoading();
  }
}
