import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { AccessTokenGuard } from '../auth/access-token.guard';
import {
  PartnerTeacherEvaluationDto,
  PartnerTeacherPerformanceQueryDto,
} from './dto/partner-teacher-performance.dto';
import { PartnerTeacherPerformanceService } from './partner-teacher-performance.service';

@Controller('partners/me/teachers/:teacherId')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PartnerTeacherPerformanceController {
  constructor(private readonly service: PartnerTeacherPerformanceService) {}

  @Get('performance')
  @RequirePermissions('PARTNER_TEACHER_READ')
  performance(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('teacherId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: PartnerTeacherPerformanceQueryDto,
  ) {
    return this.service.performance(actor, id, query);
  }

  @Put('evaluation')
  @RequirePermissions('PARTNER_TEACHER_EVALUATE')
  save(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('teacherId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: PartnerTeacherEvaluationDto,
  ) {
    return this.service.save(actor, id, body);
  }

  @Get('evaluation-history')
  @RequirePermissions('PARTNER_TEACHER_READ')
  history(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('teacherId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: PartnerTeacherPerformanceQueryDto,
  ) {
    return this.service.history(actor, id, query);
  }
}
