export const lessonId = '71000000-0000-4000-8000-000000000001';
export const campusId = '10000000-0000-4000-8000-000000000001';
export const studentId = (index: number) => `41000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
export const lesson = {
  id: lessonId, campusId, classGroupId: '51000000-0000-4000-8000-000000000001',
  className: '创意基础周末班', courseName: '创意基础', teacherId: '31000000-0000-4000-8000-000000000001',
  teacherName: '王老师', startsAt: '2040-02-01T06:00:00Z', endsAt: '2040-02-01T07:30:00Z',
  kind: 'REGULAR', lessonUnits: 100, status: 'SCHEDULED', version: 1,
};
export const students = Array.from({ length: 26 }, (_, index) => ({
  id: studentId(index + 1), campusId, displayName: index === 25
    ? '陈晨安然王同学陈晨安然王同学陈晨安然王同学' : `王同学${index + 1}`,
  ageYears: 9, classNames: [],
}));
export const roster = (members = [{ studentId: studentId(1), displayName: '陈晨',
  source: 'CLASS', canRemove: false }], version = 1) => ({
  lessonSessionId: lessonId, lessonVersion: version, status: 'SCHEDULED',
  startsAt: lesson.startsAt, canChange: true, members,
  serverTime: '2039-01-01T00:00:00+08:00',
});
export const list = (data: unknown[], page = 1, total = data.length) => ({
  data, meta: { page, pageSize: 20, total, totalPages: Math.ceil(total / 20) },
});
// The schedule page parser rejects any response whose row count disagrees with
// meta.total, so build a page that is internally consistent instead of pairing
// one row with a large total.
export const lessonPage = (page: number, total: number) => {
  const pageSize = 20;
  const count = Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize));
  const data = Array.from({ length: count }, (_, index) => ({
    ...lesson,
    id: `71000000-0000-4000-8000-${String((page - 1) * pageSize + index + 1).padStart(12, '0')}`,
  }));
  return list(data, page, total);
};
