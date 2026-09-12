import { ParentHomeSummary } from '../types/parent';

export interface ParentHomeMetricModel {
  label: string;
  value: string;
  unit: string;
  sub: string;
}

export interface ParentHomePageModel {
  course: {
    day: string;
    weekday: string;
    campus: string;
    name: string;
    time: string;
    teacher: string;
  } | null;
  student: ParentHomeSummary['student'];
  metrics: ParentHomeMetricModel[];
}

export type ParentHomeAction =
  | { type: 'navigate'; url: string }
  | { type: 'unavailable'; message: string };

const WEEKDAY_LABELS: Record<string, string> = {
  周一: 'Monday',
  周二: 'Tuesday',
  周三: 'Wednesday',
  周四: 'Thursday',
  周五: 'Friday',
  周六: 'Saturday',
  周日: 'Sunday',
  周天: 'Sunday',
};

function extractDay(dateLabel: string): string {
  return dateLabel.match(/(\d{1,2})日/)?.[1] ?? '--';
}

function extractWeekday(dateLabel: string): string {
  const weekday = dateLabel.match(/周[一二三四五六日天]/)?.[0];
  return weekday ? WEEKDAY_LABELS[weekday] ?? weekday : '';
}

function extractChineseWeekday(dateLabel: string): string {
  return dateLabel.match(/周[一二三四五六日天]/)?.[0] ?? '--';
}

function extractStartTime(timeLabel: string): string {
  return timeLabel.split('-')[0]?.trim() || '--';
}

function splitPercent(label: string): { value: string; unit: string } {
  const normalized = label.trim();
  if (normalized.endsWith('%')) {
    return { value: normalized.slice(0, -1), unit: '%' };
  }
  return { value: normalized || '--', unit: '' };
}

export function buildParentHomePageModel(summary: ParentHomeSummary): ParentHomePageModel {
  const nextLessonMetric = summary.nextLesson
    ? {
        value: extractChineseWeekday(summary.nextLesson.dateLabel),
        unit: extractStartTime(summary.nextLesson.timeLabel),
      }
    : { value: '--', unit: '' };
  const attendanceMetric = splitPercent(summary.attendanceRateLabel);

  return {
    course: summary.nextLesson
      ? {
          day: extractDay(summary.nextLesson.dateLabel),
          weekday: extractWeekday(summary.nextLesson.dateLabel),
          campus: summary.nextLesson.campusName,
          name: summary.nextLesson.courseName,
          time: summary.nextLesson.timeLabel,
          teacher: summary.nextLesson.teacherName,
        }
      : null,
    student: summary.student,
    metrics: [
      {
        label: '剩余课时',
        value: summary.remainingHoursLabel,
        unit: '节',
        sub: '实时更新',
      },
      { label: '下次上课', ...nextLessonMetric, sub: '实时更新' },
      { label: '出勤率', ...attendanceMetric, sub: '实时更新' },
    ],
  };
}

export function resolveParentHomeAction(key: string): ParentHomeAction {
  if (key === 'leave') {
    return { type: 'navigate', url: '/pages/parent/leave/index' };
  }
  if (key === 'hours') {
    return { type: 'navigate', url: '/pages/parent/hours/index' };
  }
  if (key === 'campuses') {
    return { type: 'navigate', url: '/pages/parent/campuses/index' };
  }
  if (key === 'group') {
    return { type: 'navigate', url: '/pages/parent/group-campaigns/index' };
  }
  return { type: 'unavailable', message: '本轮暂未开放' };
}
