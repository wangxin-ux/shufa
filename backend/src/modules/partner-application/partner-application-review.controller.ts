import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { PartnerApplicationReviewService } from './partner-application-review.service';
import { SubmitPartnerApplicationDto } from './dto/partner-application-submit.dto';
import {
  PartnerApplicationReviewQueryDto,
  RejectPartnerApplicationDto,
} from './dto/partner-application-review.dto';
const uuid = () => new ParseUUIDPipe({ version: '4' });

@Controller('management/partner-applications')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('PARTNER_APPLICATION_REVIEW')
export class PartnerApplicationReviewController {
  constructor(private readonly reviews: PartnerApplicationReviewService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() req: Request & { user: AuthenticatedUser },
    @Query() query: PartnerApplicationReviewQueryDto,
  ) {
    return this.reviews.list(req.user, query);
  }
  @Get(':applicationId/submissions/:submissionId')
  @Header('Cache-Control', 'no-store')
  detail(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param('applicationId', uuid()) aid: string,
    @Param('submissionId', uuid()) sid: string,
  ) {
    return this.reviews.detail(req.user, aid, sid);
  }
  @Get(':applicationId/submissions/:submissionId/bank-information')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  bank(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param('applicationId', uuid()) aid: string,
    @Param('submissionId', uuid()) sid: string,
  ) {
    return this.reviews.bank(req.user, aid, sid);
  }
  @Get(
    ':applicationId/submissions/:submissionId/materials/:storedFileId/content',
  )
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async image(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param('applicationId', uuid()) aid: string,
    @Param('submissionId', uuid()) sid: string,
    @Param('storedFileId', uuid()) fid: string,
  ) {
    const file = await this.reviews.image(req.user, aid, sid, fid);
    return new StreamableFile(file.buffer, {
      type: file.mimeType,
      length: file.buffer.length,
      disposition: `inline; filename="${file.kind}.${file.mimeType === 'image/png' ? 'png' : 'jpg'}"`,
    });
  }
  @Post(':applicationId/submissions/:submissionId/reject')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  reject(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param('applicationId', uuid()) aid: string,
    @Param('submissionId', uuid()) sid: string,
    @Body() input: RejectPartnerApplicationDto,
    @IdempotencyKey() key: string,
  ) {
    return this.reviews.reject(req.user, aid, sid, input, key);
  }
  @Post(':applicationId/submissions/:submissionId/approve')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  approve(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param('applicationId', uuid()) aid: string,
    @Param('submissionId', uuid()) sid: string,
    @Body() input: SubmitPartnerApplicationDto,
    @IdempotencyKey() key: string,
  ) {
    return this.reviews.approve(req.user, aid, sid, input, key);
  }
}
