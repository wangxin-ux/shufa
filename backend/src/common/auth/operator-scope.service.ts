import { Injectable } from '@nestjs/common';
import { DomainError } from '../errors/domain-error';
import { ErrorCode } from '../errors/error-codes';
import type { AuthenticatedUser } from './authenticated-user';

export interface OperatorScope {
  userId: string;
  campusId: string;
}

@Injectable()
export class OperatorScopeService {
  require(user: AuthenticatedUser): OperatorScope {
    const operatorRoles = user.roles.filter(({ code }) => code === 'OPERATOR');
    const campusId = operatorRoles[0]?.campusId;
    if (user.roles.length !== 1 || operatorRoles.length !== 1 || !campusId) {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        'A single campus operator scope is required',
        403,
      );
    }

    return { userId: user.userId, campusId };
  }
}
