export const WECHAT_IDENTITY_GATEWAY = Symbol('WECHAT_IDENTITY_GATEWAY');

export interface WechatIdentityGateway {
  exchangeLoginCode(code: string): Promise<{ openId: string }>;
  exchangePhoneCode(phoneCode: string): Promise<{ phone: string }>;
}
