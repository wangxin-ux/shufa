import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { ManagementPageQueryDto } from './dto/management.dto';
import {
  CreateOperatorHeadquartersDto,
  UpdateOperatorCampusGrantDto,
} from './dto/operator-headquarters-management.dto';
import { OperatorHeadquartersManagementService } from './operator-headquarters-management.service';

@Controller('management/operator-headquarters')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('STAFF_ACCOUNT_MANAGE')
export class OperatorHeadquartersManagementController {
  constructor(
    private readonly service: OperatorHeadquartersManagementService,
  ) {}

  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() input: CreateOperatorHeadquartersDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.create(actor, input, key);
  }

  @Get(':userId/campuses')
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Query() query: ManagementPageQueryDto,
  ) {
    return this.service.listGrants(actor, userId, query);
  }

  @Put(':userId/campuses/:campusId')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Param('campusId', new ParseUUIDPipe({ version: '4' })) campusId: string,
    @Body() input: UpdateOperatorCampusGrantDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.updateGrant(actor, userId, campusId, input, key);
  }
}
