export interface CalculatePartnerEarningInput {
  unitPriceFen: number;
  shareBasisPoints: number;
  countedAttendeeCount: number;
}

export interface PartnerEarningCalculation {
  perAttendeeAmountFen: number;
  amountFen: number;
}

export function calculatePartnerEarning(
  input: CalculatePartnerEarningInput,
): PartnerEarningCalculation {
  assertSafePositiveInteger(input.unitPriceFen, 'unitPriceFen');
  assertIntegerBetween(
    input.shareBasisPoints,
    1,
    10_000,
    'shareBasisPoints',
  );
  assertSafeNonNegativeInteger(
    input.countedAttendeeCount,
    'countedAttendeeCount',
  );

  const numerator = input.unitPriceFen * input.shareBasisPoints;
  assertSafeNonNegativeInteger(
    numerator,
    'unitPriceFen * shareBasisPoints',
  );
  const roundedNumerator = numerator + 5_000;
  assertSafeNonNegativeInteger(roundedNumerator, 'rounded numerator');
  const perAttendeeAmountFen = Math.floor(roundedNumerator / 10_000);
  const amountFen = perAttendeeAmountFen * input.countedAttendeeCount;
  assertSafeNonNegativeInteger(amountFen, 'partner earning amountFen');

  return { perAttendeeAmountFen, amountFen };
}

function assertSafePositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer`);
  }
}

function assertSafeNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer`);
  }
}

function assertIntegerBetween(
  value: number,
  minimum: number,
  maximum: number,
  field: string,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${field} must be an integer between ${minimum} and ${maximum}`,
    );
  }
}
