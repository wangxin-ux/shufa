import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { AccessTokenGuard } from '../auth/access-token.guard';
import {
  HrDirectoryQueryDto,
  HrTeacherQueryDto,
  HrReportQueryDto,
} from './hr.dto';
import { HrService } from './hr.service';
import type { Response } from 'express';
import { xlsxResponse } from '../roster-exchange/roster-response';

@Controller('hr')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('HR_TEACHER_READ')
export class HrController {
  constructor(private readonly service: HrService) {}
  @Get('reports/:kind/export')
  @RequirePermissions('HR_REPORT_EXPORT')
  async exportReport(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('kind') kind: string,
    @Query() query: HrReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const buffer = await this.service.exportReport(actor, kind, query);
    return xlsxResponse(response, buffer, `hr-${kind}.xlsx`);
  }
  @Get('reports/teaching')
  @RequirePermissions('HR_REPORT_READ')
  teachingReport(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: HrReportQueryDto,
  ) {
    return this.service.teachingReport(actor, query);
  }
  @Get('reports/earnings')
  @RequirePermissions('HR_REPORT_READ')
  earningReport(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: HrReportQueryDto,
  ) {
    return this.service.earningReport(actor, query);
  }
  @Get('campuses')
  campuses(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: HrDirectoryQueryDto,
  ) {
    return this.service.campuses(actor, query);
  }
  @Get('teachers')
  teachers(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: HrTeacherQueryDto,
  ) {
    return this.service.teachers(actor, query);
  }
  @Get('teachers/:teacherId')
  teacher(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('teacherId', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.teacher(actor, id);
  }
}
