import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { StoredFileService } from './stored-file.service';

@Controller('media/customer-service-qr')
export class CustomerServiceQrMediaController {
  constructor(private readonly storedFileService: StoredFileService) {}

  @Get(':storedFileId')
  async read(
    @Param('storedFileId', new ParseUUIDPipe({ version: '4' }))
    storedFileId: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const image = await this.storedFileService.readCustomerServiceQr(
      storedFileId,
      expires,
      signature,
    );
    response.setHeader('Cache-Control', 'private, max-age=900');
    return new StreamableFile(image.buffer, { type: image.mimeType });
  }
}
