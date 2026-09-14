import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CampusManagerScopeService } from '../../common/auth/campus-manager-scope.service';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../common/auth/permissions.guard';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import {
  CustomerRosterEntryDto,
  RosterExportQueryDto,
  RosterListQueryDto,
  TeacherRosterEntryDto,
} from './dto/roster-exchange.dto';
import { RosterExchangeService } from './roster-exchange.service';
import { xlsxResponse } from './roster-response';
import type { UploadedRosterFile } from './roster.types';

const upload = FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } });

@Controller('campus-managers/me/rosters')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class CampusManagerRosterController {
  constructor(
    private readonly service: RosterExchangeService,
    private readonly scopeService: CampusManagerScopeService,
  ) {}

  @Get('customers/template')
  @RequirePermissions('CAMPUS_ROSTER_MANAGE')
  async customerTemplate(@Res({ passthrough: true }) response: Response) {
    return xlsxResponse(
      response,
      await this.service.template('customers', 'CAMPUS'),
      '本校区顾客导入模板.xlsx',
    );
  }

  @Get('teachers/template')
  @RequirePermissions('CAMPUS_ROSTER_MANAGE')
  async teacherTemplate(@Res({ passthrough: true }) response: Response) {
    return xlsxResponse(
      response,
      await this.service.template('teachers', 'CAMPUS'),
      '本校区教师导入模板.xlsx',
    );
  }

  @Post('customers/preview')
  @HttpCode(200)
  @RequirePermissions('CAMPUS_ROSTER_MANAGE')
  @UseInterceptors(upload)
  previewCustomers(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file?: UploadedRosterFile,
  ) {
    return this.service.preview(
      'customers',
      'CAMPUS',
      this.scopeService.require(actor).campusId,
      file,
    );
  }

  @Post('teachers/preview')
  @HttpCode(200)
  @RequirePermissions('CAMPUS_ROSTER_MANAGE')
  @UseInterceptors(upload)
  previewTeachers(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file?: UploadedRosterFile,
  ) {
    return this.service.preview(
      'teachers',
      'CAMPUS',
      this.scopeService.require(actor).campusId,
      file,
    );
  }

  @Post('customers/import')
  @HttpCode(200)
  @RequirePermissions('CAMPUS_ROSTER_MANAGE')
  @UseInterceptors(upload)
  importCustomers(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file?: UploadedRosterFile,
  ) {
    return this.service.import(
      actor,
      'customers',
      'CAMPUS',
      this.scopeService.require(actor).campusId,
      file,
    );
  }

  @Post('teachers/import')
  @HttpCode(200)
  @RequirePermissions('CAMPUS_ROSTER_MANAGE')
  @UseInterceptors(upload)
  importTeachers(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file?: UploadedRosterFile,
  ) {
    return this.service.import(
      actor,
      'teachers',
      'CAMPUS',
      this.scopeService.require(actor).campusId,
      file,
    );
  }

  @Post('customers/entries')
  @HttpCode(200)
  @RequirePermissions('CAMPUS_ROSTER_MANAGE')
  quickCustomer(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() input: CustomerRosterEntryDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.quickCustomer(
      actor,
      this.scopeService.require(actor).campusId,
      input,
      key,
    );
  }

  @Post('teachers/entries')
  @HttpCode(200)
  @RequirePermissions('CAMPUS_ROSTER_MANAGE')
  quickTeacher(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() input: TeacherRosterEntryDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.quickTeacher(
      actor,
      this.scopeService.require(actor).campusId,
      input,
      key,
    );
  }

  @Get('customers/export')
  @RequirePermissions('CAMPUS_ROSTER_EXPORT')
  async exportCustomers(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: RosterExportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return xlsxResponse(
      response,
      await this.service.export(
        actor,
        'customers',
        'CAMPUS',
        this.scopeService.require(actor).campusId,
        query.query,
        query.confirmed,
      ),
      '本校区顾客名册.xlsx',
    );
  }

  @Get('teachers/export')
  @RequirePermissions('CAMPUS_ROSTER_EXPORT')
  async exportTeachers(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: RosterExportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return xlsxResponse(
      response,
      await this.service.export(
        actor,
        'teachers',
        'CAMPUS',
        this.scopeService.require(actor).campusId,
        query.query,
        query.confirmed,
      ),
      '本校区教师名册.xlsx',
    );
  }

  @Get('teachers')
  @RequirePermissions('CAMPUS_ROSTER_MANAGE')
  listTeachers(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: RosterListQueryDto,
  ) {
    return this.service.listTeachers(
      this.scopeService.require(actor).campusId,
      query.query,
      query.page,
      query.pageSize,
    );
  }
}
