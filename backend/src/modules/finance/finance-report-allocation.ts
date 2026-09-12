export type FinanceAllocationInput = {
  id: string;
  coursePackageId: string;
  entryType: 'CONSUME' | 'REVERSAL';
  bucket: 'MAIN' | 'GIFT';
  deltaUnits: number;
  reversalOfId: string | null;
  createdAt: Date;
  issuance: { originalAmountFen: number; initialMainUnits: number } | null;
};

export type FinanceAllocation = {
  amountFen: number | null;
  amountStatus: 'KNOWN' | 'PENDING_CHECK';
};

export function allocateLessonConsumptionAmounts(
  input: readonly FinanceAllocationInput[],
): Map<string, FinanceAllocation> {
  const result = new Map<string, FinanceAllocation>();
  const byPackage = new Map<string, FinanceAllocationInput[]>();
  for (const entry of input) {
    const rows = byPackage.get(entry.coursePackageId) ?? [];
    rows.push(entry);
    byPackage.set(entry.coursePackageId, rows);
  }

  for (const rows of byPackage.values()) {
    rows.sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id),
    );
    const issuance = rows[0]?.issuance ?? null;
    if (!issuance || issuance.initialMainUnits <= 0) {
      for (const row of rows) result.set(row.id, pending());
      continue;
    }

    let netMainUnits = 0;
    let netMainAmountFen = 0;
    const originalAmounts = new Map<string, number>();
    for (const row of rows) {
      if (row.bucket === 'GIFT') {
        result.set(row.id, { amountFen: 0, amountStatus: 'KNOWN' });
        continue;
      }

      const units = -row.deltaUnits;
      if (row.entryType === 'REVERSAL') {
        const originalAmount = row.reversalOfId
          ? originalAmounts.get(row.reversalOfId)
          : undefined;
        if (originalAmount === undefined) {
          result.set(row.id, pending());
          continue;
        }
        const amountFen = -originalAmount;
        netMainUnits += units;
        netMainAmountFen += amountFen;
        result.set(row.id, { amountFen, amountStatus: 'KNOWN' });
        continue;
      }

      const targetAmountFen = roundHalfUp(
        BigInt(issuance.originalAmountFen) * BigInt(netMainUnits + units),
        BigInt(issuance.initialMainUnits),
      );
      const amountFen = targetAmountFen - netMainAmountFen;
      netMainUnits += units;
      netMainAmountFen += amountFen;
      originalAmounts.set(row.id, amountFen);
      result.set(row.id, { amountFen, amountStatus: 'KNOWN' });
    }
  }
  return result;
}

function roundHalfUp(numerator: bigint, denominator: bigint): number {
  if (numerator < 0n || denominator <= 0n) {
    throw new Error(
      'Finance allocation requires non-negative cumulative units',
    );
  }
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

function pending(): FinanceAllocation {
  return { amountFen: null, amountStatus: 'PENDING_CHECK' };
}
