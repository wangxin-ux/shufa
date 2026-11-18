import {
  isPartnerFreeNativeRequestAllowed as allowed,
  type PartnerFreeNativeScope,
} from './support/partner-free-native-policy';

const scope: PartnerFreeNativeScope = {
  partnerId: 'owned-partner',
  loginCode: 'unique-run-partner',
  draftId: 'owned-draft',
  draftVersion: 2,
};
const base = `/partners/me/campaign-drafts/${scope.draftId}`;

describe('partner free native fixture admission', () => {
  it('allows the exact synthetic login and refuses all other identity inputs', () => {
    expect(
      allowed(scope, {
        method: 'POST',
        path: '/auth/login',
        body: { code: scope.loginCode },
      }),
    ).toBe(true);
    for (const body of [
      { code: 'other' },
      { code: scope.loginCode, campusId: 'other' },
      {},
    ]) {
      expect(
        allowed(scope, { method: 'POST', path: '/auth/login', body }),
      ).toBe(false);
    }
  });
  it.each(['', '/free-registration', '/versions', '/registrations'])(
    'allows only owned partner reads for %s',
    (suffix) => {
      const request = {
        method: 'GET',
        path: base + suffix,
        actorId: scope.partnerId,
      };
      expect(allowed(scope, request)).toBe(true);
      expect(allowed(scope, { ...request, actorId: 'other' })).toBe(false);
      expect(
        allowed(scope, {
          ...request,
          path: `/partners/me/campaign-drafts/other${suffix}`,
        }),
      ).toBe(false);
    },
  );
  it('allows only the fixed draft version to submit', () => {
    const request = {
      method: 'POST',
      path: base + '/submit',
      actorId: scope.partnerId,
      body: { expectedVersion: 2 },
    };
    expect(allowed(scope, request)).toBe(true);
    for (const body of [
      { expectedVersion: 1 },
      { expectedVersion: 3 },
      { expectedVersion: '2' },
      { expectedVersion: 2, campusId: 'other' },
      {},
    ])
      expect(allowed(scope, { ...request, body })).toBe(false);
    expect(allowed(scope, { ...request, actorId: 'other' })).toBe(false);
    expect(
      allowed(scope, {
        ...request,
        path: '/partners/me/campaign-drafts/other/submit',
      }),
    ).toBe(false);
  });
  it.each([
    ['POST', '/partners/me/campaign-drafts'],
    ['PUT', base + '/basic-information'],
    ['PUT', base + '/free-registration'],
    ['DELETE', base],
    ['POST', '/management/campaign-reviews/owned/approve'],
    ['GET', '/parents/me/campaign-registrations'],
    ['GET', base + '/unknown'],
  ])('refuses unrelated %s %s', (method, path) => {
    expect(
      allowed(scope, {
        method,
        path,
        actorId: scope.partnerId,
        body: { expectedVersion: 2 },
      }),
    ).toBe(false);
  });

  describe('explicit owned configuration profile', () => {
    const configurationScope = {
      ...scope,
      configuration: {
        basics: {
          expectedVersion: 2,
          basicInformation: {
            title: '合成配置保存',
            campaignType: 'FREE_REGISTRATION',
            shareDescription: '合成资料，仅保存登记。',
            contactPhone: '0000',
          },
        },
        settings: {
          expectedVersion: 3,
          freeRegistration: {
            startsAt: '2026-10-14T01:00:00.000Z',
            endsAt: '2026-10-14T03:00:00.000Z',
            capacityMode: 'LIMITED',
            maxRegistrations: 35,
          },
        },
      },
    };
    it.each([
      ['/basic-information', configurationScope.configuration.basics],
      ['/free-registration', configurationScope.configuration.settings],
    ])('admits only the predeclared owned PUT %s', (suffix, body) => {
      const request = {
        method: 'PUT',
        path: base + suffix,
        actorId: scope.partnerId,
        body,
      };
      expect(allowed(configurationScope, request)).toBe(true);
      expect(allowed(scope, request)).toBe(false);
      expect(
        allowed(configurationScope, { ...request, actorId: 'other' }),
      ).toBe(false);
      expect(
        allowed(configurationScope, {
          ...request,
          path: `/partners/me/campaign-drafts/other${suffix}`,
        }),
      ).toBe(false);
      for (const changed of [
        { ...body, expectedVersion: body.expectedVersion - 1 },
        { ...body, expectedVersion: body.expectedVersion + 1 },
        { ...body, expectedVersion: String(body.expectedVersion) },
        { ...body, campusId: 'other' },
        { ...body, expectedVersion: undefined },
        {},
      ])
        expect(allowed(configurationScope, { ...request, body: changed })).toBe(
          false,
        );
    });
    it('rejects changed nested fields, missing fields and alternate value types', () => {
      const config = configurationScope.configuration;
      for (const [suffix, body, key, value] of [
        [
          '/basic-information',
          config.basics,
          'basicInformation',
          config.basics.basicInformation,
        ],
        [
          '/free-registration',
          config.settings,
          'freeRegistration',
          config.settings.freeRegistration,
        ],
      ] as const) {
        for (const changed of [
          { ...value, campusId: 'other' },
          { ...value, title: 'different' },
          {},
          null,
          [],
        ])
          expect(
            allowed(configurationScope, {
              method: 'PUT',
              path: base + suffix,
              actorId: scope.partnerId,
              body: { ...body, [key]: changed },
            }),
          ).toBe(false);
      }
    });
    it('does not inherit submission permission', () => {
      expect(
        allowed(configurationScope, {
          method: 'POST',
          path: base + '/submit',
          actorId: scope.partnerId,
          body: { expectedVersion: scope.draftVersion },
        }),
      ).toBe(false);
    });
  });
});
