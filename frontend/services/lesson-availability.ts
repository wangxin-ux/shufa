import { formatPartnerLessonUnits } from '../utils/partner-format';

export interface LessonAvailability {
  mainAvailableUnits?: number;
  giftAvailableUnits?: number;
  availableTotalUnits?: number;
  mainReservedUnits?: number;
  giftReservedUnits?: number;
  reservedTotalUnits?: number;
}

export function presentLessonBalance(value: LessonAvailability & {
  mainBalanceUnits: number; giftBalanceUnits: number; totalBalanceUnits?: number;
}) {
  const gross = value.totalBalanceUnits ?? value.mainBalanceUnits + value.giftBalanceUnits;
  const total = value.availableTotalUnits ?? gross;
  const reserved = value.reservedTotalUnits ?? 0;
  return {
    mainBalanceLabel: formatPartnerLessonUnits(value.mainAvailableUnits ?? value.mainBalanceUnits),
    giftBalanceLabel: formatPartnerLessonUnits(value.giftAvailableUnits ?? value.giftBalanceUnits),
    totalBalanceLabel: formatPartnerLessonUnits(total),
    ...(reserved > 0 ? {
      reservationLabel: `可用 ${formatPartnerLessonUnits(total)} 节 · 退课处理中 ${formatPartnerLessonUnits(reserved)} 节 · 账面 ${formatPartnerLessonUnits(gross)} 节`,
    } : {}),
  };
}
