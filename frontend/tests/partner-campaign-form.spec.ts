import { PartnerCampaignDraftService } from '../pages/partner/runtime/partner-campaign-draft.service';
import type { SessionHttpRequestOptions } from '../services/session.service';

const id = '00000000-0000-4000-8000-000000000001';
const question = (changes = {}) => ({
  id: 'q1', kind: 'TEXT', label: '姓名', hint: '', required: true, options: [], ...changes,
});
const receipt = { draftId: id, status: 'DRAFT', version: 2,
  createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z' };

describe('private registration form transport and mock persistence', () => {
  let owner: string;
  let options: SessionHttpRequestOptions;
  let service: any;
  beforeEach(() => {
    owner = 'synthetic-owner';
    options = undefined as unknown as SessionHttpRequestOptions;
    service = new PartnerCampaignDraftService({
      dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3001',
      accessToken: () => owner, request: value => { options = value; },
    });
  });
  it('saves only the normalized template partition with its expected version', async () => {
    const pending = service.saveRegistrationForm(id, 1, [question({ label: ' 姓名 ', hint: ' 备注 ' })]);
    expect(options).toMatchObject({
      method: 'PUT', url: `http://127.0.0.1:3001/partners/me/campaign-drafts/${id}/registration-form`,
      data: { expectedVersion: 1, registrationForm: [question({ hint: '备注' })] },
    });
    options.success({ statusCode: 200, data: { data: receipt } });
    expect(await pending).toEqual(receipt);
  });
  it.each([
    null, {}, Array.from({ length: 21 }, (_, i) => question({ id: `q${i}` })),
    [question({ kind: 'ID_CARD' })], [question({ label: '' })], [question({ label: '\u0000' })],
    [question({ label: '\ud800' })], [question({ required: 'true' })],
    [question(), question()], [question({ options: ['不能带选项'] })],
    [question({ kind: 'SINGLE_CHOICE', options: ['重复', ' 重复 '] })],
    [question({ kind: 'MULTI_CHOICE', options: ['仅一个'] })],
    [question({ answer: '不可传答案' })],
  ])('rejects malformed or sensitive templates before transport (%#)', async value => {
    await expect(service.saveRegistrationForm(id, 1, value)).rejects.toMatchObject({ statusCode: 400 });
    expect(options).toBeUndefined();
  });
  it('preserves questions across basics and content saves and isolates returned arrays', async () => {
    const mock: any = new PartnerCampaignDraftService({ dataDriver: 'mock', accessToken: () => owner });
    const first = await mock.create({}, 'synthetic-form-key');
    const questions = [question(), question({ id: 'q2', kind: 'MOBILE', label: '电话' })];
    const saved = await mock.saveRegistrationForm(first.draftId, 1, questions);
    expect(await mock.saveRegistrationForm(first.draftId, 1, questions)).toEqual(saved);
    await expect(mock.saveRegistrationForm(first.draftId, 1, [])).rejects.toMatchObject({ statusCode: 409 });
    questions[0].label = '不能改已保存的值';
    await mock.save(first.draftId, 2, { title: '只改名称' });
    await mock.saveContent(first.draftId, 3, '只改正文');
    const read = await mock.get(first.draftId);
    expect(read).toMatchObject({ version: 4, registrationForm: [question(), expect.objectContaining({ label: '电话' })] });
    read.registrationForm[0].label = '不能经读回值改库';
    expect((await mock.get(first.draftId)).registrationForm[0].label).toBe('姓名');
    expect((await mock.list(1)).data[0]).not.toHaveProperty('registrationForm');
    owner = 'other-owner';
    await expect(mock.get(first.draftId)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('parses questions in detail and rejects noncanonical or excessive response properties', async () => {
    const detail = { ...receipt, basicInformation: {
      title: null, campaignType: null, shareDescription: null, contactPhone: null,
    }, activityContent: null, registrationForm: [question()] };
    const pending = service.get(id);
    options.success({ statusCode: 200, data: { data: detail } });
    expect((await pending).registrationForm).toEqual([question()]);
    const invalid = service.get(id);
    options.success({ statusCode: 200, data: { data: { ...detail, registrationForm: [question({ label: ' 姓名' })] } } });
    await expect(invalid).rejects.toMatchObject({ statusCode: 502 });
  });
});
