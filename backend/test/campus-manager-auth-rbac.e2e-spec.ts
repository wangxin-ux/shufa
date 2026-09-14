import type { AuthenticatedUser } from '../src/common/auth/authenticated-user';
import { CampusManagerScopeService } from '../src/common/auth/campus-manager-scope.service';
import { DomainError } from '../src/common/errors/domain-error';
import { ROLE_PERMISSION_MATRIX } from '../src/modules/iam/role-permission.matrix';

const managerPermissions = [
  'CAMPUS_DASHBOARD_READ',
  'CAMPUS_STUDENT_READ',
  'CAMPUS_STUDENT_CREATE',
  'CAMPUS_ROSTER_MANAGE',
  'CAMPUS_ROSTER_EXPORT',
  'CAMPUS_SCHEDULE_READ',
  'CAMPUS_SCHEDULE_CREATE',
  'CAMPUS_SCHEDULE_UPDATE',
  'CAMPUS_LEAVE_REVIEW',
  'CAMPUS_WARNING_READ',
  'CAMPUS_SETTINGS_READ',
  'CAMPUS_SETTINGS_UPDATE',
] as const;

const forbiddenPermissions = [
  'EARNING_RULE_MANAGE',
  'TEACHER_EARNING_REVIEW',
  'WITHDRAWAL_REVIEW',
  'WITHDRAWAL_MARK_PAID',
  'LESSON_COMPLETE',
  'LESSON_REVERSE_OWN_WINDOW',
] as const;

function captureDomainError(action: () => unknown): DomainError {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected a DomainError');
}

describe('campus manager RBAC foundation', () => {
  it('grants only the confirmed campus manager permissions', () => {
    expect(ROLE_PERMISSION_MATRIX.CAMPUS_MANAGER).toEqual(managerPermissions);
    expect(ROLE_PERMISSION_MATRIX.CAMPUS_MANAGER).not.toEqual(
      expect.arrayContaining(forbiddenPermissions),
    );
  });

  it('resolves exactly one campus manager role and fails closed otherwise', () => {
    const service = new CampusManagerScopeService();
    const valid: AuthenticatedUser = {
      userId: 'manager-user',
      roles: [{ code: 'CAMPUS_MANAGER', campusId: 'campus-east' }],
    };

    expect(service.require(valid)).toEqual({
      userId: 'manager-user',
      campusId: 'campus-east',
    });
    expect(
      captureDomainError(() =>
        service.require({
          userId: 'teacher',
          roles: [{ code: 'TEACHER', campusId: 'campus-east' }],
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(
      captureDomainError(() =>
        service.require({
          userId: 'manager',
          roles: [{ code: 'CAMPUS_MANAGER', campusId: null }],
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(
      captureDomainError(() =>
        service.require({
          userId: 'mixed',
          roles: [
            { code: 'CAMPUS_MANAGER', campusId: 'campus-east' },
            { code: 'TEACHER', campusId: 'campus-east' },
          ],
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });
});
