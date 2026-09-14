import {
  SuperAdminCoursePackageStatus,
  SuperAdminStudentDetail,
  SuperAdminStudentSummary,
} from '../types/super-admin';
import { formatLessonUnits } from '../utils/super-admin-format';

export interface SuperAdminStudentItemModel {
  reservationLabel?: string;
  id: string;
  displayName: string;
  campusLabel: string;
  classLabel: string;
  mainBalanceLabel: string;
  giftBalanceLabel: string;
  totalBalanceLabel: string;
  warningLabel: '低课时预警' | '课时正常';
  lowBalance: boolean;
}

export interface SuperAdminStudentPackageModel {
  reservationLabel?: string;
  id: string;
  name: string;
  mainBalanceLabel: string;
  giftBalanceLabel: string;
  totalBalanceLabel: string;
  validityLabel: string;
  validFromInput: string;
  expiresAtInput: string;
  statusLabel: string;
  statusTone: 'success' | 'warning' | 'danger' | 'muted';
  version: number;
}

export interface SuperAdminStudentDetailModel
  extends SuperAdminStudentItemModel {
  birthDateLabel: string;
  packages: SuperAdminStudentPackageModel[];
}

const STATUS_LABELS: Record<
  SuperAdminCoursePackageStatus,
  { label: string; tone: SuperAdminStudentPackageModel['statusTone'] }
> = {
  ACTIVE: { label: '生效中', tone: 'success' },
  UPCOMING: { label: '未开始', tone: 'warning' },
  EXPIRED: { label: '已过期', tone: 'danger' },
  INACTIVE: { label: '已停用', tone: 'muted' },
};

export const normalizeSuperAdminStudentSearch = (value: string): string =>
  value.trim();

export const resolveSuperAdminStudentsViewState = (
  itemCount: number,
): 'empty' | 'ready' => (itemCount === 0 ? 'empty' : 'ready');

export function decodeSuperAdminRouteParam(
  value: string | undefined,
): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function formatChineseDate(value: string | null): string {
  if (!value) return '未设置';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match
    ? `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`
    : '未设置';
}

function buildStudentItem(
  student: SuperAdminStudentSummary,
): SuperAdminStudentItemModel {
  return {
    id: student.id,
    displayName: student.displayName,
    campusLabel: student.campusName,
    classLabel:
      student.classNames.length > 0
        ? student.classNames.join('、')
        : '暂未分班',
    ...presentLessonBalance(student),
    warningLabel: student.lowBalance ? '低课时预警' : '课时正常',
    lowBalance: student.lowBalance,
  };
}

export function buildSuperAdminStudentItems(
  students: readonly SuperAdminStudentSummary[],
): SuperAdminStudentItemModel[] {
  return students.map(buildStudentItem);
}

export function buildSuperAdminStudentDetail(
  student: SuperAdminStudentDetail,
): SuperAdminStudentDetailModel {
  return {
    ...buildStudentItem(student),
    birthDateLabel: formatChineseDate(student.birthDate),
    packages: student.coursePackages.map((coursePackage) => {
      const status = STATUS_LABELS[coursePackage.status];
      return {
        id: coursePackage.id,
        name: coursePackage.name,
        ...presentLessonBalance(coursePackage),
        validityLabel: `${formatChineseDate(coursePackage.validFrom)} - ${
          coursePackage.expiresAt
            ? formatChineseDate(coursePackage.expiresAt)
            : '长期有效'
        }`,
        validFromInput: coursePackage.validFrom.slice(0, 10),
        expiresAtInput: coursePackage.expiresAt?.slice(0, 10) ?? '',
        statusLabel: status.label,
        statusTone: status.tone,
        version: coursePackage.version,
      };
    }),
  };
}

export function buildSuperAdminStudentAdjustmentUrl(
  packageId: string,
  studentName: string,
  bucket: 'MAIN' | 'GIFT',
): string {
  return `/pages/super-admin/lesson-adjust/index?packageId=${encodeURIComponent(
    packageId,
  )}&studentName=${encodeURIComponent(studentName)}&bucket=${bucket}`;
}
import { presentLessonBalance } from './lesson-availability';
