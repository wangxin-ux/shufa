import { ACTIVITY_TYPES, type Account } from './types';
import { HeadquartersError } from './codec';

const uuid = (index: number) => `72000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
// In-memory aggregate responses model the server, independently of visible pages.
function account(count: number): Account {
  return {
    mainBalanceUnits: 40000 * count, giftBalanceUnits: 2000 * count, totalBalanceUnits: 42000 * count,
    mainReservedUnits: 3000 * count, giftReservedUnits: 0, reservedTotalUnits: 3000 * count,
    mainAvailableUnits: 37000 * count, giftAvailableUnits: 2000 * count, availableTotalUnits: 39000 * count,
    enrollmentSummary: { receivedAmountFen: 600000 * count, refundedAmountFen: count ? null : 0,
      initialMainUnits: 60000 * count, initialGiftUnits: count ? null : 0, pendingIssuanceCount: count },
    lessonActivityTotals: ACTIVITY_TYPES.map((entryType, index) => ({
      entryType, mainDeltaUnits: (index % 2 ? -100 : 200) * count,
      giftDeltaUnits: (index % 2 ? -20 : 30) * count, totalDeltaUnits: (index % 2 ? -120 : 230) * count,
    })),
  };
}
export function createHeadquartersMock(scenario: 'normal' | 'empty' | 'error' = 'normal') {
  const campuses = Array.from({ length: scenario === 'empty' ? 0 : 23 }, (_, index) => ({
    id: uuid(index + 1), name: `演示校区${String(index + 1).padStart(2, '0')}`, timezone: 'Asia/Shanghai',
  }));
  const common = (count: number) => ({
    activeStudentCount: 30 * count, todayLessonCount: 4 * count, account: account(count),
    earnings: { estimatedTotalFen: -1200 * count, pendingReviewFen: count ? null : 0, currency: 'CNY' },
    serverTime: '2026-10-29T06:00:00.000Z',
  });
  return async (path: string): Promise<unknown> => {
    if (path === '/me') return { data: { userId: uuid(900), roles: [{ code: 'OPERATOR', campusId: null }] } };
    if (scenario === 'error') throw new HeadquartersError(503, 'HEADQUARTERS_MOCK_UNAVAILABLE');
    const [pathname, queryString = ''] = path.split('?');
    const params = new Map(queryString.split('&').filter(Boolean).map(pair => {
      const separator = pair.indexOf('=');
      return [decodeURIComponent(pair.slice(0, separator)), decodeURIComponent(pair.slice(separator + 1))];
    }));
    if (pathname === '/operators/me/headquarters/summary') return {
      data: { ...common(campuses.length), campusCount: campuses.length, studentCountBasis: 'SUM_OF_CAMPUS_ACTIVE_STUDENT_RECORDS' },
    };
    if (pathname === '/operators/me/headquarters/campuses') {
      const page = Number(params.get('page')), pageSize = Number(params.get('pageSize'));
      const query = params.get('query') ?? '', rows = campuses.filter(row => row.name.includes(query));
      return { data: rows.slice((page - 1) * pageSize, page * pageSize),
        meta: { page, pageSize, total: rows.length, totalPages: Math.ceil(rows.length / pageSize) } };
    }
    const id = pathname.match(/^\/operators\/me\/headquarters\/campuses\/([^/]+)\/summary$/)?.[1];
    const campus = campuses.find(row => row.id === id);
    if (!campus) throw new HeadquartersError(403, 'HEADQUARTERS_GRANT_REVOKED', '当前账号无此校区读取权限');
    return { data: { ...common(1), campus } };
  };
}
