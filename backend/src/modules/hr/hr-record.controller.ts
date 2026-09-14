import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
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
  ArchiveHrTeacherRecordDto,
  HrTeacherRecordInputDto,
  HrTeacherRecordQueryDto,
  UpdateHrTeacherRecordDto,
} from './hr-record.dto';
import { HrRecordService } from './hr-record.service';

@Controller('hr')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class HrRecordController {
  constructor(private readonly service: HrRecordService) {}

  @Post('teacher-record-attachments')
  @RequirePermissions('HR_TEACHER_RECORD_WRITE')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 3 * 1024 * 1024, files: 1 },
    }),
  )
  uploadAttachment(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file?: UploadedStoredFile,
  ) {
    return this.service.uploadAttachment(actor, file);
  }

  @Get('teachers/:teacherId/records')
  @RequirePermissions('HR_TEACHER_READ')
  records(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('teacherId', new ParseUUIDPipe({ version: '4' })) teacherId: string,
    @Query() query: HrTeacherRecordQueryDto,
  ) {
    return this.service.records(actor, teacherId, query);
  }

  @Post('teachers/:teacherId/records')
  @RequirePermissions('HR_TEACHER_RECORD_WRITE')
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('teacherId', new ParseUUIDPipe({ version: '4' })) teacherId: string,
    @Body() input: HrTeacherRecordInputDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.create(actor, teacherId, input, key);
  }

  @Patch('teacher-records/:recordId')
  @RequirePermissions('HR_TEACHER_RECORD_WRITE')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('recordId', new ParseUUIDPipe({ version: '4' })) recordId: string,
    @Body() input: UpdateHrTeacherRecordDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.update(actor, recordId, input, key);
  }

  @Post('teacher-records/:recordId/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('HR_TEACHER_RECORD_WRITE')
  archive(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('recordId', new ParseUUIDPipe({ version: '4' })) recordId: string,
    @Body() input: ArchiveHrTeacherRecordDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.archive(actor, recordId, input, key);
  }

  @Get('teacher-records/:recordId/attachment')
  @RequirePermissions('HR_TEACHER_READ')
  async attachment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('recordId', new ParseUUIDPipe({ version: '4' })) recordId: string,
    @Res() response: Response,
  ) {
    const file = await this.service.readAttachment(actor, recordId);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.type(file.mimeType).send(file.buffer);
  }
}
