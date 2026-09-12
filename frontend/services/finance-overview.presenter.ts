import { createSessionService } from "./session.service";
import {
  createFinanceService,
  FinanceChoice,
  financeMoney,
  financeToday,
} from "./finance.service";

export async function requireFinanceSession() {
  const session = await createSessionService().load();
  return !!(
    session &&
    session.roles.length === 1 &&
    session.roles[0].code === "FINANCE" &&
    session.roles[0].campusId === null
  );
}

export async function loadFinanceCampuses() {
  const result: FinanceChoice[] = [{ id: "", name: "全部校区" }];
  let page = 1;
  while (true) {
    const current = await createFinanceService().campuses(page);
    result.push(...current.items);
    if (page * current.pageSize >= current.total || !current.items.length)
      return result;
    page += 1;
  }
}

export function overviewMoney(fen: number | null) {
  return fen === null ? "待核对" : `¥ ${financeMoney(fen)}`;
}

export function overviewUnits(value: number) {
  return `${(value / 100).toFixed(2)} 节`;
}

export function overviewTime(value: string | null) {
  if (!value) return "尚未完成";
  return new Date(new Date(value).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}

export type FinancePeriod = "DAY" | "MONTH" | "QUARTER" | "YEAR";

export function financePeriodRange(period: FinancePeriod, today = financeToday()) {
  const [year, month, day] = today.split("-").map(Number);
  if (period === "DAY") return { from: today, to: today };
  if (period === "MONTH")
    return { from: `${year}-${String(month).padStart(2, "0")}-01`, to: today };
  if (period === "QUARTER") {
    const first = Math.floor((month - 1) / 3) * 3 + 1;
    return { from: `${year}-${String(first).padStart(2, "0")}-01`, to: today };
  }
  return { from: `${year}-01-01`, to: today || `${year}-${month}-${day}` };
}

export function overviewError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export const ORDER_STATUS_LABELS: Readonly<Record<string, string>> = {
  AWAITING_PROOF: "待凭证",
  AWAITING_PAYMENT: "待支付",
  PENDING_REVIEW: "待审核",
  PAID: "已支付",
  REJECTED: "已驳回",
  EFFECTIVE: "已生效",
  REFUNDING: "退款中",
  REFUNDED: "已退款",
  CANCELLED: "已取消",
  VOIDED: "已作废",
};

export const PAYOUT_STATUS_LABELS: Readonly<Record<string, string>> = {
  SUBMITTED: "待审核",
  APPROVED: "已批准",
  PAYING: "办理中",
  PAID: "已完成",
  CANCELLED: "已取消",
  REJECTED: "已驳回",
  FAILED: "失败",
  WITHDRAWN: "已撤回",
  UNCERTAIN: "待核实",
  SUCCEEDED: "已完成",
  PROCESSING: "处理中",
  PENDING: "待处理",
};
