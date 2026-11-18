export const uuid = (index: number) => `63000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
export const classId = uuid(1), seriesId = uuid(2), hash = 'a'.repeat(64);
export const pattern = (patch: Record<string, unknown> = {}) => ({
  classGroupId: classId, startDate: '2040-01-02', endDate: '2040-01-15',
  intervalWeeks: 1, weekdays: [1, 3], startTime: '14:00', endTime: '15:30', kind: 'REGULAR', ...patch,
});
// Synthetic server responses only. Production Pages never generate calendar dates.
export function preview(input: any = pattern(), conflicts: string[] = []) {
  const start = Date.parse(`${input.startDate}T00:00:00Z`);
  const end = Date.parse(`${input.endDate}T00:00:00Z`);
  const weekday = (new Date(start).getUTCDay() + 6) % 7;
  const monday = start - weekday * 86400000;
  const sessions = [];
  for (let date = start; date <= end; date += 86400000) {
    if (!input.weekdays.includes(((new Date(date).getUTCDay() + 6) % 7) + 1) ||
      Math.floor((date - monday) / (7 * 86400000)) % input.intervalWeeks) continue;
    const value = new Date(date).toISOString().slice(0, 10);
    sessions.push({ date: value, startsAt: `${value}T${input.startTime}:00+08:00`,
      endsAt: `${value}T${input.endTime}:00+08:00` });
  }
  return { timezone: 'Asia/Shanghai', previewHash: hash, sessions, conflictDates: conflicts };
}
export const created = (value = preview()) => ({
  seriesId, version: 1, sessions: value.sessions.map((row, i) => ({
    id: uuid(i + 10), version: 1, startsAt: row.startsAt, endsAt: row.endsAt,
  })),
});
export const options = () => ({ classes: [{
  classGroupId: classId, className: '创意基础长班级陈晨安然陈晨安然',
  courseName: '创意基础', teacherId: uuid(3), teacherName: '测试教师', defaultLessonUnits: 100,
}] });
export const lesson = (index = 10, patch: Record<string, unknown> = {}) => ({
  id: uuid(index), campusId: uuid(4), classGroupId: classId,
  className: '创意基础长班级陈晨安然陈晨安然', courseName: '创意基础',
  teacherId: uuid(3), teacherName: '测试教师',
  startsAt: `2040-01-${String(index - 8).padStart(2, '0')}T06:00:00Z`,
  endsAt: `2040-01-${String(index - 8).padStart(2, '0')}T07:30:00Z`,
  kind: 'REGULAR', lessonUnits: 100, status: 'SCHEDULED', version: 1, seriesId, ...patch,
});
export const selected = (rows = [lesson(), lesson(11)]) => ({
  seriesId: rows[0].seriesId ?? null, previewHash: hash,
  sessions: rows.map(row => ({ id: row.id, version: row.version, startsAt: row.startsAt, endsAt: row.endsAt })),
});
export const cancelled = (value = selected()) => ({
  seriesId: value.seriesId,
  sessions: value.sessions.map(row => ({ ...row, version: row.version + 1, status: 'CANCELLED' })),
});
export const list = (rows: any[], page = 1, total = rows.length) => ({
  data: rows, meta: { page, pageSize: 20, total, totalPages: Math.ceil(total / 20) },
});
export const change = (value: unknown) => ({ detail: { value } });
export const keyTap = (key: string) => ({ currentTarget: { dataset: { key } } });
