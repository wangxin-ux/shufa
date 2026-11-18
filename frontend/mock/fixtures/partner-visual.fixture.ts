import { PartnerDashboard } from '../../types/partner';
import { PARTNER_DASHBOARD_FIXTURE } from './partner.fixture';

// Local-only layout sample; not a payment, enrollment, or ledger fact.
export const PARTNER_VISUAL_DASHBOARD_FIXTURE: PartnerDashboard = {
  ...PARTNER_DASHBOARD_FIXTURE,
  campus: {
    ...PARTNER_DASHBOARD_FIXTURE.campus,
    name: '凯曼中南海校区',
  },
  activeTeacherCount: 18,
  highlight: {
    studentId: 'partner-visual-student',
    studentName: '朱元璋',
    classNames: ['专业美术A'],
    mainBalanceUnits: 100,
    giftBalanceUnits: 0,
    totalBalanceUnits: 100,
    thresholdUnits: 500,
    classes: [
      { id: 'partner-visual-class', className: '专业美术A', courseName: '专业美术', teacherName: '林老师' },
    ],
    attendance: {
      presentCount: 9, absentCount: 0, leaveCount: 1, recordedCount: 10,
      attendanceRateBasisPoints: 9000,
    },
  },
};
