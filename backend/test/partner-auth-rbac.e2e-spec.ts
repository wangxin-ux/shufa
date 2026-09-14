import type { AuthenticatedUser } from '../src/common/auth/authenticated-user';
import { PartnerScopeService } from '../src/common/auth/partner-scope.service';
import { DomainError } from '../src/common/errors/domain-error';
import { ROLE_PERMISSION_MATRIX } from '../src/modules/iam/role-permission.matrix';

const partnerPermissions = [
  'PARTNER_DASHBOARD_READ',
  'PARTNER_PROFILE_READ',
  'PARTNER_STUDENT_READ',
  'PARTNER_WARNING_READ',
  'PARTNER_ATTENDANCE_READ',
  'PARTNER_TEACHER_READ',
  'PARTNER_LEDGER_READ',
  'PARTNER_EARNING_READ',
  'PARTNER_GROUP_CAMPAIGN_READ',
] as const;

const forbiddenPermissions = [
  'CAMPUS_STUDENT_CREATE',
  'CAMPUS_SCHEDULE_CREATE',
  'CAMPUS_LEAVE_REVIEW',
  'CAMPUS_SETTINGS_UPDATE',
  'EARNING_RULE_MANAGE',
  'WITHDRAWAL_REVIEW',
  'LESSON_LEDGER_ADJUST',
  'GROUP_CAMPAIGN_MANAGE',
  'PARENT_GROUP_JOIN',
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

describe('partner RBAC foundation', () => {
  it('grants only the confirmed partner read permissions', () => {
    expect(ROLE_PERMISSION_MATRIX.PARTNER).toEqual(partnerPermissions);
    expect(ROLE_PERMISSION_MATRIX.PARTNER).not.toEqual(
      expect.arrayContaining(forbiddenPermissions),
    );
  });

  it('resolves exactly one campus-scoped partner role and fails closed otherwise', () => {
    const service = new PartnerScopeService();
    const valid: AuthenticatedUser = {
      userId: 'partner-user',
      roles: [{ code: 'PARTNER', campusId: 'campus-east' }],
    };

    expect(service.require(valid)).toEqual({
      userId: 'partner-user',
      campusId: 'campus-east',
    });
    for (const invalid of [
      {
        userId: 'manager',
        roles: [{ code: 'CAMPUS_MANAGER' as const, campusId: 'campus-east' }],
      },
      {
        userId: 'partner',
        roles: [{ code: 'PARTNER' as const, campusId: null }],
      },
      {
        userId: 'mixed',
        roles: [
          { code: 'PARTNER' as const, campusId: 'campus-east' },
          { code: 'TEACHER' as const, campusId: 'campus-east' },
        ],
      },
    ] satisfies AuthenticatedUser[]) {
      expect(captureDomainError(() => service.require(invalid))).toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
      });
    }
  });
});
