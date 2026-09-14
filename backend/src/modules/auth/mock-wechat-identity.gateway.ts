import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { WechatIdentityGateway } from './wechat-identity.gateway';

const LOGIN_PREFIX = 'mock-wechat-login:';
const PHONE_PREFIX = 'mock-wechat-phone:';

@Injectable()
export class MockWechatIdentityGateway implements WechatIdentityGateway {
  async exchangeLoginCode(code: string): Promise<{ openId: string }> {
    return { openId: this.readValue(code, LOGIN_PREFIX) };
  }

  async exchangePhoneCode(phoneCode: string): Promise<{ phone: string }> {
    return { phone: this.readValue(phoneCode, PHONE_PREFIX) };
  }

  private readValue(code: string, prefix: string): string {
    const value = code.startsWith(prefix) ? code.slice(prefix.length) : '';
    if (!value) {
      throw new DomainError(
        ErrorCode.WECHAT_PROVIDER_RESPONSE_INVALID,
        'The local WeChat test code is invalid',
        400,
      );
    }
    return value;
  }
}
