import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { CampusManagerScopeService } from '../../common/auth/campus-manager-scope.service';
import { TeacherScopeService } from '../../common/auth/teacher-scope.service';
import { ParentScopeService } from '../../common/auth/parent-scope.service';
import { PartnerScopeService } from '../../common/auth/partner-scope.service';
import { AccessTokenGuard } from './access-token.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MockWechatIdentityGateway } from './mock-wechat-identity.gateway';
import { StaffBindTokenService } from './staff-bind-token.service';
import { WechatApiIdentityGateway } from './wechat-api-identity.gateway';
import { WECHAT_IDENTITY_GATEWAY } from './wechat-identity.gateway';
import { WechatStaffAuthService } from './wechat-staff-auth.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AccessTokenGuard,
    AuthService,
    WechatStaffAuthService,
    PermissionsGuard,
    StaffBindTokenService,
    MockWechatIdentityGateway,
    WechatApiIdentityGateway,
    {
      provide: WECHAT_IDENTITY_GATEWAY,
      inject: [
        ConfigService,
        MockWechatIdentityGateway,
        WechatApiIdentityGateway,
      ],
      useFactory: (
        configService: ConfigService,
        mockGateway: MockWechatIdentityGateway,
        apiGateway: WechatApiIdentityGateway,
      ) =>
        configService.getOrThrow<string>('AUTH_DRIVER') === 'mock'
          ? mockGateway
          : apiGateway,
    },
    TeacherScopeService,
    ParentScopeService,
    PartnerScopeService,
    CampusManagerScopeService,
  ],
  exports: [
    AccessTokenGuard,
    JwtModule,
    PermissionsGuard,
    StaffBindTokenService,
    TeacherScopeService,
    ParentScopeService,
    PartnerScopeService,
    CampusManagerScopeService,
  ],
})
export class AuthModule {}
