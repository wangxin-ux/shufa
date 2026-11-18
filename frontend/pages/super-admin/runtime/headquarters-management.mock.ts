import { ManagementError, normalizeCreation, type CampusGrant, type HeadquartersAccount, type ManagementRequest } from './headquarters-management.types';
import type { SuperAdminStaffAccount, SuperAdminUpdateStaffAccountStatusInput, SuperAdminUnbindStaffWechatInput } from '../../../types/super-admin';
import type { RequestState } from '../../../utils/request-state';
export function createHeadquartersManagementMock() {
  const accounts: HeadquartersAccount[] = [], grants = new Map<string, CampusGrant[]>();
  const phones = new Map<string, string>();
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const receipts = new Map<string, { signature: string; response: unknown }>();
  const request: ManagementRequest = async (path, method, input, key) => {
    const route = path.split('?')[0];
    if (path === '/me') return { data: { userId: '00000000-0000-4000-8000-000000000990',
      roles: [{ code: 'SUPER_ADMIN', campusId: null }] } };
    if (method === 'GET') {
      const id = route.split('/')[3], query = /page=(\d+)&pageSize=(\d+)/.exec(path);
      if (!accounts.some(row => row.id === id)) throw new ManagementError(404, 'STAFF_ACCOUNT_UNAVAILABLE', '总部账号不存在或当前不可用');
      const page = Number(query?.[1] ?? 1), pageSize = Number(query?.[2] ?? 100), rows = grants.get(id) ?? [];
      return { data: [...rows].sort((a, b) => a.campusId.localeCompare(b.campusId)).slice((page - 1) * pageSize, page * pageSize),
        meta: { page, pageSize, total: rows.length, totalPages: Math.ceil(rows.length / pageSize) } };
    }
    const signature = JSON.stringify([path, input]), previous = receipts.get(key ?? '');
    if (previous) {
      if (previous.signature !== signature) throw new ManagementError(409, 'IDEMPOTENCY_CONFLICT', '原操作内容不一致，请先核对');
      return clone(previous.response);
    }
    let result;
    if (route === '/management/operator-headquarters' && method === 'POST') {
      const raw = input as { displayName: string; phone: string }, data = normalizeCreation(raw.displayName, raw.phone);
      if ([...phones.values()].includes(data.phone))
        throw new ManagementError(409, 'STAFF_PHONE_ALREADY_EXISTS', '该手机号已创建工作人员账号');
      result = { id: '00000000-0000-4000-8000-' + String(991 + accounts.length).padStart(12, '0'),
        displayName: data.displayName, maskedPhone: '+86****' + data.phone.slice(-4), roleCode: 'OPERATOR' as const,
        campusId: null, status: 'ACTIVE' as const, version: 1, createdAt: new Date().toISOString() };
      accounts.push(result);
      phones.set(result.id, data.phone);
    } else {
      const id = route.split('/')[3], campusId = route.split('/').pop()!, data = input as { isActive: boolean; expectedVersion: number };
      const target = accounts.find(row => row.id === id);
      if (!target || target.status === 'DISABLED' && data.isActive)
        throw new ManagementError(404, 'STAFF_ACCOUNT_UNAVAILABLE', '总部账号不存在或当前不可用');
      const rows = grants.get(id) ?? [], old = rows.find(row => row.campusId === campusId);
      const before = old ?? { userId: id, campusId, isActive: false, version: 0 };
      if (before.version !== data.expectedVersion) throw new ManagementError(409, 'CONFLICT', '授权已更新，请重新核对');
      result = { ...before, isActive: data.isActive, version: before.version + (before.isActive !== data.isActive ? 1 : 0) };
      if (old) Object.assign(old, result); else if (result.isActive) rows.push(result);
      grants.set(id, rows);
    }
    const response = { data: result }; receipts.set(key!, { signature, response: clone(response) }); return clone(response);
  };
  const view = (row: HeadquartersAccount): SuperAdminStaffAccount => ({
    ...row, campusName: '总部', bindingStatus: 'UNBOUND', updatedAt: row.createdAt,
  });
  async function lifecycle(id: string, input: SuperAdminUpdateStaffAccountStatusInput | SuperAdminUnbindStaffWechatInput,
    key: string): Promise<RequestState<SuperAdminStaffAccount>> {
    const kind = 'status' in input ? 'status' : 'unbind', signature = JSON.stringify([id, kind, input]);
    const previous = receipts.get(key);
    if (previous) {
      if (previous.signature !== signature) throw new ManagementError(409, 'IDEMPOTENCY_CONFLICT', '原操作内容不一致，请先核对');
      return { status: 'success', data: clone(previous.response) as SuperAdminStaffAccount };
    }
    const row = accounts.find(row => row.id === id);
    if (!row) throw new ManagementError(404, 'STAFF_ACCOUNT_UNAVAILABLE', '总部账号不存在或当前不可用');
    if (row.version !== input.expectedVersion) throw new ManagementError(409, 'CONFLICT', '账号已更新，请重新核对');
    if ('status' in input) { row.status = input.status; row.version++; }
    const response = view(row); receipts.set(key, { signature, response: clone(response) });
    return { status: 'success', data: response };
  }
  return { request, accounts, view, status: (id: string, input: SuperAdminUpdateStaffAccountStatusInput, key: string) => lifecycle(id, input, key),
    unbind: (id: string, input: SuperAdminUnbindStaffWechatInput, key: string) => lifecycle(id, input, key),
    matchingAccounts: (query = '') => accounts.filter(row =>
    !query || row.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase()) || phones.get(row.id)?.includes(query)) };
}
