import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CampusManagerStudentArchiveService } from './campus-manager-student-archive.service';
import { CampusManagerStudentGrowthQueryDto } from './dto/campus-manager-student.dto';

@Controller('campus-managers/me/students/:studentId/archive')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('CAMPUS_STUDENT_READ')
export class CampusManagerStudentArchiveController {
  constructor(private readonly archive: CampusManagerStudentArchiveService) {}

  @Get()
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
  ) {
    return this.archive.getArchive(user, studentId);
  }

  @Get('growth')
  growth(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
    @Query() query: CampusManagerStudentGrowthQueryDto,
  ) {
    return this.archive.getGrowth(user, studentId, query);
  }

  @Get('media/:storedFileId')
  async media(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
    @Param('storedFileId', new ParseUUIDPipe({ version: '4' }))
    storedFileId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const image = await this.archive.readMedia(user, studentId, storedFileId);
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(image.buffer, { type: image.mimeType });
  }
}
