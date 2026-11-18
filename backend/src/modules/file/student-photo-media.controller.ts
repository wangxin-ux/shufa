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

@Controller('media/student-photos')
export class StudentPhotoMediaController {
  constructor(private readonly files: StoredFileService) {}

  @Get(':storedFileId')
  async read(
    @Param('storedFileId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const image = await this.files.readStudentPhoto(id, expires, signature);
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(image.buffer, { type: image.mimeType });
  }
}
