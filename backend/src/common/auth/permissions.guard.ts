import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DomainError } from '../errors/domain-error';
import { ErrorCode } from '../errors/error-codes';
import type { Permission } from '../../modules/iam/permissions.constants';
import { ROLE_PERMISSION_MATRIX } from '../../modules/iam/role-permission.matrix';
import type { AuthenticatedUser } from './authenticated-user';

const REQUIRED_PERMISSIONS = 'required-permissions';

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new DomainError(
        ErrorCode.UNAUTHORIZED,
        'Authentication is required',
        401,
      );
    }

    const granted = new Set(
      request.user.roles.flatMap(
        ({ code }) => ROLE_PERMISSION_MATRIX[code] ?? [],
      ),
    );
    if (!required.every((permission) => granted.has(permission))) {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        'The authenticated user lacks the required permission',
        403,
      );
    }

    return true;
  }
}
