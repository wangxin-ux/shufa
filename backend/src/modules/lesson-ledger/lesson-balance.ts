export const lessonBalanceSelect = {
  mainBalanceUnits: true,
  giftBalanceUnits: true,
  mainReservedUnits: true,
  giftReservedUnits: true,
} as const;

export interface PackageBalance {
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  mainReservedUnits?: number;
  giftReservedUnits?: number;
}

export function summarizeLessonBalances(packages: readonly PackageBalance[]) {
  const sum = packages.reduce<Required<PackageBalance>>(
    (total, item) => ({
      mainBalanceUnits: total.mainBalanceUnits + item.mainBalanceUnits,
      giftBalanceUnits: total.giftBalanceUnits + item.giftBalanceUnits,
      mainReservedUnits:
        total.mainReservedUnits + (item.mainReservedUnits ?? 0),
      giftReservedUnits:
        total.giftReservedUnits + (item.giftReservedUnits ?? 0),
    }),
    {
      mainBalanceUnits: 0,
      giftBalanceUnits: 0,
      mainReservedUnits: 0,
      giftReservedUnits: 0,
    },
  );
  const mainAvailableUnits = sum.mainBalanceUnits - sum.mainReservedUnits;
  const giftAvailableUnits = sum.giftBalanceUnits - sum.giftReservedUnits;
  return {
    ...sum,
    mainAvailableUnits,
    giftAvailableUnits,
    totalBalanceUnits: sum.mainBalanceUnits + sum.giftBalanceUnits,
    reservedTotalUnits: sum.mainReservedUnits + sum.giftReservedUnits,
    availableTotalUnits: mainAvailableUnits + giftAvailableUnits,
  };
}
