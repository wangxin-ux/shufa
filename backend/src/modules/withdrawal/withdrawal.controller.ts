import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { TeacherScopeService } from '../../common/auth/teacher-scope.service';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { VersionedActionDto } from '../earning/dto/earning.dto';
import {
  CreateWithdrawalDto,
  TeacherWithdrawalsQueryDto,
} from './dto/withdrawal.dto';
import { WithdrawalService } from './withdrawal.service';

@Controller('teachers/me/withdrawals')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class WithdrawalController {
  constructor(
    private readonly teacherScopeService: TeacherScopeService,
    private readonly withdrawalService: WithdrawalService,
  ) {}

  @Get()
  @RequirePermissions('TEACHER_WITHDRAWAL_READ_OWN')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TeacherWithdrawalsQueryDto,
  ) {
    return this.withdrawalService.listTeacherWithdrawals(
      await this.teacherScopeService.resolve(user),
      query,
    );
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions('TEACHER_WITHDRAWAL_CREATE')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWithdrawalDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.withdrawalService.create(
      await this.teacherScopeService.resolve(user),
      dto,
      idempotencyKey,
    );
  }

  @Post(':withdrawalId/cancel')
  @HttpCode(200)
  @RequirePermissions('TEACHER_WITHDRAWAL_CANCEL_OWN')
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('withdrawalId', new ParseUUIDPipe({ version: '4' }))
    withdrawalId: string,
    @Body() dto: VersionedActionDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.withdrawalService.cancel(
      await this.teacherScopeService.resolve(user),
      withdrawalId,
      dto,
      idempotencyKey,
    );
  }
}
