import {
  Body,
  Controller,
  Get,
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
import { ParentScopeService } from '../../common/auth/parent-scope.service';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { UploadedStoredFile } from '../file/stored-file.service';
import {
  ParentLessonReviewDto,
  ParentProfileSetupDto,
  StudentPhotoReplaceDto,
} from './dto/parent-growth.dto';
import { ParentGrowthService } from './parent-growth.service';

@Controller('parents/me')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class ParentGrowthController {
  constructor(
    private readonly scope: ParentScopeService,
    private readonly growth: ParentGrowthService,
  ) {}

  @Get('profile-setup')
  @RequirePermissions('PARENT_PROFILE_READ')
  getProfileSetup(@CurrentUser() user: AuthenticatedUser) {
    return this.growth.getProfileSetup(this.scope.resolve(user));
  }

  @Put('students/:studentId/profile-setup')
  @RequirePermissions('PARENT_PROFILE_WRITE')
  completeProfileSetup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
    @Body() dto: ParentProfileSetupDto,
    @IdempotencyKey() key: string,
  ) {
    return this.growth.completeProfileSetup(
      this.scope.resolve(user),
      studentId,
      dto,
      key,
    );
  }

  @Post('students/:studentId/photo-files')
  @HttpCode(200)
  @RequirePermissions('PARENT_PROFILE_WRITE')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024 } }),
  )
  uploadPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
    @UploadedFile() file?: UploadedStoredFile,
  ) {
    return this.growth.uploadPhoto(
      this.scope.resolve(user),
      user,
      studentId,
      file,
    );
  }

  @Put('students/:studentId/photo')
  @RequirePermissions('PARENT_PROFILE_WRITE')
  replacePhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
    @Body() dto: StudentPhotoReplaceDto,
    @IdempotencyKey() key: string,
  ) {
    return this.growth.replacePhoto(
      this.scope.resolve(user),
      studentId,
      dto,
      key,
    );
  }

  @Post('lesson-sessions/:lessonSessionId/students/:studentId/review')
  @HttpCode(200)
  @RequirePermissions('PARENT_REVIEW_WRITE')
  submitReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' }))
    lessonSessionId: string,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
    @Body() dto: ParentLessonReviewDto,
    @IdempotencyKey() key: string,
  ) {
    return this.growth.submitReview(
      this.scope.resolve(user),
      lessonSessionId,
      studentId,
      dto,
      key,
    );
  }
}
