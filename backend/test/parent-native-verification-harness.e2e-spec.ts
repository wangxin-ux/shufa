import {
  buildNativeCatalogFixture,
  validateNativeVerificationDatabase,
} from './support/parent-native-verification';

describe('native PDF verification isolation guard', () => {
  it('builds a marked public test campus and an independent single-role administrator', () => {
    const fixture = buildNativeCatalogFixture('owned-run');
    expect(fixture.campus).toMatchObject({
      code: 'NATIVE-owned-run',
      mapVisible: true,
      address: '测试路1号',
    });
    expect(fixture.admin.roles.create).toEqual({ roleCode: 'SUPER_ADMIN' });
    expect(fixture.admin.authIdentities.create).toEqual({
      provider: 'MOCK',
      subject: 'mock-demo-super-admin',
    });
  });
  it('allows only a dedicated loopback native test database', () => {
    expect(
      validateNativeVerificationDatabase(
        'postgresql://app:fixture@localhost:5433/education_app_test_parent_native_test',
      ).pathname,
    ).toBe('/education_app_test_parent_native_test');
  });
  it.each([
    'postgresql://app:fixture@localhost:5432/education_app',
    'postgresql://app:fixture@localhost:5433/education_app_test',
    'postgresql://app:fixture@database.example.test:5433/education_app_test_parent_native_test',
    'https://localhost/education_app_test_parent_native_test',
  ])('rejects unsafe verification target %s', (target) => {
    expect(() => validateNativeVerificationDatabase(target)).toThrow();
  });
});
