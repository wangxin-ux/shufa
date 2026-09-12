import { PartnerStudentDetail } from '../types/partner';
import { presentLessonBalance } from './lesson-availability';
import { buildPartnerAttendancePageModel } from './partner-attendance.presenter';
import { buildPartnerLessonAccountPageModel } from './partner-lesson-account.presenter';
import {
  formatPartnerBirthDate,
  formatPartnerLessonUnits,
} from '../utils/partner-format';

export function buildPartnerStudentDetailPageModel(
  detail: PartnerStudentDetail,
  timeZone = 'Asia/Shanghai',
) {
  const attendance = buildPartnerAttendancePageModel(
    {
      ...detail.attendance,
      items: detail.recentAttendance,
      meta: {
        page: 1,
        pageSize: 5,
        total: detail.recentAttendance.length,
        totalPages: detail.recentAttendance.length > 0 ? 1 : 0,
      },
    },
    timeZone,
  );
  const ledger = buildPartnerLessonAccountPageModel(
    {
      mainBalanceUnits: detail.mainBalanceUnits,
      giftBalanceUnits: detail.giftBalanceUnits,
      totalBalanceUnits: detail.totalBalanceUnits,
      items: detail.recentLessonLedger,
      meta: {
        page: 1,
        pageSize: 5,
        total: detail.recentLessonLedger.length,
        totalPages: detail.recentLessonLedger.length > 0 ? 1 : 0,
      },
    },
    timeZone,
  );
  return {
    displayName: detail.displayName,
    birthDateLabel: formatPartnerBirthDate(detail.birthDate),
    classLabel: detail.classNames.length
      ? detail.classNames.join('、')
      : '暂未分班',
    balances: presentLessonBalance(detail),
    attendance: attendance.summary,
    classes: detail.classes.map((item) => ({
      id: item.id,
      className: item.className,
      courseName: item.courseName,
      teacherLabel: item.teacherName,
    })),
    recentAttendance: attendance.items,
    recentLessonLedger: ledger.items,
  };
}
