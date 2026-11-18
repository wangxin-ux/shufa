import {
  OperatorLeaveRequest,
  OperatorLeaveStatus,
} from "../types/operator";

export interface OperatorLeaveItemModel {
  id: string;
  studentName: string;
  lessonLabel: string;
  reason: string;
  status: OperatorLeaveStatus;
  statusLabel: string;
  reviewerLabel: string;
  reviewReasonLabel: string;
  version: number;
  canReview: boolean;
}

const STATUS_LABELS: Record<OperatorLeaveStatus, string> = {
  PENDING: "待审批",
  APPROVED: "已批准",
  REJECTED: "已驳回",
};

function shanghaiLabel(value: string): string {
  const shifted = new Date(new Date(value).getTime() + 8 * 60 * 60 * 1_000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hour = String(shifted.getUTCHours()).padStart(2, "0");
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${year}年${month}月${day}日 ${hour}:${minute}`;
}

export function buildOperatorLeaveItems(
  requests: readonly OperatorLeaveRequest[],
): OperatorLeaveItemModel[] {
  return requests.map((request) => ({
    id: request.id,
    studentName: request.studentName,
    lessonLabel: `${shanghaiLabel(request.startsAt)} · ${request.courseName}`,
    reason: request.reason,
    status: request.status,
    statusLabel: STATUS_LABELS[request.status],
    reviewerLabel:
      request.status === "PENDING"
        ? ""
        : `${request.reviewerName || "审批人未知"} · ${request.reviewedAt ? shanghaiLabel(request.reviewedAt) : "审批时间未知"}`,
    reviewReasonLabel: request.reviewReason
      ? `${request.status === "REJECTED" ? "驳回原因" : "审批说明"}：${request.reviewReason}`
      : "",
    version: request.version,
    canReview: request.status === "PENDING" && request.canReview === true,
  }));
}

export function mergeOperatorLeaveHistory(
  previous: readonly OperatorLeaveRequest[],
  next: readonly OperatorLeaveRequest[],
): OperatorLeaveRequest[] {
  const byId = new Map<string, OperatorLeaveRequest>();
  for (const item of [...previous, ...next]) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}
