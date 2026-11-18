import { parseTeacherWithdrawalYuan } from '../../../services/teacher-earnings.presenter';
import { isCurrentTeacherReadContext, TeacherReadContext } from './teacher-read-context';

export type TeacherWithdrawalCommand =
  | { kind: 'create'; key: string; amountFen: number; amountYuan: string; uncertain: boolean }
  | { kind: 'cancel'; key: string; id: string; version: number; uncertain: boolean };

interface RecoveryOwner { apiBaseUrl: string; userId: string; campusId: string }
interface StoredRecovery { owner: RecoveryOwner; command: TeacherWithdrawalCommand | null }
export interface TeacherWithdrawalRecovery {
  owner?: RecoveryOwner;
  command?: TeacherWithdrawalCommand;
  inflight?: Promise<void>;
  writing?: boolean;
  completedCreateKey?: string;
  deniedSessions?: Set<string>;
  denialListeners?: Set<() => void>;
  accessTarget?: TeacherWithdrawalRecovery;
}

const STORAGE_KEY = 'education.teacher.withdrawal-recovery.v1';
const sessions = new Map<string, TeacherWithdrawalRecovery>();
const ownerKey = (owner: RecoveryOwner) => JSON.stringify([owner.apiBaseUrl, owner.userId, owner.campusId]);
export const teacherWithdrawalSessionKey = (context: TeacherReadContext) => JSON.stringify(context);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const hasOnly = (value: Record<string, unknown>, fields: string[]) =>
  Object.keys(value).every(key => fields.includes(key)) && fields.every(key => key in value);
let sequence = 0;

function validCommand(value: unknown): value is TeacherWithdrawalCommand {
  if (!record(value) || typeof value.key !== 'string' ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(value.key) || value.uncertain !== true) return false;
  if (value.kind === 'cancel') {
    return hasOnly(value, ['kind', 'key', 'id', 'version', 'uncertain']) &&
      text(value.id) && Number.isSafeInteger(value.version) && Number(value.version) > 0;
  }
  if (value.kind !== 'create' || typeof value.amountYuan !== 'string' ||
    !hasOnly(value, ['kind', 'key', 'amountFen', 'amountYuan', 'uncertain'])) return false;
  const parsed = parseTeacherWithdrawalYuan(value.amountYuan);
  return parsed.ok && parsed.amountFen === value.amountFen;
}

function readStore(): StoredRecovery[] {
  const value: unknown = wx.getStorageSync(STORAGE_KEY);
  if (value === undefined || value === null || value === '') return [];
  if (!record(value) || value.version !== 1 || !Array.isArray(value.entries) ||
    !hasOnly(value, ['version', 'entries'])) throw new Error('恢复记录待核对');
  const keys = new Set<string>();
  return value.entries.map((entry: unknown) => {
    if (!record(entry) || !hasOnly(entry, ['owner', 'command']) || !record(entry.owner) ||
      !hasOnly(entry.owner, ['apiBaseUrl', 'userId', 'campusId']) ||
      !text(entry.owner.apiBaseUrl) || !text(entry.owner.userId) || !text(entry.owner.campusId) ||
      (entry.command !== null && !validCommand(entry.command))) throw new Error('恢复记录待核对');
    const owner: RecoveryOwner = {
      apiBaseUrl: entry.owner.apiBaseUrl, userId: entry.owner.userId, campusId: entry.owner.campusId,
    };
    const key = ownerKey(owner);
    if (keys.has(key)) throw new Error('恢复记录待核对');
    keys.add(key);
    return { owner, command: entry.command as TeacherWithdrawalCommand | null };
  });
}

export function getTeacherWithdrawalRecovery(context: TeacherReadContext): TeacherWithdrawalRecovery {
  const key = teacherWithdrawalSessionKey(context);
  const recovery = sessions.get(key) ?? {};
  sessions.set(key, recovery);
  return recovery;
}

export function denyTeacherWithdrawalSession(recovery: TeacherWithdrawalRecovery, context: TeacherReadContext) {
  const target = recovery.accessTarget ?? recovery;
  (target.deniedSessions ??= new Set()).add(teacherWithdrawalSessionKey(context));
  target.denialListeners?.forEach(listener => listener());
}

export function withTeacherWithdrawalDeadline<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('操作结果待核对')), 20000);
    work.then(value => { clearTimeout(timeout); resolve(value); },
      error => { clearTimeout(timeout); reject(error); });
  });
}

export async function loadTeacherWithdrawalRecovery(
  context: TeacherReadContext,
  onAccessDenied?: (code: number) => void,
): Promise<TeacherWithdrawalRecovery> {
  const current = () => {
    if (!isCurrentTeacherReadContext(context)) {
      throw Object.assign(new Error('登录已更新'), { statusCode: 401 });
    }
  };
  current();
  const unverified = getTeacherWithdrawalRecovery(context);
  if (context.env.dataDriver === 'mock') return unverified;
  const owner = await withTeacherWithdrawalDeadline(new Promise<RecoveryOwner>((resolve, reject) => {
    wx.request({
      url: `${context.env.apiBaseUrl}/me`, method: 'GET', timeout: 15000,
      header: { Authorization: `Bearer ${context.env.accessToken}` },
      success: ({ statusCode, data }) => {
        try {
          current();
          if (statusCode !== 200) throw Object.assign(new Error('身份核对失败'), { statusCode });
          const session = record(data) && record(data.data) ? data.data : undefined;
          const role = session && Array.isArray(session.roles) && session.roles.length === 1 ? session.roles[0] : undefined;
          if (!session || !text(session.userId) || !record(role) || role.code !== 'TEACHER' || !text(role.campusId)) {
            throw Object.assign(new Error('无教师身份'), { statusCode: 403 });
          }
          resolve({ apiBaseUrl: context.env.apiBaseUrl, userId: session.userId, campusId: role.campusId });
        } catch (error) {
          const code = (error as { statusCode?: number })?.statusCode;
          if (code === 401 || code === 403) {
            denyTeacherWithdrawalSession(unverified, context);
            onAccessDenied?.(code);
          }
          reject(error);
        }
      },
      fail: () => reject(new Error('身份核对失败')),
    });
  }));
  current();
  const entries = readStore(), sessionKey = teacherWithdrawalSessionKey(context);
  const identity = `owner:${ownerKey(owner)}`;
  const sameOwner = !unverified.owner || ownerKey(unverified.owner) === ownerKey(owner);
  const shared = sessions.get(identity) ?? (sameOwner ? unverified : {});
  if (shared.deniedSessions?.has(sessionKey)) throw Object.assign(new Error('提现访问已失效'), { statusCode: 403 });
  // Bind only an unverified session; a previous verified owner must retain its own late replies.
  if (!unverified.owner && shared !== unverified) {
    unverified.owner = owner;
    unverified.accessTarget = shared;
    unverified.denialListeners?.forEach(listener => (shared.denialListeners ??= new Set()).add(listener));
  }
  shared.owner = owner;
  if (!shared.command) {
    const command = entries.find(entry => ownerKey(entry.owner) === ownerKey(owner))?.command;
    if (command) shared.command = { ...command };
  }
  sessions.set(identity, shared);
  sessions.set(sessionKey, shared);
  return shared;
}

export function persistTeacherWithdrawalRecovery(
  recovery: TeacherWithdrawalRecovery,
  command: TeacherWithdrawalCommand | null | undefined = recovery.command,
): void {
  if (!recovery.owner) return;
  const entries = readStore(), key = ownerKey(recovery.owner);
  const index = entries.findIndex(entry => ownerKey(entry.owner) === key);
  const stored = index >= 0 ? entries[index].command : null;
  const expectedKey = command?.key ?? recovery.command?.key;
  if (stored && stored.key !== expectedKey) throw new Error('恢复记录已更新，请重新核对');
  const entry: StoredRecovery = {
    owner: recovery.owner, command: command ? { ...command, uncertain: true } : null,
  };
  if (index < 0) entries.push(entry);
  else entries[index] = entry;
  wx.setStorageSync(STORAGE_KEY, { version: 1, entries });
}

export function createTeacherWithdrawalKey(): string {
  return `teacher-withdrawal-${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
