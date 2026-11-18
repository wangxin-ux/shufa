import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { PartnerApplicationService } from './partner-application.service';

@Controller('partners/me/application')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PartnerApplicationArchiveController {
  constructor(private readonly applications: PartnerApplicationService) {}

  @Get()
  @RequirePermissions('PARTNER_PROFILE_READ')
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.applications.getOwnForPartner(user);
  }
}
