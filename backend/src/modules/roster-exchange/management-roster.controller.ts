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
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../common/auth/permissions.guard';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import {
  ManagementCustomerRosterEntryDto,
  ManagementRosterExportQueryDto,
  ManagementRosterListQueryDto,
  ManagementTeacherRosterEntryDto,
} from './dto/roster-exchange.dto';
import { RosterExchangeService } from './roster-exchange.service';
import type { UploadedRosterFile } from './roster.types';
import { xlsxResponse } from './roster-response';

const upload = FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } });

@Controller('management/rosters')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class ManagementRosterController {
  constructor(private readonly service: RosterExchangeService) {}

  @Get('customers/template')
  @RequirePermissions('GLOBAL_ROSTER_MANAGE')
  async customerTemplate(@Res({ passthrough: true }) response: Response) {
    return xlsxResponse(
      response,
      await this.service.template('customers', 'GLOBAL'),
      '顾客导入模板.xlsx',
    );
  }

  @Get('teachers/template')
  @RequirePermissions('GLOBAL_ROSTER_MANAGE')
  async teacherTemplate(@Res({ passthrough: true }) response: Response) {
    return xlsxResponse(
      response,
      await this.service.template('teachers', 'GLOBAL'),
      '教师导入模板.xlsx',
    );
  }

  @Post('customers/preview')
  @HttpCode(200)
  @RequirePermissions('GLOBAL_ROSTER_MANAGE')
  @UseInterceptors(upload)
  previewCustomers(@UploadedFile() file?: UploadedRosterFile) {
    return this.service.preview('customers', 'GLOBAL', undefined, file);
  }

  @Post('teachers/preview')
  @HttpCode(200)
  @RequirePermissions('GLOBAL_ROSTER_MANAGE')
  @UseInterceptors(upload)
  previewTeachers(@UploadedFile() file?: UploadedRosterFile) {
    return this.service.preview('teachers', 'GLOBAL', undefined, file);
  }

  @Post('customers/import')
  @HttpCode(200)
  @RequirePermissions('GLOBAL_ROSTER_MANAGE')
  @UseInterceptors(upload)
  importCustomers(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file?: UploadedRosterFile,
  ) {
    return this.service.import(actor, 'customers', 'GLOBAL', undefined, file);
  }

  @Post('teachers/import')
  @HttpCode(200)
  @RequirePermissions('GLOBAL_ROSTER_MANAGE')
  @UseInterceptors(upload)
  importTeachers(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file?: UploadedRosterFile,
  ) {
    return this.service.import(actor, 'teachers', 'GLOBAL', undefined, file);
  }

  @Post('customers/entries')
  @HttpCode(200)
  @RequirePermissions('GLOBAL_ROSTER_MANAGE')
  quickCustomer(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() input: ManagementCustomerRosterEntryDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.quickCustomer(actor, input.campusId, input, key);
  }

  @Post('teachers/entries')
  @HttpCode(200)
  @RequirePermissions('GLOBAL_ROSTER_MANAGE')
  quickTeacher(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() input: ManagementTeacherRosterEntryDto,
    @IdempotencyKey() key: string,
  ) {
    return this.service.quickTeacher(actor, input.campusId, input, key);
  }

  @Get('customers/export')
  @RequirePermissions('GLOBAL_ROSTER_EXPORT')
  async exportCustomers(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ManagementRosterExportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return xlsxResponse(
      response,
      await this.service.export(
        actor,
        'customers',
        'GLOBAL',
        query.campusId,
        query.query,
        query.confirmed,
      ),
      '顾客名册.xlsx',
    );
  }

  @Get('teachers/export')
  @RequirePermissions('GLOBAL_ROSTER_EXPORT')
  async exportTeachers(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ManagementRosterExportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return xlsxResponse(
      response,
      await this.service.export(
        actor,
        'teachers',
        'GLOBAL',
        query.campusId,
        query.query,
        query.confirmed,
      ),
      '教师名册.xlsx',
    );
  }

  @Get('teachers')
  @RequirePermissions('GLOBAL_ROSTER_MANAGE')
  listTeachers(@Query() query: ManagementRosterListQueryDto) {
    return this.service.listTeachers(query.campusId, query.query, query.page, query.pageSize);
  }
}
