import type { OperatorLessonSession, OperatorSchedulingOption } from '../pages/operator/runtime/types/operator';

export const lesson: OperatorLessonSession = {
  id: 'synthetic-lesson-a', campusId: 'synthetic-campus', classGroupId: 'synthetic-class-a',
  className: '创意班', courseName: '创意基础', teacherId: 'synthetic-teacher',
  teacherName: '王老师', startsAt: '2040-02-01T06:00:00Z', endsAt: '2040-02-01T07:30:00Z',
  kind: 'REGULAR', lessonUnits: 100, status: 'SCHEDULED', version: 1,
};
export const classes: OperatorSchedulingOption[] = [
  { classGroupId: lesson.classGroupId, className: lesson.className, courseName: lesson.courseName,
    teacherId: lesson.teacherId, teacherName: lesson.teacherName, defaultLessonUnits: 100 },
  { classGroupId: 'synthetic-class-b', className: '周末班', courseName: '绘画',
    teacherId: 'synthetic-teacher-b', teacherName: '李老师', defaultLessonUnits: 200 },
];
