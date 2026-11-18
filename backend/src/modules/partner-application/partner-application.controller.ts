import {
  Body,
  Controller,
  Get,
  Header,
  Put,
  Post,
  HttpCode,
  Req,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  PartnerApplicantGuard,
  type ApplicantRequest,
} from './partner-applicant.guard';
import { PartnerApplicationService } from './partner-application.service';
import { SavePartnerApplicationBasicDto } from './dto/partner-application-basic.dto';
import { SavePartnerApplicationBankDto } from './dto/partner-application-bank.dto';
import { PartnerApplicationBankService } from './partner-application-bank.service';
import { PartnerApplicationSubmissionService } from './partner-application-submission.service';
import { SubmitPartnerApplicationDto } from './dto/partner-application-submit.dto';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { PartnerApplicationReviewService } from './partner-application-review.service';
import {
  PartnerApplicationHistoryQueryDto,
  ReopenPartnerApplicationDto,
} from './dto/partner-application-review.dto';

@Controller('partner-applicants/me/application')
@UseGuards(PartnerApplicantGuard)
export class PartnerApplicationController {
  constructor(
    private readonly applications: PartnerApplicationService,
    private readonly banks: PartnerApplicationBankService,
    private readonly submissions: PartnerApplicationSubmissionService,
    private readonly reviews: PartnerApplicationReviewService,
  ) {}

  @Get('history')
  @Header('Cache-Control', 'no-store')
  history(
    @Req() request: ApplicantRequest,
    @Query() query: PartnerApplicationHistoryQueryDto,
  ) {
    return this.reviews.history(request.applicant, query);
  }

  @Post('reopen')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  reopen(
    @Req() request: ApplicantRequest,
    @Body() body: ReopenPartnerApplicationDto,
    @IdempotencyKey() key: string,
  ) {
    return this.reviews.reopen(request.applicant, body, key);
  }

  @Post('submit')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  submit(
    @Req() request: ApplicantRequest,
    @Body() body: SubmitPartnerApplicationDto,
    @IdempotencyKey() key: string,
  ) {
    return this.submissions.submit(request.applicant, body, key);
  }

  @Get('bank-information')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  bank(@Req() request: ApplicantRequest) {
    return this.banks.getOwn(request.applicant);
  }

  @Put('bank-information')
  @Header('Cache-Control', 'no-store')
  saveBank(
    @Req() request: ApplicantRequest,
    @Body() body: SavePartnerApplicationBankDto,
  ) {
    return this.banks.saveOwn(request.applicant, body);
  }

  @Get()
  get(@Req() request: ApplicantRequest) {
    return this.applications.getOwn(request.applicant);
  }

  @Put('basic-information')
  save(
    @Req() request: ApplicantRequest,
    @Body() body: SavePartnerApplicationBasicDto,
  ) {
    return this.applications.saveBasics(request.applicant, body);
  }
}
