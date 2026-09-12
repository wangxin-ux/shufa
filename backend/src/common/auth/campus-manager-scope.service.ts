import { Injectable } from '@nestjs/common';
import { DomainError } from '../errors/domain-error';
import { ErrorCode } from '../errors/error-codes';
import type { AuthenticatedUser } from './authenticated-user';

export interface CampusManagerScope {
  userId: string;
  campusId: string;
}

@Injectable()
export class CampusManagerScopeService {
  require(user: AuthenticatedUser): CampusManagerScope {
    const managerRoles = user.roles.filter(
      ({ code }) => code === 'CAMPUS_MANAGER',
    );
    const campusId = managerRoles[0]?.campusId;
    if (user.roles.length !== 1 || managerRoles.length !== 1 || !campusId) {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        'A single campus manager scope is required',
        403,
      );
    }

    return { userId: user.userId, campusId };
  }
}
