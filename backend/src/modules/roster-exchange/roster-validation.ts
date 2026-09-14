import { createHash } from 'node:crypto';
import { normalizeStaffPhone } from '../management/staff-account-management.service';
import type { RosterTemplateVersion } from './roster.types';

export function normalizeRosterName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeRosterPhone(value: string): string | null {
  try {
    return normalizeStaffPhone(value);
  } catch {
    return null;
  }
}

export function stableRosterRowKey(
  fileHash: string,
  version: RosterTemplateVersion,
  rowNumber: number,
): string {
  return `roster-${createHash('sha256')
    .update(`${fileHash}:${version}:${rowNumber}`, 'utf8')
    .digest('hex')}`;
}

export function maskRosterPhone(value: string | null): string {
  return value ? `138****${value.slice(-4)}`.replace(/^138/, value.slice(-11, -8)) : '';
}
