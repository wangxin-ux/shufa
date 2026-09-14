import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import {
  CreateStaffAccountDto,
  StaffAccountsQueryDto,
  UnbindStaffWechatDto,
  UpdateStaffAccountStatusDto,
} from './dto/staff-account-management.dto';
import { StaffAccountManagementService } from './staff-account-management.service';

@Controller('management/staff-accounts')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('STAFF_ACCOUNT_MANAGE')
export class StaffAccountManagementController {
  constructor(private readonly service: StaffAccountManagementService) {}

  @Get()
  list(@Query() query: StaffAccountsQueryDto) {
    return this.service.list(query);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() input: CreateStaffAccountDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.service.createAccount(actor, input, idempotencyKey);
  }

  @Patch(':staffAccountId/status')
  updateStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('staffAccountId', new ParseUUIDPipe({ version: '4' }))
    staffAccountId: string,
    @Body() input: UpdateStaffAccountStatusDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.service.updateStatus(actor, staffAccountId, input, idempotencyKey);
  }

  @Post(':staffAccountId/unbind-wechat')
  @HttpCode(200)
  unbindWechat(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('staffAccountId', new ParseUUIDPipe({ version: '4' }))
    staffAccountId: string,
    @Body() input: UnbindStaffWechatDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.service.unbindWechat(actor, staffAccountId, input, idempotencyKey);
  }
}
