import type { AuthenticatedUser } from '../src/common/auth/authenticated-user';
import { CampusManagerScopeService } from '../src/common/auth/campus-manager-scope.service';
import {
  hasValidStaffCampus,
  DIRECTLY_CREATABLE_STAFF_ROLES,
} from '../src/common/auth/staff-roles';
import { ROLE_PERMISSION_MATRIX } from '../src/modules/iam/role-permission.matrix';

describe('independent operator identity', () => {
  it('has its own campus permissions without manager or financial permissions', () => {
    expect(ROLE_PERMISSION_MATRIX.OPERATOR).toContain('OPERATOR_LEAVE_REVIEW');
    expect(ROLE_PERMISSION_MATRIX.OPERATOR).toContain(
      'OPERATOR_SCHEDULE_CREATE',
    );
    for (const permission of [
      'CAMPUS_LEAVE_REVIEW',
      'CAMPUS_SCHEDULE_CREATE',
      'LESSON_COMPLETE',
      'LESSON_LEDGER_ADJUST',
      'WITHDRAWAL_MARK_PAID',
      'STAFF_ACCOUNT_MANAGE',
    ]) {
      expect(ROLE_PERMISSION_MATRIX.OPERATOR).not.toContain(permission);
    }
    expect(ROLE_PERMISSION_MATRIX.CAMPUS_MANAGER).not.toContain(
      'OPERATOR_LEAVE_REVIEW',
    );
  });

  it('keeps manager routes closed to operator identities', () => {
    const user: AuthenticatedUser = {
      userId: 'operator',
      roles: [{ code: 'OPERATOR', campusId: 'campus' }],
    };
    expect(() => new CampusManagerScopeService().require(user)).toThrow();
  });

  it('allows creating an independent campus operator without accepting an unscoped total account', () => {
    expect(DIRECTLY_CREATABLE_STAFF_ROLES).toContain('OPERATOR');
    expect(hasValidStaffCampus('OPERATOR', 'campus')).toBe(true);
    expect(hasValidStaffCampus('OPERATOR', null)).toBe(false);
  });
});
