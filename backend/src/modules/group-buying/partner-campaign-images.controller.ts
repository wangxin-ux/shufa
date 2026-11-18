import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import {
  StoredFileService,
  type UploadedStoredFile,
} from '../file/stored-file.service';
import { PartnerCampaignImagesService } from './partner-campaign-images.service';

class ImageVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;
}

@Controller('partners/me/campaign-drafts/:draftId/images')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PartnerCampaignImagesController {
  constructor(private readonly images: PartnerCampaignImagesService) {}
  @Get()
  @RequirePermissions('PARTNER_CAMPAIGN_DRAFT_READ')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.images.get(user, id);
  }
  @Post(':slot')
  @HttpCode(200)
  @RequirePermissions('PARTNER_CAMPAIGN_DRAFT_WRITE')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 1 },
    }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('slot') slot: string,
    @Body() body: ImageVersionDto,
    @UploadedFile() file: UploadedStoredFile | undefined,
    @IdempotencyKey() key: string,
  ) {
    return this.images.upload(user, id, slot, body.expectedVersion, file, key);
  }
  @Put(':slot')
  @RequirePermissions('PARTNER_CAMPAIGN_DRAFT_WRITE')
  clear(
    @CurrentUser() user: AuthenticatedUser,
    @Param('draftId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('slot') slot: string,
    @Body() body: ImageVersionDto,
  ) {
    return this.images.clear(user, id, slot, body.expectedVersion);
  }
}

@Controller('media/partner-campaign-images')
export class PartnerCampaignImageMediaController {
  constructor(private readonly files: StoredFileService) {}
  @Get(':storedFileId')
  async read(
    @Param('storedFileId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const image = await this.files.readPartnerCampaignImage(
      id,
      expires,
      signature,
    );
    response.setHeader('Cache-Control', 'private, max-age=900');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(image.buffer, { type: image.mimeType });
  }
}
