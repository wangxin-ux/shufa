import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { TeacherScopeService } from '../../common/auth/teacher-scope.service';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { FeedbackUpsertDto } from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

@Controller('teachers/me/lesson-sessions')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class FeedbackController {
  constructor(
    private readonly teacherScopeService: TeacherScopeService,
    private readonly feedbackService: FeedbackService,
  ) {}

  @Post(':lessonSessionId/students/:studentId/feedback-images')
  @HttpCode(200)
  @RequirePermissions('FEEDBACK_WRITE')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  async uploadImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' }))
    lessonSessionId: string,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
    @UploadedFile()
    file?: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
  ) {
    return this.feedbackService.uploadImage(
      await this.teacherScopeService.resolve(user),
      user,
      lessonSessionId,
      studentId,
      file,
    );
  }

  @Put(':lessonSessionId/students/:studentId/feedback')
  @RequirePermissions('FEEDBACK_WRITE')
  async upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' }))
    lessonSessionId: string,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
    @Body() dto: FeedbackUpsertDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    return this.feedbackService.upsert(
      await this.teacherScopeService.resolve(user),
      lessonSessionId,
      studentId,
      dto,
      idempotencyKey,
    );
  }
}
