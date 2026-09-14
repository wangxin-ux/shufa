import {
  CampusManagerLeaveRequest,
  CampusManagerLeaveStatus,
} from "../types/campus-manager";

export interface CampusManagerLeaveItemModel {
  id: string;
  studentName: string;
  lessonLabel: string;
  reason: string;
  status: CampusManagerLeaveStatus;
  statusLabel: string;
  reviewerLabel: string;
  reviewReasonLabel: string;
  version: number;
  canReview: boolean;
}

const STATUS_LABELS: Record<CampusManagerLeaveStatus, string> = {
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

export function buildCampusManagerLeaveItems(
  requests: readonly CampusManagerLeaveRequest[],
): CampusManagerLeaveItemModel[] {
  return requests.map((request) => ({
    id: request.id,
    studentName: request.studentName,
    lessonLabel: `${shanghaiLabel(request.startsAt)} · ${request.courseName}`,
    reason: request.reason,
    status: request.status,
    statusLabel: STATUS_LABELS[request.status],
    reviewerLabel:
      request.reviewerName && request.reviewedAt
        ? `${request.reviewerName} · ${shanghaiLabel(request.reviewedAt)}`
        : "",
    reviewReasonLabel: request.reviewReason
      ? `${request.status === "REJECTED" ? "驳回原因" : "审批说明"}：${request.reviewReason}`
      : "",
    version: request.version,
    canReview: request.status === "PENDING",
  }));
}

export function mergeCampusManagerLeaveHistory(
  approved: readonly CampusManagerLeaveRequest[],
  rejected: readonly CampusManagerLeaveRequest[],
): CampusManagerLeaveRequest[] {
  const byId = new Map<string, CampusManagerLeaveRequest>();
  for (const item of [...approved, ...rejected]) {
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) =>
    left.createdAt === right.createdAt
      ? right.id.localeCompare(left.id)
      : left.createdAt > right.createdAt
        ? -1
        : 1,
  );
}
