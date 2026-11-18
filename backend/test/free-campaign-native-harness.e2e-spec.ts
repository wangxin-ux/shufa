import {
  assertFreeCampaignNativeTarget,
  isNativeCampaignRequestAllowed,
  type NativeCampaignScope,
} from './support/free-campaign-native-policy';
import { EventEmitter } from 'node:events';
import { NativeCampaignActivity } from './support/free-campaign-native-activity';

const campaignId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000002';
const studentId = '00000000-0000-4000-8000-000000000003';
const registrationId = '00000000-0000-4000-8000-000000000004';
const foreignId = '00000000-0000-4000-8000-000000000005';
const parentId = '00000000-0000-4000-8000-000000000006';
const scope: NativeCampaignScope = {
  parentId,
  loginCode: 'synthetic-native-run-parent',
  studentId,
  campaigns: new Map([[campaignId, versionId]]),
  registrations: new Set([registrationId]),
};
const env = {
  NODE_ENV: 'test',
  AUTH_DRIVER: 'mock',
  PAYMENT_DRIVER: 'mock',
  MESSAGE_DRIVER: 'mock',
  DATABASE_URL:
    'postgresql://fixture:synthetic@127.0.0.1:5433/education_app_test_partner_pdf_20261012contact_test',
  PARTNER_PDF_TEST_DB_NAME:
    'education_app_test_partner_pdf_20261012contact_test',
};

describe('free campaign native API fixture safety', () => {
  it('accepts only the approved existing dedicated local database', () => {
    expect(assertFreeCampaignNativeTarget(env).pathname).toBe(
      '/education_app_test_partner_pdf_20261012contact_test',
    );
  });
  it.each([
    { NODE_ENV: 'production' },
    { AUTH_DRIVER: 'wechat' },
    { PAYMENT_DRIVER: 'wechat' },
    { MESSAGE_DRIVER: 'wechat' },
    {
      DATABASE_URL:
        'postgresql://fixture:synthetic@127.0.0.1:5432/education_app_test_partner_pdf_20261012contact_test',
    },
    {
      DATABASE_URL:
        'postgresql://fixture:synthetic@127.0.0.1:5433/education_app',
    },
    {
      DATABASE_URL:
        'postgresql://fixture:synthetic@remote.example.test:5433/education_app_test_partner_pdf_20261012contact_test',
    },
    {
      DATABASE_URL:
        'postgresql://fixture:synthetic@127.0.0.1:5433/education_app_test_partner_pdf_unknown_test',
      PARTNER_PDF_TEST_DB_NAME: 'education_app_test_partner_pdf_unknown_test',
    },
  ])('rejects unsafe or unapproved targets %j', (patch) => {
    expect(() =>
      assertFreeCampaignNativeTarget({ ...env, ...patch }),
    ).toThrow();
  });
  it('permits only its new parent Mock identity to use the existing login route', () => {
    expect(
      isNativeCampaignRequestAllowed(scope, {
        method: 'POST',
        path: '/auth/login',
        body: { code: scope.loginCode },
      }),
    ).toBe(true);
    expect(
      isNativeCampaignRequestAllowed(scope, {
        method: 'POST',
        path: '/auth/login',
        body: { code: 'other-existing-identity' },
      }),
    ).toBe(false);
  });
  it.each(['/parents/me/free-campaigns', '/parents/me/campaign-registrations'])(
    'allows own parent pagination for %s and rejects another actor',
    (path) => {
      expect(
        isNativeCampaignRequestAllowed(scope, {
          method: 'GET',
          path,
          actorId: parentId,
        }),
      ).toBe(true);
      expect(
        isNativeCampaignRequestAllowed(scope, {
          method: 'GET',
          path,
          actorId: foreignId,
        }),
      ).toBe(false);
    },
  );
  it('allows only the owned campaign, approved version and student for registration', () => {
    const request = {
      method: 'POST',
      path: `/parents/me/free-campaigns/${campaignId}/registrations`,
      actorId: parentId,
      body: { versionId, studentId },
    };
    expect(isNativeCampaignRequestAllowed(scope, request)).toBe(true);
    expect(
      isNativeCampaignRequestAllowed(scope, {
        ...request,
        body: { versionId, studentId: foreignId },
      }),
    ).toBe(false);
    expect(
      isNativeCampaignRequestAllowed(scope, {
        ...request,
        body: { versionId: foreignId, studentId },
      }),
    ).toBe(false);
    expect(
      isNativeCampaignRequestAllowed(scope, {
        ...request,
        path: `/parents/me/free-campaigns/${foreignId}/registrations`,
      }),
    ).toBe(false);
  });
  it('allows only its own current registration detail and cancellation paths', () => {
    for (const [method, suffix] of [
      ['GET', ''],
      ['POST', '/cancel'],
    ]) {
      expect(
        isNativeCampaignRequestAllowed(scope, {
          method,
          path: `/parents/me/campaign-registrations/${registrationId}${suffix}`,
          actorId: parentId,
          ...(method === 'POST' ? { body: { expectedVersion: 1 } } : {}),
        }),
      ).toBe(true);
      expect(
        isNativeCampaignRequestAllowed(scope, {
          method,
          path: `/parents/me/campaign-registrations/${foreignId}${suffix}`,
          actorId: parentId,
          ...(method === 'POST' ? { body: { expectedVersion: 1 } } : {}),
        }),
      ).toBe(false);
    }
  });
  it.each([
    ['GET', `/parents/me/free-campaigns/${campaignId}`],
    ['GET', `/parents/me/free-campaigns/${foreignId}`],
    ['POST', '/parents/me/free-campaigns'],
    ['DELETE', `/parents/me/campaign-registrations/${registrationId}`],
    ['POST', `/management/campaign-reviews/${versionId}/approve`],
    ['POST', '/partners/me/campaign-drafts'],
    ['GET', '/parents/me/hours'],
  ])(
    'restricts native %s %s to the approved fixture routes',
    (method, path) => {
      expect(
        isNativeCampaignRequestAllowed(scope, {
          method,
          path,
          actorId: parentId,
        }),
      ).toBe(
        method === 'GET' && path === `/parents/me/free-campaigns/${campaignId}`,
      );
    },
  );
});

describe('native fixture response and handler drainage', () => {
  it('does not accept the closed-response gap between Guard and handler as idle', async () => {
    const activity = new NativeCampaignActivity();
    const response = new EventEmitter();
    activity.observeResponse(response);
    const guard = activity.during(async () => {});
    response.emit('close');
    let completed = false;
    const handler = guard.then(async () => {
      await Promise.resolve();
      await activity.during(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        completed = true;
      });
    });
    await activity.idle(1000);
    expect(completed).toBe(true);
    await handler;
    expect(activity.size).toBe(0);
  });
  it('releases an interrupted response once even if finish subsequently fires', () => {
    const activity = new NativeCampaignActivity();
    const response = new EventEmitter();
    activity.observeResponse(response);
    expect(activity.size).toBe(1);
    response.emit('close');
    expect(activity.size).toBe(0);
    response.emit('finish');
    expect(activity.size).toBe(0);
  });
  it('keeps a backend operation active after its client response closes', async () => {
    const activity = new NativeCampaignActivity();
    const response = new EventEmitter();
    let release!: () => void;
    activity.observeResponse(response);
    const handler = activity.during(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    expect(activity.size).toBe(2);
    response.emit('close');
    expect(activity.size).toBe(1);
    release();
    await handler;
    expect(activity.size).toBe(0);
  });
  it('releases rejected gate work without losing another handler', async () => {
    const activity = new NativeCampaignActivity();
    const other = activity.begin();
    await expect(
      activity.during(() => Promise.reject(new Error('gate failed'))),
    ).rejects.toThrow('gate failed');
    expect(activity.size).toBe(1);
    other();
    expect(activity.size).toBe(0);
  });
  it('a repeated lease release cannot consume another operation', () => {
    const activity = new NativeCampaignActivity();
    const first = activity.begin();
    const second = activity.begin();
    first();
    first();
    expect(activity.size).toBe(1);
    second();
    expect(activity.size).toBe(0);
  });
});
