import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateStaffAccountDto } from './staff-account-management.dto';

describe('staff account headquarters request validation', () => {
  const base = { displayName: '总部账号', phone: '13800138000' };
  it.each(['HR', 'FINANCE'])('accepts %s only with explicit null campus', (roleCode) => {
    expect(validateSync(plainToInstance(CreateStaffAccountDto, { ...base, roleCode, campusId: null }))).toEqual([]);
    for (const campusId of [undefined, '', '10000000-0000-4000-8000-000000000001']) {
      expect(validateSync(plainToInstance(CreateStaffAccountDto, { ...base, roleCode, campusId })).length).toBeGreaterThan(0);
    }
  });
  it.each(['CAMPUS_MANAGER', 'PARTNER'])('retains mandatory UUID campus for %s', (roleCode) => {
    expect(validateSync(plainToInstance(CreateStaffAccountDto, { ...base, roleCode, campusId: '10000000-0000-4000-8000-000000000001' }))).toEqual([]);
    expect(validateSync(plainToInstance(CreateStaffAccountDto, { ...base, roleCode, campusId: null })).length).toBeGreaterThan(0);
  });
  it('continues to reject direct teacher creation', () => {
    expect(validateSync(plainToInstance(CreateStaffAccountDto, { ...base, roleCode: 'TEACHER', campusId: '10000000-0000-4000-8000-000000000001' })).some((error) => error.property === 'roleCode')).toBe(true);
  });
});
