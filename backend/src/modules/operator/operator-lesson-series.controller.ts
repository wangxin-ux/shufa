import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
  OperatorCancellationPreviewDto,
  OperatorCancelSelectionDto,
  OperatorCreateSeriesDto,
  OperatorSeriesPatternDto,
} from './dto/operator-lesson-series.dto';
import { OperatorLessonSeriesService } from './operator-lesson-series.service';

@Controller('operators/me')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class OperatorLessonSeriesController {
  constructor(private readonly series: OperatorLessonSeriesService) {}

  @Post('lesson-series/preview')
  @HttpCode(200)
  @RequirePermissions('OPERATOR_SCHEDULE_READ')
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OperatorSeriesPatternDto,
  ) {
    return this.series.preview(user, dto);
  }

  @Post('lesson-series')
  @HttpCode(200)
  @RequirePermissions('OPERATOR_SCHEDULE_CREATE')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OperatorCreateSeriesDto,
    @IdempotencyKey() key: string,
  ) {
    return this.series.create(user, dto, key);
  }

  @Post('lesson-sessions/:lessonSessionId/cancellation-preview')
  @HttpCode(200)
  @RequirePermissions('OPERATOR_SCHEDULE_READ')
  previewCancellation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: OperatorCancellationPreviewDto,
  ) {
    return this.series.previewCancellation(user, id, dto);
  }

  @Post('lesson-sessions/:lessonSessionId/cancel-selection')
  @HttpCode(200)
  @RequirePermissions('OPERATOR_SCHEDULE_UPDATE')
  cancelSelection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonSessionId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: OperatorCancelSelectionDto,
    @IdempotencyKey() key: string,
  ) {
    return this.series.cancelSelection(user, id, dto, key);
  }
}
