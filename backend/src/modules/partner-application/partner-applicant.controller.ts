import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { WechatLoginDto } from '../auth/dto/wechat-auth.dto';
import {
  PartnerApplicantGuard,
  type ApplicantRequest,
} from './partner-applicant.guard';
import { PartnerApplicantSessionService } from './partner-applicant-session.service';
import {
  PARTNER_APPLICANT_RATE_LIMIT,
  type ApplicantAdmission,
} from './partner-applicant-rate-limit';

@Controller('partner-applicants')
export class PartnerApplicantController {
  constructor(
    private readonly sessions: PartnerApplicantSessionService,
    @Inject(PARTNER_APPLICANT_RATE_LIMIT)
    private readonly admission: ApplicantAdmission,
  ) {}

  @Post('auth/wechat')
  @HttpCode(200)
  async login(@Body() body: WechatLoginDto, @Req() request: Request) {
    await this.admission.check(
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
    );
    return this.sessions.login(body.code);
  }

  @Get('me')
  @UseGuards(PartnerApplicantGuard)
  me(@Req() request: ApplicantRequest) {
    return this.sessions.me(request.applicant.applicantId);
  }

  @Post('auth/logout')
  @HttpCode(200)
  @UseGuards(PartnerApplicantGuard)
  logout(@Req() request: ApplicantRequest) {
    return this.sessions.logout(request.applicant.sessionId);
  }
}
