import type { RosterKind } from '../../../../types/roster';
import { RosterClientError, RosterFileTransferClient } from '../../../../services/roster-file-transfer';

const modal = (options: WechatMiniprogram.ShowModalOption): Promise<boolean> =>
  new Promise((resolve) => wx.showModal({ ...options,
    success: ({ confirm }) => resolve(confirm), fail: () => resolve(false),
  }));

export async function openOperatorRosterImport(
  client: RosterFileTransferClient, prefix: string, kind: RosterKind, isCurrent: () => boolean,
): Promise<boolean> {
  try {
    if (!isCurrent()) return false;
    const action = await new Promise<number | null>((resolve) => wx.showActionSheet({
      itemList: ['下载 Excel 模板', '选择 Excel 导入'],
      success: ({ tapIndex }) => resolve(tapIndex), fail: () => resolve(null),
    }));
    if (!isCurrent() || action === null) return false;
    if (action === 0) {
      await client.openTemplate(prefix, kind);
      return false;
    }
    const file = await client.chooseWorkbook();
    if (!isCurrent() || !file) return false;
    const preview = await client.preview(prefix, kind, file);
    if (!isCurrent()) return false;
    const confirmed = await modal({
      title: '确认导入',
      content: `共 ${preview.totalRows} 行，可导入 ${preview.validCount} 行，重复 ${preview.duplicateCount} 行，错误 ${preview.errorCount} 行。`,
      confirmText: '开始导入',
    });
    if (!isCurrent() || !confirmed) return false;
    const result = await client.import(prefix, kind, file);
    if (!isCurrent()) return false;
    const receipt = await modal({
      title: '导入完成',
      content: `成功 ${result.importedCount} 行，跳过重复 ${result.duplicateCount} 行，失败 ${result.errorCount} 行。`,
      confirmText: result.errorReceiptBase64 ? '打开回执' : '知道了',
      showCancel: Boolean(result.errorReceiptBase64), cancelText: '关闭',
    });
    if (!isCurrent()) return false;
    if (receipt && result.errorReceiptBase64) await client.openReceipt(result);
    return isCurrent() && result.importedCount > 0;
  } catch (error) {
    if (isCurrent()) wx.showToast({
      title: error instanceof RosterClientError ? error.message : '名册操作失败，请重试', icon: 'none',
    });
    return false;
  }
}

export async function confirmOperatorRosterExport(
  client: RosterFileTransferClient, prefix: string, kind: RosterKind,
  query: Record<string, string | undefined>, isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) return;
  const confirmed = await modal({
    title: '导出完整手机号',
    content: 'Excel 将包含完整手机号，请仅用于业务迁移并妥善保管。是否继续？',
    confirmText: '确认导出',
  });
  if (!isCurrent() || !confirmed) return;
  try { await client.openExport(prefix, kind, query); }
  catch (error) {
    if (isCurrent()) wx.showToast({
      title: error instanceof RosterClientError ? error.message : '名册导出失败，请重试', icon: 'none',
    });
  }
}

export function operatorRosterEntryKey(keys: Map<string, string>, input: object): string {
  const signature = JSON.stringify(input);
  const existing = keys.get(signature);
  if (existing) return existing;
  const key = `operator-roster-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  keys.set(signature, key);
  return key;
}
