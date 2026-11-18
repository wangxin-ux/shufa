import { createPartnerRuntimeEnv } from '../config/partner-env';
import { readLocalRuntimeOverrides } from '../config/local-runtime';
import { MockPartnerDataSource } from '../data/mock-partner-data-source';
import { PARTNER_DASHBOARD_FIXTURE } from '../mock/fixtures/partner.fixture';
import { PARENT_DISPLAY_FONT_CHARACTERS } from '../assets/fonts/parent-display-font';

describe('opt-in partner PDF visual sample', () => {
  it('uses the current licensed font with the partner reference display characters', () => {
    for (const character of '凯曼中南海校区朱元璋专业美术授课教师重新登录') {
      expect(PARENT_DISPLAY_FONT_CHARACTERS).toContain(character);
    }
  });

  it('accepts only the local partner scenario without changing parent or API settings', () => {
    const local = readLocalRuntimeOverrides(() => ({
      dataDriver: 'api',
      parentMockScenario: 'profile-setup',
      partnerMockScenario: 'visual',
      accessToken: 'synthetic-test-token',
    }));
    expect(local).toMatchObject({
      parentMockScenario: 'profile-setup', partnerMockScenario: 'visual',
    });
    expect(createPartnerRuntimeEnv({}, local)).toMatchObject({
      dataDriver: 'api', mockScenario: 'visual', accessToken: 'synthetic-test-token',
    });
    expect(createPartnerRuntimeEnv({ mockScenario: 'empty' }, local).mockScenario).toBe('empty');
    expect(readLocalRuntimeOverrides(() => ({ partnerMockScenario: 'unknown' }))).toEqual({});
  });

  it('provides a detached reference-length sample and leaves normal mock unchanged', async () => {
    const visual = new MockPartnerDataSource({ scenario: 'visual' });
    const sample = await visual.getDashboard();
    expect(sample.campus.name).toBe('凯曼中南海校区');
    expect(sample.highlight?.studentName).toBe('朱元璋');
    expect(sample.highlight?.totalBalanceUnits).toBe(100);
    expect(sample.activeTeacherCount).toBe(18);
    sample.campus.name = '不得污染其他请求';
    expect((await visual.getDashboard()).campus.name).toBe('凯曼中南海校区');
    expect(await new MockPartnerDataSource().getDashboard()).toEqual(PARTNER_DASHBOARD_FIXTURE);
  });
});
