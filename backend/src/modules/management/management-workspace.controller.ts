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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { UploadedStoredFile } from '../file/stored-file.service';
import {
  ManagementAdjustLessonLedgerDto,
  ManagementAuditLogsQueryDto,
  ManagementCampusesQueryDto,
  ManagementLessonLedgerQueryDto,
  ManagementStudentsQueryDto,
  ManagementUpdateCampusMapLocationDto,
  ManagementUploadCampusCustomerServiceQrDto,
  ManagementUpdateCoursePackageValidityDto,
} from './dto/management.dto';
import { ManagementWorkspaceService } from './management-workspace.service';

@Controller('management')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class ManagementWorkspaceController {
  constructor(private readonly service: ManagementWorkspaceService) {}

  @Get('campuses')
  @RequirePermissions('GLOBAL_CAMPUS_READ')
  listCampuses(@Query() query: ManagementCampusesQueryDto) {
    return this.service.listCampuses(query);
  }

  @Get('campuses/:campusId')
  @RequirePermissions('GLOBAL_CAMPUS_READ')
  getCampus(
    @Param('campusId', new ParseUUIDPipe({ version: '4' })) campusId: string,
  ) {
    return this.service.getCampus(campusId);
  }

  @Patch('campuses/:campusId/map-location')
  @RequirePermissions('GLOBAL_CAMPUS_MAP_MANAGE')
  updateCampusMapLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campusId', new ParseUUIDPipe({ version: '4' })) campusId: string,
    @Body() dto: ManagementUpdateCampusMapLocationDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.service.updateCampusMapLocation(
      user,
      campusId,
      dto,
      idempotencyKey,
    );
  }

  @Post('campuses/:campusId/customer-service-qr')
  @HttpCode(200)
  @RequirePermissions('GLOBAL_CAMPUS_MAP_MANAGE')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024 } }),
  )
  uploadCampusCustomerServiceQr(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campusId', new ParseUUIDPipe({ version: '4' })) campusId: string,
    @Body() dto: ManagementUploadCampusCustomerServiceQrDto,
    @UploadedFile() file: UploadedStoredFile | undefined,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.service.uploadCampusCustomerServiceQr(
      user,
      campusId,
      dto,
      file,
      idempotencyKey,
    );
  }

  @Get('students')
  @RequirePermissions('GLOBAL_STUDENT_READ')
  listStudents(@Query() query: ManagementStudentsQueryDto) {
    return this.service.listStudents(query);
  }

  @Get('students/:studentId')
  @RequirePermissions('GLOBAL_STUDENT_READ')
  getStudent(
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
  ) {
    return this.service.getStudent(studentId);
  }

  @Patch('course-packages/:coursePackageId/validity')
  @RequirePermissions('COURSE_PACKAGE_VALIDITY_MANAGE')
  updateCoursePackageValidity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('coursePackageId', new ParseUUIDPipe({ version: '4' }))
    coursePackageId: string,
    @Body() dto: ManagementUpdateCoursePackageValidityDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.service.updateCoursePackageValidity(
      user,
      coursePackageId,
      dto,
      idempotencyKey,
    );
  }

  @Get('lesson-ledger')
  @RequirePermissions('GLOBAL_LEDGER_READ')
  listLessonLedger(@Query() query: ManagementLessonLedgerQueryDto) {
    return this.service.listLessonLedger(query);
  }

  @Post('lesson-ledger/adjustments')
  @HttpCode(200)
  @RequirePermissions('LESSON_LEDGER_ADJUST')
  adjustLessonLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ManagementAdjustLessonLedgerDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.service.adjustLessonLedger(user, dto, idempotencyKey);
  }

  @Get('system-settings')
  @RequirePermissions('GLOBAL_SETTINGS_READ')
  getSystemSettings() {
    return this.service.getSystemSettings();
  }

  @Get('role-permissions')
  @RequirePermissions('ROLE_PERMISSION_READ')
  getRolePermissions() {
    return this.service.getRolePermissions();
  }

  @Get('audit-logs')
  @RequirePermissions('AUDIT_LOG_READ')
  listAuditLogs(@Query() query: ManagementAuditLogsQueryDto) {
    return this.service.listAuditLogs(query);
  }
}
