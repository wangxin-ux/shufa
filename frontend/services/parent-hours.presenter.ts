import { ParentHoursEntry, ParentHoursView } from '../types/parent';
import { formatDateLabel, formatFenAmount } from '../utils/format';

export type ParentHoursFilter = 'all' | 'debit' | 'credit';

export function normalizeParentHoursFilter(value: unknown): ParentHoursFilter {
  if (value === 'debit' || value === 'credit') {
    return value;
  }
  return 'all';
}

export interface ParentHourCardModel {
  key: 'paid' | 'gift';
  label: string;
  remaining: number;
}

export interface ParentHoursEntryModel extends ParentHoursEntry {
  deltaLabel: string;
}

export interface ParentHoursPageModel {
  grossTotal: number;
  reservedPaidHours: number;
  reservedGiftHours: number;
  hasReservations: boolean;
  remainingTotal: number;
  paidAmountLabel: string;
  validUntilLabel: string;
  hourCards: ParentHourCardModel[];
  entries: ParentHoursEntryModel[];
  activeFilter: ParentHoursFilter;
  isEmpty: boolean;
}

function matchesFilter(entry: ParentHoursEntry, filter: ParentHoursFilter): boolean {
  if (filter === 'debit') {
    return entry.delta < 0;
  }
  if (filter === 'credit') {
    return entry.delta > 0;
  }
  return true;
}

function formatDelta(delta: number): string {
  if (delta > 0) {
    return `+${delta}节`;
  }
  return `${delta}节`;
}

export function buildParentHoursPageModel(
  view: ParentHoursView,
  filter: ParentHoursFilter,
): ParentHoursPageModel {
  const hourCards: ParentHourCardModel[] = [
    { key: 'paid', label: '购买课时', remaining: view.paidHours },
  ];
  if (view.giftHours !== null) {
    hourCards.push({ key: 'gift', label: '赠送课时', remaining: view.giftHours });
  }

  const entries = view.entries
    .filter((entry) => matchesFilter(entry, filter))
    .map((entry) => ({ ...entry, deltaLabel: formatDelta(entry.delta) }));

  return {
    grossTotal: view.grossTotal ?? view.remainingTotal,
    reservedPaidHours: view.reservedPaidHours ?? 0,
    reservedGiftHours: view.reservedGiftHours ?? 0,
    hasReservations: (view.reservedPaidHours ?? 0) > 0 || (view.reservedGiftHours ?? 0) > 0,
    remainingTotal: view.remainingTotal,
    paidAmountLabel: formatFenAmount(view.paidAmountFen),
    validUntilLabel: view.validUntil ? formatDateLabel(view.validUntil) : '',
    hourCards,
    entries,
    activeFilter: filter,
    isEmpty: entries.length === 0,
  };
}
