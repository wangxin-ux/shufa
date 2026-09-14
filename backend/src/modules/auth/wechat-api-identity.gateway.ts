import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { WechatIdentityGateway } from './wechat-identity.gateway';

@Injectable()
export class WechatApiIdentityGateway implements WechatIdentityGateway {
  constructor(private readonly configService: ConfigService) {}

  async exchangeLoginCode(code: string): Promise<{ openId: string }> {
    const appId = this.configService.getOrThrow<string>('WECHAT_APP_ID');
    const secret = this.configService.getOrThrow<string>('WECHAT_APP_SECRET');
    const url =
      'https://api.weixin.qq.com/sns/jscode2session' +
      `?appid=${encodeURIComponent(appId)}` +
      `&secret=${encodeURIComponent(secret)}` +
      `&js_code=${encodeURIComponent(code)}` +
      '&grant_type=authorization_code';
    const payload = await this.requestJson(url, { method: 'GET' });
    const openId = this.stringField(payload, 'openid');
    if (!openId) this.invalidProviderResponse();
    return { openId };
  }

  async exchangePhoneCode(phoneCode: string): Promise<{ phone: string }> {
    const accessToken = await this.getAccessToken();
    const payload = await this.requestJson(
      `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: phoneCode }),
      },
    );
    const phoneInfo = this.objectField(payload, 'phone_info');
    const phone =
      this.stringField(phoneInfo, 'purePhoneNumber') ??
      this.stringField(phoneInfo, 'phoneNumber');
    if (!phone) this.invalidProviderResponse();
    return { phone };
  }

  private async getAccessToken(): Promise<string> {
    const payload = await this.requestJson(
      'https://api.weixin.qq.com/cgi-bin/stable_token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credential',
          appid: this.configService.getOrThrow<string>('WECHAT_APP_ID'),
          secret: this.configService.getOrThrow<string>('WECHAT_APP_SECRET'),
          force_refresh: false,
        }),
      },
    );
    const accessToken = this.stringField(payload, 'access_token');
    if (!accessToken) this.invalidProviderResponse();
    return accessToken;
  }

  private async requestJson(
    url: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(url, init);
      const payload = (await response.json()) as unknown;
      if (!response.ok || !this.isObject(payload)) this.invalidProviderResponse();
      if (typeof payload.errcode === 'number' && payload.errcode !== 0) {
        this.invalidProviderResponse();
      }
      return payload;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      this.invalidProviderResponse();
    }
  }

  private stringField(
    value: Record<string, unknown> | null,
    key: string,
  ): string | null {
    const field = value?.[key];
    return typeof field === 'string' && field.length > 0 ? field : null;
  }

  private objectField(
    value: Record<string, unknown>,
    key: string,
  ): Record<string, unknown> | null {
    const field = value[key];
    return this.isObject(field) ? field : null;
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private invalidProviderResponse(): never {
    throw new DomainError(
      ErrorCode.WECHAT_PROVIDER_RESPONSE_INVALID,
      'WeChat identity verification failed',
      502,
    );
  }
}
