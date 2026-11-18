import type { OperatorLessonStatus } from './operator';

export interface OperatorLessonMember {
  studentId: string;
  displayName: string;
  source: 'CLASS' | 'TEMPORARY' | 'HISTORICAL';
  canRemove: boolean;
}

export interface OperatorLessonRoster {
  lessonSessionId: string;
  lessonVersion: number;
  status: OperatorLessonStatus;
  startsAt: string;
  canChange: boolean;
  members: OperatorLessonMember[];
  serverTime: string;
}
