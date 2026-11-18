const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function shanghaiNaturalWeek(value: Date) {
  const local = new Date(value.getTime() + SHANGHAI_OFFSET_MS);
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(),
    local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  return {
    from: new Date(monday - SHANGHAI_OFFSET_MS),
    to: new Date(monday + 7 * DAY_MS - SHANGHAI_OFFSET_MS),
    weekStart: new Date(monday).toISOString().slice(0, 10),
    weekEnd: new Date(monday + 6 * DAY_MS).toISOString().slice(0, 10),
  };
}

export interface LeaveHintSession {
  id: string;
  startsAt: Date;
  leaveStatuses: readonly string[];
  attendanceStatus: string | null;
}

export interface LeaveWeekWarning {
  weekStart: string;
  weekEnd: string;
  consecutiveCount: number;
  lessonSessionIds: string[];
}

export function buildLeaveWeekWarnings(sessions: readonly LeaveHintSession[]): LeaveWeekWarning[] {
  const weeks = new Map<string, { weekEnd: string; run: string[]; longest: string[] }>();
  const seen = new Set<string>();
  const ordered = [...sessions].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
  for (const session of ordered) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    const { weekStart, weekEnd } = shanghaiNaturalWeek(session.startsAt);
    let week = weeks.get(weekStart);
    if (!week) {
      week = { weekEnd, run: [], longest: [] };
      weeks.set(weekStart, week);
    }
    const onLeave = session.leaveStatuses.some((status) => status === 'PENDING' || status === 'APPROVED')
      && (session.attendanceStatus === null || session.attendanceStatus === 'LEAVE');
    week.run = onLeave ? [...week.run, session.id] : [];
    if (week.run.length > week.longest.length) week.longest = [...week.run];
  }
  return [...weeks.entries()].filter(([, week]) => week.longest.length >= 2)
    .map(([weekStart, week]) => ({
      weekStart, weekEnd: week.weekEnd, consecutiveCount: week.longest.length, lessonSessionIds: week.longest,
    })).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}
