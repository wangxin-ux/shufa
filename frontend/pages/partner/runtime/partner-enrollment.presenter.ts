import type { PartnerDashboardHighlight, PartnerStudentDetail } from '../../../types/partner';
import { formatPartnerLessonUnits } from '../../../utils/partner-format';

export interface PartnerEnrollmentSummary {
  receivedAmountFen: number | null;
  refundedAmountFen: number | null;
  initialMainUnits: number | null;
  initialGiftUnits: number | null;
  pendingIssuanceCount: number;
}

export function presentPartnerEnrollment(detail: PartnerStudentDetail | PartnerDashboardHighlight) {
  const summary = (detail as {
    enrollmentSummary?: PartnerEnrollmentSummary;
  }).enrollmentSummary;
  const known = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const money = (value: unknown) => known(value)
    ? `¥${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}` : '待核对';
  const units = (value: unknown) => known(value) ? `${formatPartnerLessonUnits(value)}节` : '待核对';
  const pending = known(summary?.pendingIssuanceCount) ? summary.pendingIssuanceCount : 0;
  const unissued = pending > 0 && summary?.initialMainUnits === 0 && summary?.initialGiftUnits === 0;
  return {
    receivedLabel: money(summary?.receivedAmountFen),
    refundedLabel: money(summary?.refundedAmountFen),
    lessonsLabel: unissued ? '未发放' :
      `购买${units(summary?.initialMainUnits)} · 赠送${units(summary?.initialGiftUnits)}`,
    pendingLabel: pending > 0 ? `${unissued ? '' : '另有'}${pending}笔未发放` : '',
  };
}
