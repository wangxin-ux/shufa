import type {
  OperatorSeriesPattern, OperatorSeriesPreview, OperatorSeriesCreated,
  OperatorCancellationPreview, OperatorSeriesCancelled, OperatorCancellationMode,
  OperatorSeriesSelectedSession, OperatorLessonSession, OperatorPage, OperatorLessonQuery,
} from "../types/operator";

const DAY = 86400000;
export const seriesUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const seriesHash = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
export const seriesVersion = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
export const seriesDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export function seriesFailure(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode, code: statusCode === 400 ? "BAD_REQUEST" : "INVALID_RESPONSE" });
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function shape(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).length !== keys.length || keys.some(key => !(key in value)))
    seriesFailure("排课响应结构异常，请重新核对", 502);
}
const stamp = (value: unknown): value is string => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) &&
  seriesDate(value.slice(0, 10)) &&
  Number.isFinite(Date.parse(value));
export const shanghaiSeriesDate = (value: string) => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 10);
export const seriesTimeLabel = (value: string) => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(11, 16);

export function validateSeriesPattern(value: unknown, creating = false): asserts value is OperatorSeriesPattern {
  const fields = ["classGroupId", "startDate", "endDate", "intervalWeeks", "weekdays", "startTime", "endTime", "kind"];
  if (!record(value) || Object.keys(value).some(key => ![...fields, ...(creating ? ["previewHash"] : [])].includes(key)) ||
    fields.some(key => !(key in value))) seriesFailure("周期排课条件无效");
  if (!seriesUuid(value.classGroupId)) seriesFailure("请选择有效班级");
  if (!seriesDate(value.startDate) || !seriesDate(value.endDate)) seriesFailure("请选择有效的开始和结束日期");
  const days = (Date.parse(value.endDate) - Date.parse(value.startDate)) / DAY + 1;
  if (days < 1 || days > 84) seriesFailure("周期最多12周（84天），请缩小日期范围");
  if (value.intervalWeeks !== 1 && value.intervalWeeks !== 2) seriesFailure("请选择每周或隔周");
  if (!Array.isArray(value.weekdays) || value.weekdays.length < 1 || value.weekdays.length > 7 ||
    new Set(value.weekdays).size !== value.weekdays.length ||
    value.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)) seriesFailure("请选择有效且不重复的星期");
  if (typeof value.startTime !== "string" || typeof value.endTime !== "string" ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.startTime) ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.endTime) || value.endTime <= value.startTime)
    seriesFailure("结束时间必须晚于同日开始时间");
  if (!["REGULAR", "MAKEUP", "TRIAL"].includes(String(value.kind))) seriesFailure("课程类型无效");
  if (creating && !seriesHash(value.previewHash)) seriesFailure("请重新预览后确认创建");
}

// Arithmetic completeness check only; production never synthesizes a preview or a submission calendar.
function countDates(pattern: OperatorSeriesPattern): number {
  const start = Date.parse(pattern.startDate), end = Date.parse(pattern.endDate);
  const monday = start - ((new Date(start).getUTCDay() + 6) % 7) * DAY;
  return pattern.weekdays.reduce((sum, weekday) => {
    let first = monday + (weekday - 1) * DAY;
    if (first < start) first += pattern.intervalWeeks * 7 * DAY;
    return sum + (first > end ? 0 : Math.floor((end - first) / (pattern.intervalWeeks * 7 * DAY)) + 1);
  }, 0);
}
function validateDates(rows: Array<{ startsAt: string; endsAt: string }>, pattern: OperatorSeriesPattern) {
  if (rows.length !== countDates(pattern)) seriesFailure("周期预览日期不完整，请重新核对", 502);
  let previous = "";
  const monday = Date.parse(pattern.startDate) - ((new Date(pattern.startDate).getUTCDay() + 6) % 7) * DAY;
  for (const row of rows) {
    const date = shanghaiSeriesDate(row.startsAt), day = Date.parse(date);
    if (date <= previous || date < pattern.startDate || date > pattern.endDate ||
      !pattern.weekdays.includes(((new Date(date).getUTCDay() + 6) % 7) + 1) ||
      Math.floor((day - monday) / (7 * DAY)) % pattern.intervalWeeks !== 0 ||
      Date.parse(row.startsAt) !== Date.parse(`${date}T${pattern.startTime}:00+08:00`) ||
      Date.parse(row.endsAt) !== Date.parse(`${date}T${pattern.endTime}:00+08:00`))
      seriesFailure("周期预览日期或时间异常，请重新核对", 502);
    previous = date;
  }
}
function selectedRows(value: unknown, cancelled = false): OperatorSeriesSelectedSession[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) seriesFailure("课次响应数量异常，请重新核对", 502);
  const seen = new Set<string>();
  let previous: OperatorSeriesSelectedSession | undefined;
  for (const row of value) {
    shape(row, ["id", "version", "startsAt", "endsAt", ...(cancelled ? ["status"] : [])]);
    if (!seriesUuid(row.id) || !seriesVersion(row.version) || !stamp(row.startsAt) || !stamp(row.endsAt) ||
      Date.parse(row.endsAt) <= Date.parse(row.startsAt) || seen.has(row.id) ||
      (cancelled && row.status !== "CANCELLED")) seriesFailure("课次响应异常，请重新核对", 502);
    const item = row as unknown as OperatorSeriesSelectedSession;
    if (previous && (Date.parse(item.startsAt) < Date.parse(previous.startsAt) ||
      (Date.parse(item.startsAt) === Date.parse(previous.startsAt) && item.id <= previous.id)))
      seriesFailure("课次响应顺序异常，请重新核对", 502);
    seen.add(item.id); previous = item;
  }
  return value as OperatorSeriesSelectedSession[];
}
function envelope(value: unknown): unknown {
  if (!record(value) || !("data" in value)) seriesFailure("排课响应缺少数据，请重新核对", 502);
  return value.data;
}
export function parseSeriesPreview(value: unknown, pattern: OperatorSeriesPattern): OperatorSeriesPreview {
  const data = envelope(value);
  shape(data, ["timezone", "previewHash", "sessions", "conflictDates"]);
  if (data.timezone !== "Asia/Shanghai" || !seriesHash(data.previewHash) || !Array.isArray(data.sessions) ||
    data.sessions.length < 1 || data.sessions.length > 50 || !Array.isArray(data.conflictDates))
    seriesFailure("周期预览响应异常，请重新核对", 502);
  for (const row of data.sessions) {
    shape(row, ["date", "startsAt", "endsAt"]);
    if (!seriesDate(row.date) || !stamp(row.startsAt) || !stamp(row.endsAt) ||
      shanghaiSeriesDate(row.startsAt) !== row.date) seriesFailure("周期预览日期异常", 502);
  }
  const result = data as unknown as OperatorSeriesPreview;
  validateDates(result.sessions, pattern);
  if (new Set(result.conflictDates).size !== result.conflictDates.length ||
    result.conflictDates.some(date => !seriesDate(date) || !result.sessions.some(row => row.date === date)))
    seriesFailure("冲突日期响应异常，请重新核对", 502);
  return result;
}
export function parseSeriesCreated(value: unknown, pattern: OperatorSeriesPattern): OperatorSeriesCreated {
  const data = envelope(value);
  shape(data, ["seriesId", "version", "sessions"]);
  if (!seriesUuid(data.seriesId) || !seriesVersion(data.version)) seriesFailure("周期创建响应异常，请先核对", 502);
  validateDates(selectedRows(data.sessions), pattern);
  return data as unknown as OperatorSeriesCreated;
}
export function validateCancellation(id: unknown, mode: unknown, hash?: unknown, key?: unknown) {
  if (!seriesUuid(id) || !["THIS", "FOLLOWING"].includes(String(mode)) ||
    (hash !== undefined && !seriesHash(hash)) || (key !== undefined && (typeof key !== "string" || !key.trim())))
    seriesFailure("取消课次条件无效，请重新核对");
}
export function parseCancellationPreview(value: unknown, id: string, mode: OperatorCancellationMode): OperatorCancellationPreview {
  const data = envelope(value);
  shape(data, ["seriesId", "previewHash", "sessions"]);
  if ((data.seriesId !== null && !seriesUuid(data.seriesId)) || !seriesHash(data.previewHash) ||
    (mode === "FOLLOWING" && data.seriesId === null)) seriesFailure("取消范围响应异常", 502);
  const sessions = selectedRows(data.sessions);
  const target = sessions.find(row => row.id === id);
  if (!target || (mode === "THIS" && sessions.length !== 1) ||
    sessions.some(row => Date.parse(row.startsAt) <= Date.now() ||
      Date.parse(row.startsAt) < Date.parse(target.startsAt))) seriesFailure("取消范围已变化，请重新读取", 502);
  return data as unknown as OperatorCancellationPreview;
}
export function parseSeriesCancelled(value: unknown, expected: OperatorCancellationPreview): OperatorSeriesCancelled {
  const data = envelope(value);
  shape(data, ["seriesId", "sessions"]);
  const rows = selectedRows(data.sessions, true);
  if (data.seriesId !== expected.seriesId || rows.length !== expected.sessions.length ||
    rows.some((row, index) => {
      const original = expected.sessions[index];
      return row.id !== original.id || row.version !== original.version + 1 ||
        Date.parse(row.startsAt) !== Date.parse(original.startsAt) || Date.parse(row.endsAt) !== Date.parse(original.endsAt);
    })) seriesFailure("取消结果不完整，请核对原操作", 502);
  return data as unknown as OperatorSeriesCancelled;
}
export function parseSchedulePage(value: unknown, query: OperatorLessonQuery): OperatorPage<OperatorLessonSession> {
  if (!record(value) || !Array.isArray(value.data) || !record(value.meta)) seriesFailure("课次列表响应异常", 502);
  const meta = value.meta;
  if (meta.page !== query.page || meta.pageSize !== query.pageSize ||
    !Number.isSafeInteger(meta.total) || Number(meta.total) < 0 ||
    meta.totalPages !== Math.ceil(Number(meta.total) / query.pageSize) ||
    value.data.length !== Math.min(query.pageSize, Math.max(0, Number(meta.total) - (query.page - 1) * query.pageSize)))
    seriesFailure("课次分页不完整，请重新读取", 502);
  for (const row of value.data) validateScheduleLesson(row);
  if (new Set(value.data.map(row => row.id)).size !== value.data.length) seriesFailure("课次列表重复，请重新读取", 502);
  return value as unknown as OperatorPage<OperatorLessonSession>;
}
export function validateScheduleLesson(row: unknown): asserts row is OperatorLessonSession {
  if (!record(row) || !seriesUuid(row.id) || !seriesVersion(row.version) ||
    !seriesUuid(row.classGroupId) || !stamp(row.startsAt) || !stamp(row.endsAt) ||
    Date.parse(row.endsAt) <= Date.parse(row.startsAt) ||
    (row.seriesId !== undefined && row.seriesId !== null && !seriesUuid(row.seriesId)) ||
    !["SCHEDULED", "IN_PROGRESS", "COMPLETED", "REVERSED", "CANCELLED"].includes(String(row.status)) ||
    !["REGULAR", "MAKEUP", "TRIAL"].includes(String(row.kind)) ||
    ["className", "courseName", "teacherName"].some(key => typeof row[key] !== "string"))
    seriesFailure("课次数据异常，请重新读取", 502);
}
export function seriesDateLabels<T extends { startsAt: string; endsAt: string }>(rows: T[]) {
  return rows.map(row => ({
    ...row, label: `${shanghaiSeriesDate(row.startsAt)} ${seriesTimeLabel(row.startsAt)}-${seriesTimeLabel(row.endsAt)}`,
  }));
}
