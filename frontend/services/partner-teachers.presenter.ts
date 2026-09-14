import { PartnerSearchQuery, PartnerTeacher } from '../types/partner';

export interface PartnerTeacherItemModel {
  id: string;
  displayName: string;
  employeeCodeLabel: string;
  specialtyLabel: string;
  classLabel: string;
  activeStudentCountLabel: string;
  monthCompletedLessonCountLabel: string;
}

export function buildPartnerTeacherQuery(
  value: string,
  page: number,
  pageSize: number,
): PartnerSearchQuery {
  const query = value.trim();
  return { page, pageSize, ...(query ? { query } : {}) };
}

export function buildPartnerTeacherItems(
  teachers: readonly PartnerTeacher[],
): PartnerTeacherItemModel[] {
  return teachers.map((teacher) => ({
    id: teacher.id,
    displayName: teacher.displayName,
    employeeCodeLabel: `教师编号 ${teacher.employeeCode}`,
    specialtyLabel:
      teacher.specialties.length > 0
        ? teacher.specialties.join('、')
        : '暂未填写擅长课程',
    classLabel:
      teacher.classNames.length > 0
        ? teacher.classNames.join('、')
        : '暂未带班',
    activeStudentCountLabel: String(
      Math.max(0, Math.trunc(teacher.activeStudentCount)),
    ),
    monthCompletedLessonCountLabel: String(
      Math.max(0, Math.trunc(teacher.monthCompletedLessonCount)),
    ),
  }));
}

export function mergePartnerTeacherItems(
  current: readonly PartnerTeacherItemModel[],
  incoming: readonly PartnerTeacherItemModel[],
  page: number,
): PartnerTeacherItemModel[] {
  if (page <= 1) return [...incoming];
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}
