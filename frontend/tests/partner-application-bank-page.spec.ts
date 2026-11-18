import * as fs from 'fs';
import * as path from 'path';

const getRuntime = jest.fn();
jest.mock('../pages/partner/runtime/partner-application-runtime', () => ({
  getPartnerApplicationRuntime: () => getRuntime(),
}));
const bank = {
  bankName: '合成测试开户行', accountHolder: '合成测试机构', accountNumber: '00000000000000000001',
};
const applicationId = '55883f08-c9f5-4f26-927c-82ea07cb8a02';
const recordId = 'a4b42383-8bd1-4f06-bf3c-a4e9c7426162';
const basics = (version = 1) => ({
  applicationId, version, status: 'DRAFT',
  basicInformation: { institutionName: '合成机构', province: null, city: null, district: null, detailedAddress: null, contactPhone: null },
  createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z',
});
const bankView = (version = 1, bankInformation: object | null = bank) => ({
  applicationId, status: 'DRAFT', version, bankInformation, readonly: false,
});
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const failure = (statusCode: number) => Object.assign(new Error('合成银行请求失败'), { statusCode });

describe('own encrypted bank partition in the existing application page', () => {
  let page: any;
  let runtime: any;
  let sessionKey: string;
  const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
  const ready = async () => { page.onLoad(); page.onShow(); await flush(); };
  const open = async () => { page.onBankToggle?.(); await flush(); };
  const input = (field: string, value: string) =>
    page.onBankFieldInput?.({ currentTarget: { dataset: { field } }, detail: { value } });
  beforeEach(() => {
    sessionKey = '1:applicant-token';
    runtime = {
      formalArchive: false,
      sessions: {
        getSessionKey: jest.fn(() => sessionKey), invalidateReads: jest.fn(),
        loadMe: jest.fn().mockResolvedValue({ displayName: '申请人', formalAccountReady: false }),
        logout: jest.fn().mockImplementation(() => { sessionKey = ''; return Promise.resolve(); }),
      },
      applications: { load: jest.fn().mockResolvedValue(basics()), saveBasics: jest.fn() },
      banks: {
        load: jest.fn().mockResolvedValue(bankView()),
        save: jest.fn().mockResolvedValue({ applicationId, version: 2, bankRecordId: recordId }),
      },
    };
    getRuntime.mockReset().mockReturnValue(runtime);
    (global as any).wx = {
      getWindowInfo: () => ({ statusBarHeight: 24, windowWidth: 390 }),
      getMenuButtonBoundingClientRect: () => ({ top: 32, height: 32 }),
      showModal: jest.fn(), navigateBack: jest.fn(), reLaunch: jest.fn(),
      enableAlertBeforeUnload: jest.fn(), disableAlertBeforeUnload: jest.fn(),
      stopPullDownRefresh: jest.fn(),
    };
    (global as any).getCurrentPages = () => [page];
    (global as any).Page = (config: any) => {
      page = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
      page.setData = jest.fn((values: object) => Object.assign(page.data, values));
    };
    jest.isolateModules(() => require('../pages/partner/application/index'));
  });
  afterEach(() => {
    page?.onUnload();
    delete (global as any).wx;
    delete (global as any).Page;
    delete (global as any).getCurrentPages;
  });
  it('loads bank information only after explicit expansion and deduplicates repeated taps', async () => {
    await ready();
    expect(runtime.banks.load).not.toHaveBeenCalled();
    const reading = deferred();
    runtime.banks.load.mockReturnValueOnce(reading.promise);
    page.onBankToggle?.();
    page.onBankToggle?.();
    await flush();
    expect(runtime.banks.load).toHaveBeenCalledTimes(1);
    reading.resolve(bankView());
    await flush();
    expect(page.data).toMatchObject({ bankOpen: true, bankLoading: false, bankForm: bank, bankDirty: false });
  });
  describe.each([true, false])('bank toggle with bankOpen %s', (opened) => {
    it.each(['replacement', 'expiry'])('clears private content before toggling after %s', async (change) => {
      await ready(); await open();
      input('accountHolder', '旧身份未保存银行资料');
      if (!opened) page.onBankToggle();
      expect(page.data.bankOpen).toBe(opened);
      expect(page.data.bankDirty).toBe(true);
      const changes = page.setData.mock.calls.length;
      sessionKey = change === 'replacement' ? '2:new-applicant' : '';
      page.onBankToggle();
      expect(page.data).toMatchObject({
        bankOpen: false, bankLoaded: false, bankDirty: false, viewState: 'login',
        bankForm: { bankName: '', accountHolder: '', accountNumber: '' },
      });
      expect(page.data.form.institutionName).toBe('');
      const patches = page.setData.mock.calls.slice(changes).map((call: [object]) => call[0]);
      expect(patches).not.toContainEqual({ bankOpen: !opened });
      await flush();
      expect(runtime.banks.load).toHaveBeenCalledTimes(1);
      expect(runtime.banks.save).not.toHaveBeenCalled();
      expect(runtime.sessions.logout).not.toHaveBeenCalled();
    });
  });
  it.each([200, 401, 403])('keeps the new bank read after toggle clears an in-flight old read with status %s', async (status) => {
    await ready(); await open();
    const old = deferred();
    runtime.banks.load.mockReturnValueOnce(old.promise);
    const reading = page.onBankRetry(); await flush();
    sessionKey = '2:new-applicant';
    page.onBankToggle();
    expect(page.data.bankForm.accountNumber).toBe('');
    expect(page.data.viewState).toBe('login');
    page.onShow(); await flush();
    const current = deferred();
    runtime.banks.load.mockReturnValueOnce(current.promise);
    page.onBankToggle(); await flush();
    expect(page.data.bankLoading).toBe(true);
    const changes = page.setData.mock.calls.length;
    if (status === 200) old.resolve(bankView(99));
    else old.reject(failure(status));
    await reading; await flush();
    expect(page.setData).toHaveBeenCalledTimes(changes);
    expect(page.data).toMatchObject({ viewState: 'ready', bankLoading: true, bankOpen: true });
    current.resolve(bankView(3, { ...bank, accountHolder: '新身份合成机构' }));
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'ready', bankLoading: false, bankVersion: 3, bankForm: { accountHolder: '新身份合成机构' },
    });
    expect(page.ownerKey).toBe('2:new-applicant');
    expect(runtime.banks.load).toHaveBeenCalledTimes(3);
    expect(runtime.sessions.logout).not.toHaveBeenCalled();
  });
  it('preserves leading zeros, saves only bank fields and reloads the basic version without discarding basic edits', async () => {
    await ready();
    page.onFieldInput({ currentTarget: { dataset: { field: 'institutionName' } }, detail: { value: '基础未保存修改' } });
    await open();
    input('accountNumber', '00000000000000000002');
    runtime.applications.load.mockResolvedValueOnce(basics(2));
    runtime.banks.load.mockResolvedValueOnce(bankView(2, { ...bank, accountNumber: '00000000000000000002' }));
    await page.onBankSave?.();
    await flush();
    expect(runtime.banks.save).toHaveBeenCalledWith(1, {
      ...bank, accountNumber: '00000000000000000002',
    });
    expect(page.data).toMatchObject({ bankSaving: false, bankDirty: false, version: 2, dirty: true });
    expect(page.data.form.institutionName).toBe('基础未保存修改');
    expect(page.data.bankForm.accountNumber).toBe('00000000000000000002');
  });
  it('protects an unsaved bank draft when returning and clears both partitions on logout', async () => {
    await ready(); await open();
    input('accountHolder', '银行未保存修改');
    expect(page.data.bankDirty).toBe(true);
    expect((global as any).wx.enableAlertBeforeUnload).toHaveBeenCalled();
    page.onBack();
    expect((global as any).wx.showModal).toHaveBeenCalledWith(expect.objectContaining({ title: '修改尚未保存' }));
    (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: false });
    await page.onApplicantLogout();
    (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true });
    await flush();
    expect(page.data.bankForm).toEqual({ bankName: '', accountHolder: '', accountNumber: '' });
    expect(page.data.bankDirty).toBe(false);
  });
  it('keeps modified bank data on a normal failure and requires a deliberate conflict reload', async () => {
    await ready(); await open();
    input('accountNumber', '00000000000000000002');
    runtime.banks.save.mockRejectedValueOnce(failure(503));
    await page.onBankSave?.();
    expect(page.data.bankForm?.accountNumber).toBe('00000000000000000002');
    expect(page.data.bankDirty).toBe(true);
    runtime.banks.save.mockRejectedValueOnce(failure(409));
    await page.onBankSave?.();
    expect(page.data.bankNeedsRefresh).toBe(true);
    runtime.banks.load.mockResolvedValueOnce(bankView(3));
    await page.onBankConflictReload?.();
    expect(page.data).toMatchObject({ bankVersion: 3, bankDirty: true, bankNeedsRefresh: false });
    expect(page.data.bankForm.accountNumber).toBe('00000000000000000002');
  });
  it('clears bank plaintext and basic content on current authorization failure', async () => {
    await ready(); await open();
    input('accountNumber', '00000000000000000002');
    runtime.banks.save.mockRejectedValueOnce(failure(401));
    await page.onBankSave?.();
    expect(page.data.bankForm).toEqual({ bankName: '', accountHolder: '', accountNumber: '' });
    expect(page.data.form.institutionName).toBe('');
    expect(page.data.viewState).toBe('login');
  });
  it('does not let a hidden old read populate bank fields, and refreshes after returning', async () => {
    await ready();
    const reading = deferred();
    runtime.banks.load.mockReturnValueOnce(reading.promise);
    page.onBankToggle?.(); await flush();
    page.onHide();
    reading.resolve(bankView());
    await flush();
    expect(page.data.bankForm?.accountNumber).toBe('');
    page.onShow(); await flush();
    expect(page.data.bankForm?.accountNumber).toBe(bank.accountNumber);
  });
  it('prevents concurrent basic save and bank save and disables return during bank writing', async () => {
    await ready(); await open();
    input('accountHolder', '未保存开户名称');
    const writing = deferred();
    runtime.banks.save.mockReturnValueOnce(writing.promise);
    const saving = page.onBankSave?.(); await flush();
    await page.onSave();
    page.onBack();
    expect(runtime.banks.save).toHaveBeenCalledTimes(1);
    expect(runtime.applications.saveBasics).not.toHaveBeenCalled();
    expect((global as any).wx.showModal).not.toHaveBeenCalled();
    writing.resolve({ applicationId, version: 2, bankRecordId: recordId });
    await saving; await flush();
  });
  it('never exposes the applicant bank editor in the formal basic archive', async () => {
    runtime.formalArchive = true;
    runtime.banks = undefined;
    await ready(); await open();
    expect(page.data.bankOpen).toBe(false);
    expect(page.data.formalArchive).toBe(true);
  });
  it('renders a text account input and bank controls in the existing single-column page', () => {
    const text = fs.readFileSync(path.resolve(__dirname, '../pages/partner/application/index.wxml'), 'utf8');
    expect(text).toContain('bindtap="onBankToggle"');
    expect(text).toMatch(/id="bank-account-number"[^>]*type="text"/);
    expect(text).toContain('bindtap="onBankSave"');
    expect(text).toContain('bindtap="onBankConflictReload"');
  });
  it.each([true, false])('recovers a hidden bank write whether it settles before show: %s', async (beforeShow) => {
    await ready(); await open();
    page.onFieldInput({ currentTarget: { dataset: { field: 'institutionName' } }, detail: { value: '保留基础修改' } });
    input('accountNumber', '00000000000000000002');
    const writing = deferred();
    runtime.banks.save.mockReturnValueOnce(writing.promise);
    const saving = page.onBankSave(); await flush();
    page.onHide();
    runtime.applications.load.mockResolvedValue(basics(2));
    runtime.banks.load.mockResolvedValue(bankView(2, { ...bank, accountNumber: '00000000000000000002' }));
    if (!beforeShow) page.onShow();
    writing.resolve({ applicationId, version: 2, bankRecordId: recordId });
    await saving; await flush();
    if (beforeShow) { page.onShow(); await flush(); }
    expect(page.data).toMatchObject({ version: 2, bankVersion: 2, bankSaving: false, bankDirty: false, dirty: true });
    expect(page.data.form.institutionName).toBe('保留基础修改');
    expect(page.data.bankForm.accountNumber).toBe('00000000000000000002');
  });
  it('ignores an old bank read after another session is loaded', async () => {
    await ready();
    const reading = deferred();
    runtime.banks.load.mockReturnValueOnce(reading.promise);
    page.onBankToggle(); await flush();
    page.onHide(); sessionKey = '2:new-applicant';
    runtime.applications.load.mockResolvedValue(basics(3));
    runtime.banks.load.mockResolvedValue(bankView(3, null));
    page.onShow(); await flush();
    reading.reject(failure(401)); await flush();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.bankForm.accountNumber).toBe('');
    expect(runtime.sessions.logout).not.toHaveBeenCalled();
  });
  it('clears private fields on bank 403 as well as 401', async () => {
    await ready(); await open();
    runtime.banks.load.mockRejectedValueOnce(failure(403));
    await page.onBankRetry();
    expect(page.data.bankForm).toEqual({ bankName: '', accountHolder: '', accountNumber: '' });
    expect(page.data.form.institutionName).toBe('');
    expect(page.data.viewState).toBe('login');
  });
  it('does not copy the bank read version into a still-edited basic draft', async () => {
    await ready();
    runtime.banks.load.mockResolvedValueOnce(bankView(8));
    await open();
    expect(page.data.bankVersion).toBe(8);
    expect(page.data.version).toBe(1);
  });
  it('clears the old applicant bank draft before loading a different applicant', async () => {
    await ready(); await open();
    input('accountNumber', '00000000000000000002');
    page.onHide(); sessionKey = '2:different-applicant';
    runtime.applications.load.mockResolvedValue(basics(3));
    runtime.banks.load.mockResolvedValue(bankView(3, null));
    page.onShow(); await flush();
    expect(page.data.bankForm).toEqual({ bankName: '', accountHolder: '', accountNumber: '' });
    expect(page.data.bankDirty).toBe(false);
    expect(page.data.bankOpen).toBe(false);
    expect(page.data.viewState).toBe('ready');
  });
  it('clears bank memory when returning in formal archive mode', async () => {
    await ready(); await open();
    input('accountNumber', '00000000000000000002');
    page.onHide(); sessionKey = 'formal:next-account';
    runtime.formalArchive = true; runtime.banks = undefined;
    page.onShow(); await flush();
    expect(page.data.bankForm).toEqual({ bankName: '', accountHolder: '', accountNumber: '' });
    expect(page.data.bankDirty).toBe(false);
    expect(page.data.bankOpen).toBe(false);
    expect(page.data.formalArchive).toBe(true);
  });
  it('does not restore private basics from a late read after the bank read returns 403', async () => {
    await ready(); await open();
    const bankRead = deferred();
    const basicRead = deferred();
    runtime.banks.load.mockReturnValueOnce(bankRead.promise);
    const readingBank = page.onBankRetry(); await flush();
    runtime.applications.load.mockReturnValueOnce(basicRead.promise);
    const readingBasic = page.loadDraft(true); await flush();
    bankRead.reject(failure(403)); await readingBank; await flush();
    expect(page.data.viewState).toBe('login');
    basicRead.resolve(basics(9)); await readingBasic; await flush();
    expect(page.data.form.institutionName).toBe('');
    expect(page.data.bankForm.accountNumber).toBe('');
    expect(page.data.viewState).toBe('login');
  });
  it('recovers a bank reread and preserves dirty values after both return paths fail', async () => {
    await ready(); await open();
    input('accountHolder', '返回失败仍保留');
    const bankRead = deferred();
    runtime.banks.load.mockReturnValueOnce(bankRead.promise);
    const reading = page.onBankRetry(); await flush();
    (global as any).getCurrentPages = () => [{}, page];
    page.onBack();
    (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true });
    (global as any).wx.navigateBack.mock.calls.at(-1)[0].fail();
    (global as any).wx.reLaunch.mock.calls.at(-1)[0].fail();
    await flush();
    expect(runtime.banks.load).toHaveBeenCalledTimes(3);
    expect(page.data.bankLoading).toBe(false);
    expect(page.data.bankDirty).toBe(true);
    expect(page.data.bankForm.accountHolder).toBe('返回失败仍保留');
    bankRead.resolve(bankView(90)); await reading; await flush();
    expect(page.data.bankVersion).toBe(1);
    expect(page.data.bankLoading).toBe(false);
    expect(page.data.bankForm.accountHolder).toBe('返回失败仍保留');
  });
  it('ignores responses after unload and keeps basic writes separate from a pending bank read', async () => {
    await ready(); await open();
    const writing = deferred();
    runtime.applications.saveBasics.mockReturnValueOnce(writing.promise);
    const saving = page.onSave(); await flush();
    await page.onBankSave();
    expect(runtime.banks.save).not.toHaveBeenCalled();
    page.onUnload();
    const changes = page.setData.mock.calls.length;
    writing.resolve(basics(2)); await saving; await flush();
    expect(page.setData).toHaveBeenCalledTimes(changes);
  });
});
