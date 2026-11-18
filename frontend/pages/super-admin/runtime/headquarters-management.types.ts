export interface HeadquartersAccount {
  id: string; displayName: string; maskedPhone: string; roleCode: 'OPERATOR'; campusId: null;
  status: 'ACTIVE' | 'DISABLED'; version: number; createdAt: string;
}
export interface CampusGrant { userId: string; campusId: string; isActive: boolean; version: number }
export interface HeadquartersCreation { displayName: string; phone: string }
export interface GrantInput { isActive: boolean; expectedVersion: number }
export interface CampusChoice { id: string; name: string }
export type ManagementRequest = (path: string, method: 'GET' | 'POST' | 'PUT', data?: unknown, key?: string) => Promise<unknown>;
export const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export class ManagementError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message = '账号数据读取失败，请重试') { super(message); }
}
export function responseInvalid(): never { throw new ManagementError(502, 'MANAGEMENT_RESPONSE_INVALID', '返回数据不完整，请重新核对'); }
export function headquartersAccount(value: unknown): HeadquartersAccount | undefined {
  if (!record(value) || !uuid(value.id) || value.roleCode !== 'OPERATOR' || value.campusId !== null ||
    !['ACTIVE', 'DISABLED'].includes(String(value.status)) || typeof value.displayName !== 'string' ||
    !value.displayName.trim() || value.displayName.length > 100 || typeof value.maskedPhone !== 'string' ||
    !/^\+86\*{4}\d{4}$/.test(value.maskedPhone) || !Number.isInteger(value.version) ||
    Number(value.version) < 1 || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
    'roles' in value) return undefined;
  return { id: value.id, displayName: value.displayName, maskedPhone: value.maskedPhone, roleCode: 'OPERATOR',
    campusId: null, status: value.status as HeadquartersAccount['status'], version: Number(value.version), createdAt: value.createdAt };
}
export function normalizeCreation(name: string, phone: string): HeadquartersCreation {
  const displayName = name.trim(), digits = phone.trim();
  if (!displayName || displayName.length > 100 || !/^(?:\+?86)?1[3-9]\d{9}$/.test(digits))
    throw new ManagementError(400, 'VALIDATION_FAILED', '请填写姓名和正确的手机号');
  return { displayName, phone: '+86' + digits.replace(/^\+?86/, '') };
}
export function pageRows(value: unknown, page: number, pageSize: number): { rows: unknown[]; total: number } {
  if (!record(value) || !record(value.meta) || !Array.isArray(value.data)) responseInvalid();
  const meta = value.meta;
  if (meta.page !== page || meta.pageSize !== pageSize || !Number.isSafeInteger(meta.total) || Number(meta.total) < 0 ||
    meta.totalPages !== Math.ceil(Number(meta.total) / pageSize) ||
    value.data.length !== Math.min(pageSize, Math.max(0, Number(meta.total) - (page - 1) * pageSize))) responseInvalid();
  return { rows: value.data, total: Number(meta.total) };
}
