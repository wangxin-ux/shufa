import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator';
import { AccessTokenGuard } from './access-token.guard';
import { AuthService, AuthSession, MeView } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { StaffBindDto } from './dto/staff-bind.dto';
import { WechatLoginDto, WechatStaffBindPhoneDto } from './dto/wechat-auth.dto';
import { WechatStaffAuthService } from './wechat-staff-auth.service';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly wechatStaffAuthService: WechatStaffAuthService,
  ) {}

  @Post('auth/login')
  @HttpCode(200)
  login(@Body() body: LoginDto): Promise<AuthSession> {
    return this.authService.login(body.code);
  }

  @Post('auth/staff/bind')
  @HttpCode(200)
  bindStaff(
    @Body() body: StaffBindDto,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<AuthSession> {
    return this.authService.bindStaff(
      body.code,
      body.bindToken,
      idempotencyKey,
    );
  }

  @Post('auth/wechat/login')
  @HttpCode(200)
  loginWithWechat(@Body() body: WechatLoginDto): Promise<AuthSession> {
    return this.wechatStaffAuthService.login(body.code);
  }

  @Post('auth/wechat/staff/bind-phone')
  @HttpCode(200)
  bindWechatStaffPhone(
    @Body() body: WechatStaffBindPhoneDto,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<AuthSession> {
    return this.wechatStaffAuthService.bindPhone(body, idempotencyKey);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<MeView> {
    return this.authService.getMe(user.userId);
  }
}
