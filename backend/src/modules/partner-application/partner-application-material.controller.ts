import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { UploadedStoredFile } from '../file/stored-file.service';
import {
  PartnerApplicantGuard,
  type ApplicantRequest,
} from './partner-applicant.guard';
import { PartnerApplicationMaterialService } from './partner-application-material.service';
import {
  ReservePartnerMaterialDto,
  SavePartnerMaterialsDto,
} from './dto/partner-application-material.dto';

@Controller('partner-applicants/me/application')
@UseGuards(PartnerApplicantGuard)
export class PartnerApplicationMaterialController {
  constructor(private readonly materials: PartnerApplicationMaterialService) {}
  @Get('materials')
  @Header('Cache-Control', 'no-store')
  list(@Req() request: ApplicantRequest) {
    return this.materials.getOwn(request.applicant);
  }

  @Put('materials')
  @Header('Cache-Control', 'no-store')
  save(
    @Req() request: ApplicantRequest,
    @Body() input: SavePartnerMaterialsDto,
  ) {
    return this.materials.saveOwn(request.applicant, input);
  }
  @Post('material-uploads')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  reserve(
    @Req() request: ApplicantRequest,
    @Body() input: ReservePartnerMaterialDto,
  ) {
    return this.materials.reserve(request.applicant, input);
  }
  @Post('material-uploads/:uploadId')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      // Busboy emits partsLimit upon reaching it; files/fields still allow only one file.
      limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 0, parts: 2 },
    }),
  )
  upload(
    @Req() request: ApplicantRequest,
    @Param('uploadId', new ParseUUIDPipe({ version: '4' })) id: string,
    @UploadedFile() file?: UploadedStoredFile,
  ) {
    return this.materials.upload(request.applicant, id, file);
  }
  @Get('materials/:storedFileId/content')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async read(
    @Req() request: ApplicantRequest,
    @Param('storedFileId', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const image = await this.materials.readOwn(request.applicant, id);
    return new StreamableFile(image.buffer, {
      type: image.mimeType,
      length: image.buffer.length,
      disposition: `inline; filename="${image.kind}.${image.mimeType === 'image/png' ? 'png' : 'jpg'}"`,
    });
  }
}
