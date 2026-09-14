import {
  CampusManagerLessonQuery,
  CampusManagerLessonSession,
  CampusManagerLessonStatus,
  CampusManagerScheduleDraft,
} from "../types/campus-manager";

export interface CampusManagerLessonItemModel {
  id: string;
  className: string;
  courseName: string;
  teacherLabel: string;
  dateLabel: string;
  timeLabel: string;
  kindLabel: string;
  statusLabel: string;
  status: CampusManagerLessonStatus;
  version: number;
  canManage: boolean;
  draft: CampusManagerScheduleDraft;
}

const KIND_LABELS = {
  REGULAR: "常规课",
  MAKEUP: "补课",
  TRIAL: "体验课",
} as const;

const STATUS_LABELS = {
  SCHEDULED: "待上课",
  IN_PROGRESS: "进行中",
  COMPLETED: "已完成",
  REVERSED: "已撤销",
  CANCELLED: "已取消",
} as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function shanghaiParts(value: string) {
  const date = new Date(value);
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function dateValue(parts: ReturnType<typeof shanghaiParts>): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function timeValue(parts: ReturnType<typeof shanghaiParts>): string {
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

function nextDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function lessonUnitLabel(units: number): string {
  const value = units / 100;
  return Number.isInteger(value)
    ? `${value}课时`
    : `${value.toFixed(2).replace(/0+$/, "")}课时`;
}

export function buildCampusManagerLessonQuery(
  date: string,
  status: CampusManagerLessonStatus | "",
  page: number,
  pageSize: number,
): CampusManagerLessonQuery {
  const normalizedDate = date.trim();
  return {
    page,
    pageSize,
    ...(normalizedDate
      ? {
          from: `${normalizedDate}T00:00:00+08:00`,
          to: `${nextDate(normalizedDate)}T00:00:00+08:00`,
        }
      : {}),
    ...(status ? { status } : {}),
  };
}

export function buildCampusManagerLessonItems(
  sessions: readonly CampusManagerLessonSession[],
): CampusManagerLessonItemModel[] {
  return sessions.map((session) => {
    const start = shanghaiParts(session.startsAt);
    const end = shanghaiParts(session.endsAt);
    return {
      id: session.id,
      className: session.className,
      courseName: session.courseName,
      teacherLabel: `${session.teacherName} · ${lessonUnitLabel(session.lessonUnits)}`,
      dateLabel: `${start.year}年${start.month}月${start.day}日`,
      timeLabel: `${timeValue(start)}-${timeValue(end)}`,
      kindLabel: KIND_LABELS[session.kind],
      statusLabel: STATUS_LABELS[session.status],
      status: session.status,
      version: session.version,
      canManage: session.status === "SCHEDULED",
      draft: {
        classGroupId: session.classGroupId,
        date: dateValue(start),
        startsAt: timeValue(start),
        endsAt: timeValue(end),
        kind: session.kind,
      },
    };
  });
}

export function mergeCampusManagerLessonItems(
  current: readonly CampusManagerLessonItemModel[],
  incoming: readonly CampusManagerLessonItemModel[],
  page: number,
): CampusManagerLessonItemModel[] {
  if (page <= 1) {
    return [...incoming];
  }
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}
