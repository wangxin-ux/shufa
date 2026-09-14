import { Injectable } from '@nestjs/common';
import { DomainError } from '../errors/domain-error';
import { ErrorCode } from '../errors/error-codes';
import type { AuthenticatedUser } from './authenticated-user';

export interface PartnerScope {
  userId: string;
  campusId: string;
}

@Injectable()
export class PartnerScopeService {
  require(user: AuthenticatedUser): PartnerScope {
    const partnerRoles = user.roles.filter(({ code }) => code === 'PARTNER');
    const campusId = partnerRoles[0]?.campusId;
    if (user.roles.length !== 1 || partnerRoles.length !== 1 || !campusId) {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        'A single campus-scoped partner role is required',
        403,
      );
    }

    return { userId: user.userId, campusId };
  }
}
