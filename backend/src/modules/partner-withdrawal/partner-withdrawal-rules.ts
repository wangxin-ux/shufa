import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';

export const PARTNER_WITHDRAWAL_STATUSES = [
  'SUBMITTED',
  'APPROVED',
  'PAYING',
  'RECONCILING',
  'PAID',
  'CANCELLED',
  'REJECTED',
  'FAILED',
  'INVALIDATED',
] as const;
export type PartnerWithdrawalStatus =
  (typeof PARTNER_WITHDRAWAL_STATUSES)[number];
export const OCCUPIED_PARTNER_WITHDRAWALS = [
  'SUBMITTED',
  'APPROVED',
  'PAYING',
  'RECONCILING',
  'PAID',
] as const;
export const settlementOccupies = (status: string) =>
  (OCCUPIED_PARTNER_WITHDRAWALS as readonly string[]).includes(status);
export function withdrawalConflict(
  message = '提现资料或状态已更新，请重新读取',
): never {
  throw new DomainError(ErrorCode.WITHDRAWAL_STATUS_CONFLICT, message, 409);
}
export function assertPartnerWithdrawalTransition(from: string, to: string) {
  const allowed: Record<string, string[]> = {
    SUBMITTED: ['APPROVED', 'CANCELLED', 'REJECTED', 'INVALIDATED'],
    APPROVED: ['PAYING', 'FAILED', 'INVALIDATED'],
    PAYING: ['PAID', 'FAILED', 'RECONCILING'],
    RECONCILING: ['PAID', 'FAILED'],
  };
  if (!allowed[from]?.includes(to)) withdrawalConflict();
}
export function allocateSettlement(
  sources: Array<{ id: string; remainingFen: number }>,
  amount: number,
) {
  if (!Number.isInteger(amount) || amount < 1 || amount > 2147483647)
    throw new DomainError(
      ErrorCode.WITHDRAWAL_AMOUNT_INVALID,
      '提现金额无效',
      400,
    );
  let remaining = amount;
  const result: Array<{ sourceId: string; amountFen: number }> = [];
  for (const source of sources) {
    const allocated = Math.min(Math.max(0, source.remainingFen), remaining);
    if (allocated > 0)
      result.push({ sourceId: source.id, amountFen: allocated });
    remaining -= allocated;
    if (!remaining) break;
  }
  if (remaining)
    throw new DomainError(
      ErrorCode.WITHDRAWAL_BALANCE_INSUFFICIENT,
      '可申请额度不足',
      409,
    );
  return result;
}
export function isPartnerWithdrawalSimulation(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    const db = new URL(env.DATABASE_URL ?? '');
    return (
      env.NODE_ENV === 'test' &&
      env.AUTH_DRIVER === 'mock' &&
      env.PAYMENT_DRIVER === 'mock' &&
      env.PARTNER_WITHDRAWAL_DRIVER === 'mock' &&
      ['postgres:', 'postgresql:'].includes(db.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(db.hostname) &&
      /^\/education_app_test_partner_pdf_[a-z0-9]+_test$/.test(db.pathname) &&
      env.PARTNER_PDF_TEST_DB_NAME === db.pathname.slice(1) &&
      !db.search &&
      !db.hash
    );
  } catch {
    return false;
  }
}
export function shanghaiWithdrawalDay(at: Date) {
  const date = new Date(at.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const start = new Date(`${date}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + 86400000) };
}
