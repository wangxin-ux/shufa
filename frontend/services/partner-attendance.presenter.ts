import {
  PartnerAttendance,
  PartnerAttendanceRecord,
} from '../types/partner';
import {
  formatPartnerAttendanceRate,
  formatPartnerDateTime,
} from '../utils/partner-format';

export interface PartnerAttendanceSummaryModel {
  attendanceRateLabel: string;
  presentCountLabel: string;
  absentCountLabel: string;
  leaveCountLabel: string;
  recordedCountLabel: string;
}

export interface PartnerAttendanceItemModel {
  id: string;
  studentName: string;
  lessonLabel: string;
  teacherLabel: string;
  statusLabel: '到课' | '请假' | '缺勤';
  statusTone: 'success' | 'warning' | 'danger';
}

const STATUS: Record<
  PartnerAttendanceRecord['status'],
  Pick<PartnerAttendanceItemModel, 'statusLabel' | 'statusTone'>
> = {
  PRESENT: { statusLabel: '到课', statusTone: 'success' },
  LEAVE: { statusLabel: '请假', statusTone: 'warning' },
  ABSENT: { statusLabel: '缺勤', statusTone: 'danger' },
};

export function buildPartnerAttendancePageModel(
  attendance: PartnerAttendance,
  timeZone = 'Asia/Shanghai',
): {
  summary: PartnerAttendanceSummaryModel;
  items: PartnerAttendanceItemModel[];
} {
  return {
    summary: {
      attendanceRateLabel: formatPartnerAttendanceRate(
        attendance.attendanceRateBasisPoints,
      ),
      presentCountLabel: String(Math.max(0, Math.trunc(attendance.presentCount))),
      absentCountLabel: String(Math.max(0, Math.trunc(attendance.absentCount))),
      leaveCountLabel: String(Math.max(0, Math.trunc(attendance.leaveCount))),
      recordedCountLabel: String(
        Math.max(0, Math.trunc(attendance.recordedCount)),
      ),
    },
    items: attendance.items.map((item) => ({
      id: item.id,
      studentName: item.studentName,
      lessonLabel: `${formatPartnerDateTime(item.startsAt, timeZone)} · ${item.courseName}`,
      teacherLabel: item.teacherName,
      ...STATUS[item.status],
    })),
  };
}

export function mergePartnerAttendanceItems(
  current: readonly PartnerAttendanceItemModel[],
  incoming: readonly PartnerAttendanceItemModel[],
  page: number,
): PartnerAttendanceItemModel[] {
  if (page <= 1) return [...incoming];
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}
