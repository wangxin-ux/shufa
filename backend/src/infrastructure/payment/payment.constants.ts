export const PAYMENT_ADAPTER = Symbol('PAYMENT_ADAPTER');

export const PAYMENT_MODES = ['MOCK', 'WECHAT'] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number];
