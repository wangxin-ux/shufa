import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
  SubjectBindDto,
  SubjectCreateDto,
  SubjectLinksQueryDto,
  SubjectPageQueryDto,
  SubjectUpdateDto,
} from './campus-subject.dto';
import { CampusSubjectService } from './campus-subject.service';
const uuid = () => new ParseUUIDPipe({ version: '4' });

@Controller('management/campuses/:campusId/subjects')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions('CAMPUS_SUBJECT_MANAGE')
export class CampusSubjectController {
  constructor(private readonly service: CampusSubjectService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campusId', uuid()) campusId: string,
    @Query() query: SubjectPageQueryDto,
  ) {
    return this.service.list(user, campusId, query);
  }
  @Post()
  @HttpCode(200)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campusId', uuid()) campusId: string,
    @Body() dto: SubjectCreateDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.create(user, campusId, dto, key);
  }
  @Get('links')
  links(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campusId', uuid()) campusId: string,
    @Query() query: SubjectLinksQueryDto,
  ) {
    return this.service.links(user, campusId, query);
  }
  @Patch('links/:kind/:id')
  bind(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campusId', uuid()) campusId: string,
    @Param('kind') kind: string,
    @Param('id', uuid()) id: string,
    @Body() dto: SubjectBindDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.bind(user, campusId, kind, id, dto, key);
  }
  @Patch(':subjectId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campusId', uuid()) campusId: string,
    @Param('subjectId', uuid()) subjectId: string,
    @Body() dto: SubjectUpdateDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.update(user, campusId, subjectId, dto, key);
  }
}

@Controller('partners/me/subjects')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PartnerSubjectController {
  constructor(private readonly service: CampusSubjectService) {}
  @Get()
  @RequirePermissions('PARTNER_LEDGER_READ')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SubjectPageQueryDto,
  ) {
    return this.service.list(user, null, query);
  }
}
