import { OPERATOR_ACCOUNT_CATEGORIES, type OperatorAccount, type OperatorAccountSubject } from '../../types/operator-account';

export const OPERATOR_ACCOUNT_SUBJECTS: OperatorAccountSubject[] = [
  { id: 'ac000000-0000-4000-8000-000000000001', name: '创意基础', isActive: true, version: 1 },
  { id: 'ac000000-0000-4000-8000-000000000002', name: '历史科目', isActive: false, version: 2 },
];
// Deterministic synthetic local demonstration, never a fallback for API failures.
export function mockOperatorAccount(empty: boolean): OperatorAccount {
  const categories = OPERATOR_ACCOUNT_CATEGORIES.filter(c => c.value !== '');
  return {
    mainBalanceUnits: empty ? 0 : 12000, giftBalanceUnits: empty ? 0 : 3000, totalBalanceUnits: empty ? 0 : 15000,
    mainReservedUnits: empty ? 0 : 2000, giftReservedUnits: empty ? 0 : 1000, reservedTotalUnits: empty ? 0 : 3000,
    mainAvailableUnits: empty ? 0 : 10000, giftAvailableUnits: empty ? 0 : 2000, availableTotalUnits: empty ? 0 : 12000,
    enrollmentSummary: { receivedAmountFen: empty ? 0 : 800000, refundedAmountFen: empty ? 0 : 120000,
      initialMainUnits: empty ? 0 : 20000, initialGiftUnits: empty ? 0 : null, pendingIssuanceCount: empty ? 0 : 1 },
    lessonActivityTotals: categories.map(({ value }, index) => ({
      entryType: value, mainDeltaUnits: empty ? 0 : index === 0 ? 30000 : -100,
      giftDeltaUnits: empty ? 0 : index === 5 ? null : 0,
      totalDeltaUnits: empty ? 0 : index === 5 ? null : index === 0 ? 30000 : -100,
    })),
    items: empty ? [] : Array.from({ length: 24 }, (_, index) => {
      const subject = index % 3 === 2 ? null : OPERATOR_ACCOUNT_SUBJECTS[index % 3];
      return {
        id: `ac100000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        studentId: '40000000-0000-4000-8000-000000000001', studentName: '合成学员', packageName: '合成创意课包',
        subject: subject ? { id: subject.id, name: subject.name } : null,
        entryType: categories[index % 6].value, bucket: index % 2 ? 'GIFT' : 'MAIN',
        deltaUnits: index % 6 === 0 ? 200 : -100, balanceBeforeUnits: 300, balanceAfterUnits: index % 6 === 0 ? 500 : 200,
        reason: '本地合成演示记录', createdAt: new Date(Date.UTC(2026, 9, 28, 9, 30 - index)).toISOString(),
        paymentContext: index % 6 === 0 ? { receivedOn: '2026-10-27' } : null,
        teachingContext: index % 6 === 1 ? { courseName: '合成创意课', teacherName: '合成教师', lessonStartsAt: '2026-10-27T08:00:00Z' } : null,
      };
    }),
    meta: { page: 1, pageSize: 20, total: empty ? 0 : 24, totalPages: empty ? 0 : 2 },
    serverTime: '2026-10-28T09:30:00Z', timezone: 'Asia/Shanghai',
  };
}
