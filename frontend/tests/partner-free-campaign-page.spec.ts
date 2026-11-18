export {};
const get = jest.fn(), create = jest.fn(), save = jest.fn();
let owner = 'mock:owner';
jest.mock('../pages/partner/runtime/partner-campaign-draft.service', () => ({
  ...jest.requireActual('../pages/partner/runtime/partner-campaign-draft.service'),
  getPartnerCampaignDraftService: () => ({ get, create, save, getSessionKey: () => owner, setMockFreeSummary: jest.fn() }),
}));
const id = '00000000-0000-4000-8000-000000000001';
const receipt = { draftId: id, status: 'DRAFT', version: 1, createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z' };
const draft = { ...receipt, basicInformation: {
  title: '免费体验登记', campaignType: 'FREE_REGISTRATION', shareDescription: '纯登记', contactPhone: null,
} };
const campaignId = '00000000-0000-4000-8000-000000000002';
const versionId = '00000000-0000-4000-8000-000000000003';
const approved = { versionId, campaignId, draftId: id, campusId: id, title: '冻结批准标题', status: 'APPROVED', version: 2,
  sequence: 1, submittedAt: '2026-10-13T00:00:00.000Z', reviewedAt: '2026-10-13T01:00:00.000Z', reviewReason: null };
const configuration = {
  draftId: id, version: 1, campusTimezone: 'America/New_York',
  freeRegistration: { startsAt: '2099-10-13T00:00:00.000Z', endsAt: '2099-10-14T00:00:00.000Z', capacityMode: 'UNLIMITED', maxRegistrations: null },
  campaignId, publishedVersionId: versionId, publishedVersion: approved, publishedShareImage: null, campaignVersion: 2, lifecycle: 'OPEN',
};
const resultPage = (data: any[], page = 1, totalPages = 1) => ({
  data, meta: { page, pageSize: 20, total: data.length, totalPages },
});
const defer = () => {
  let resolve!: (value: any) => void, reject!: (error: any) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
describe('partner free campaign actual editor Page', () => {
  let page: any;
  const flush = async () => { for (let i = 0; i < 70; i++) await Promise.resolve(); };
  const input = (field: string, value: string) => page.onFreeInput({ currentTarget: { dataset: { field } }, detail: { value } });
  const configure = () => {
    input('startsAt', '2099-10-13T08:00:00+08:00');
    input('endsAt', '2099-10-14T08:00:00+08:00');
    page.onCapacityChange({ detail: { value: 'LIMITED' } });
    input('maxRegistrations', '2147483647');
  };
  beforeEach(() => {
    owner = 'mock:owner';
    get.mockReset().mockResolvedValue(draft);
    create.mockReset().mockResolvedValue(receipt);
    save.mockReset().mockImplementation(async (_id, version, basicInformation) => {
      get.mockResolvedValue({ ...draft, version: version + 1, basicInformation });
      return { ...receipt, version: version + 1 };
    });
    (global as any).wx = {
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
      getMenuButtonBoundingClientRect: () => ({ top: 32, left: 290, height: 32 }),
      showModal: jest.fn(), navigateBack: jest.fn(), reLaunch: jest.fn(),
      enableAlertBeforeUnload: jest.fn(), disableAlertBeforeUnload: jest.fn(),
      stopPullDownRefresh: jest.fn(), setClipboardData: jest.fn(),
      showShareMenu: jest.fn(), hideShareMenu: jest.fn(),
    };
    (global as any).getCurrentPages = () => [page, page];
    (global as any).Page = (definition: any) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
      page.setData = jest.fn((data: object) => Object.assign(page.data, data));
    };
    jest.isolateModules(() => require('../pages/partner/campaign-editor/index'));
  });
  afterEach(() => { page.onUnload(); delete (global as any).Page; delete (global as any).wx; delete (global as any).getCurrentPages; });
  const open = async () => { page.onLoad({ id }); page.onShow(); await flush(); };
  describe('loaded draft refresh failure', () => {
    it.each([
      ['getBasicDraft', 0, 'OPEN'], ['getBasicDraft', 500, 'CLOSED'],
      ['getConfiguration', 0, 'CLOSED'], ['getConfiguration', 500, 'OPEN'],
    ] as const)('requires a read-only retry after %s fails with %s', async (method, statusCode, lifecycle) => {
      page.onLoad({ id });
      const configs = jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue(configuration as any);
      jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage([approved]) as any);
      page.onShow(); await flush();
      expect(page.data).toMatchObject({ dirty: false, freeDirty: false, canSharePublished: true });
      const basicsWrite = jest.spyOn(page.freeRuntime, 'saveBasics');
      const freeWrite = jest.spyOn(page.freeRuntime, 'saveConfiguration');
      const submit = jest.spyOn(page.freeRuntime, 'submit');
      const failingRead = jest.spyOn(page.freeRuntime, method).mockRejectedValueOnce({ statusCode });
      page.onHide(); page.onShow(); await flush();
      expect(page.data).toMatchObject({
        viewState: 'ready', reading: false, needsVersionRefresh: true,
        dirty: false, freeDirty: false, freeReady: true, canSharePublished: false, publishedPath: '',
      });
      await page.onSave(); await page.onFreeSave(); await page.onSubmit();
      expect(basicsWrite).not.toHaveBeenCalled();
      expect(freeWrite).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      page.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '刷新失败后保留的名称' } });
      page.onCapacityChange({ detail: { value: 'LIMITED' } });
      input('maxRegistrations', '7');
      const before = structuredClone({ form: page.data.form, freeForm: page.data.freeForm, freeTimes: page.data.freeTimes });
      const reads = [get.mock.calls.length, configs.mock.calls.length];
      page.onHide(); page.onShow(); page.onPullDownRefresh(); await flush();
      expect([get.mock.calls.length, configs.mock.calls.length]).toEqual(reads);
      await page.onListRetry();
      expect(page.data).toMatchObject({ needsVersionRefresh: true, canSharePublished: false });
      failingRead.mockRejectedValueOnce({ statusCode: 500 });
      await page.onRetry();
      expect(page.data).toMatchObject({ needsVersionRefresh: true, dirty: true, freeDirty: true });
      expect({ form: page.data.form, freeForm: page.data.freeForm, freeTimes: page.data.freeTimes }).toEqual(before);
      get.mockResolvedValue({ ...draft, version: 2, basicInformation: { ...draft.basicInformation, title: '服务端新名称' } });
      configs.mockResolvedValue({ ...configuration, version: 2, lifecycle } as any);
      await page.onReload(); await flush();
      expect(page.data).toMatchObject({
        needsVersionRefresh: false, reading: false, version: 2, dirty: true, freeDirty: true,
        canSharePublished: lifecycle === 'OPEN', lifecycle,
      });
      expect({ form: page.data.form, freeForm: page.data.freeForm, freeTimes: page.data.freeTimes }).toEqual(before);
      expect(basicsWrite).not.toHaveBeenCalled();
      expect(freeWrite).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
    });
  });
  describe('registration status filtering', () => {
    const pool = Array.from({ length: 27 }, (_, index) => ({
      registrationId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      versionId, status: index < 21 ? 'REGISTERED' : 'CANCELLED',
      registeredAt: '2026-10-13T00:00:00.000Z',
      cancelledAt: index < 21 ? null : '2026-10-13T01:00:00.000Z',
      studentName: `合成学员${index + 1}`,
    }));
    const roster = async () => {
      await open();
      const read = jest.spyOn(page.freeRuntime, 'registrations').mockImplementation(async (...args: unknown[]) => {
        const [, number, status] = args as [string, number, string?];
        const filtered = status ? pool.filter((row) => row.status === status) : pool;
        return { data: filtered.slice((number - 1) * 20, number * 20),
          meta: { page: number, pageSize: 20, total: filtered.length, totalPages: Math.ceil(filtered.length / 20) } };
      });
      page.onFreeTab({ currentTarget: { dataset: { tab: 'registrations' } } }); await flush();
      return read;
    };
    const filter = (value: unknown) => {
      expect(typeof page.onRegistrationFilterChange).toBe('function');
      page.onRegistrationFilterChange({ detail: { value } });
    };
    it('starts with all records and offers the existing registration states only', async () => {
      await roster();
      expect(page.data.registrationFilters).toEqual([
        { label: '全部', value: 'ALL' }, { label: '已报名', value: 'REGISTERED' }, { label: '已撤销', value: 'CANCELLED' },
      ]);
      expect(page.data).toMatchObject({ registrationFilterIndex: 0, registrationTotal: 27, registrationCountLabel: '报名记录：27' });
    });
    it('resets the page and count immediately, then paginates the server-filtered 20-to-21 result', async () => {
      const read = await roster();
      await page.onListMore();
      expect(page.data.registrations).toHaveLength(27);
      filter('1');
      expect(page.data).toMatchObject({ registrationPage: 0, registrationTotal: 0, registrationCountLabel: '', registrations: [] });
      await flush();
      expect(read).toHaveBeenLastCalledWith(id, 1, 'REGISTERED');
      expect(page.data).toMatchObject({ registrationFilterIndex: 1, registrationPage: 1, registrationTotal: 21,
        registrationCountLabel: '已报名：21', registrationHasMore: true });
      expect(page.data.registrations).toHaveLength(20);
      await page.onListMore();
      expect(read).toHaveBeenLastCalledWith(id, 2, 'REGISTERED');
      expect(page.data.registrations).toHaveLength(21);
      expect(page.data.registrations.every((row: any) => row.status === 'REGISTERED')).toBe(true);
      expect(page.data.registrationHasMore).toBe(false);
    });
    it('returns to the unfiltered URL after cancelled records and uses the matching full count', async () => {
      const read = await roster();
      filter(2); await flush();
      expect(read).toHaveBeenLastCalledWith(id, 1, 'CANCELLED');
      expect(page.data).toMatchObject({ registrationTotal: 6, registrationCountLabel: '已撤销：6', registrationHasMore: false });
      expect(page.data.registrations.every((row: any) => row.status === 'CANCELLED')).toBe(true);
      filter(0); await flush();
      expect(read).toHaveBeenLastCalledWith(id, 1);
      expect(page.data.registrationTotal).toBe(27);
    });
    it.each(['success', 'denial'])('ignores a late old-filter %s after switching to a new filter', async (outcome) => {
      const read = await roster();
      const old = defer();
      read.mockReturnValueOnce(old.promise as any);
      filter(1); await flush();
      filter(2); await flush();
      expect(page.data.registrationTotal).toBe(6);
      const writes = page.setData.mock.calls.length;
      if (outcome === 'success') old.resolve(resultPage(pool.slice(0, 20), 1, 2));
      else old.reject({ statusCode: 403 });
      await flush();
      expect(page.setData).toHaveBeenCalledTimes(writes);
      expect(page.data).toMatchObject({ viewState: 'ready', registrationFilterIndex: 2, registrationTotal: 6 });
    });
    it('does not let a late old next-page result append rows after a status switch', async () => {
      const read = await roster();
      const old = defer();
      read.mockReturnValueOnce(old.promise as any);
      const next = page.onListMore(); await flush();
      filter(2); await flush();
      const writes = page.setData.mock.calls.length;
      old.resolve({ data: pool.slice(20), meta: { page: 2, pageSize: 20, total: 27, totalPages: 2 } });
      await next;
      expect(page.setData).toHaveBeenCalledTimes(writes);
      expect(page.data.registrations).toHaveLength(6);
    });
    it.each(['success', 'denial'])('recovers the selected filter after failed return navigation and ignores the abandoned GET %s', async (outcome) => {
      const read = await roster(), old = defer();
      read.mockReturnValueOnce(old.promise as any);
      filter(1); await flush();
      expect(page.data.listLoading).toBe(true);
      page.onBack();
      (global as any).wx.navigateBack.mock.calls.at(-1)[0].fail({ errMsg: 'synthetic back failure' });
      (global as any).wx.reLaunch.mock.calls.at(-1)[0].fail({ errMsg: 'synthetic fallback failure' });
      expect(page.data).toMatchObject({ registrationFilterIndex: 1, listLoading: false });
      expect(page.data.listError).toBeTruthy();
      const writes = page.setData.mock.calls.length;
      if (outcome === 'success') old.resolve(resultPage(pool.slice(0, 20), 1, 2));
      else old.reject({ statusCode: 403 });
      await flush();
      expect(page.setData).toHaveBeenCalledTimes(writes);
      await page.onListRetry();
      expect(read).toHaveBeenLastCalledWith(id, 1, 'REGISTERED');
      expect(page.data).toMatchObject({ registrationTotal: 21, listLoading: false, listError: '', registrationCountLabel: '已报名：21' });
    });
    it('retains the selected filter after a GET failure and retries that first page once', async () => {
      const read = await roster();
      read.mockRejectedValueOnce({ statusCode: 500 });
      filter(2); await flush();
      expect(page.data).toMatchObject({ registrationFilterIndex: 2, registrations: [], registrationTotal: 0, registrationCountLabel: '' });
      expect(page.data.listError).toBeTruthy();
      const count = read.mock.calls.length;
      filter(2); await page.onListMore();
      expect(read).toHaveBeenCalledTimes(count);
      await page.onListRetry();
      expect(read).toHaveBeenLastCalledWith(id, 1, 'CANCELLED');
      expect(page.data).toMatchObject({ listError: '', registrationTotal: 6, registrationCountLabel: '已撤销：6' });
    });
    it('retains the filter across the history tab and hide/show rereads', async () => {
      const read = await roster(); filter(2); await flush();
      page.onFreeTab({ currentTarget: { dataset: { tab: 'history' } } }); await flush();
      page.onFreeTab({ currentTarget: { dataset: { tab: 'registrations' } } }); await flush();
      expect(read).toHaveBeenLastCalledWith(id, 1, 'CANCELLED');
      page.onHide(); page.onShow(); await flush();
      expect(page.data.registrationFilterIndex).toBe(2);
      expect(read).toHaveBeenLastCalledWith(id, 1, 'CANCELLED');
    });
    it.each([401, 403])('clears private rows, counts and selected filter on the current HTTP %s', async (statusCode) => {
      const read = await roster(); read.mockRejectedValueOnce({ statusCode });
      filter(2); await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', registrations: [], registrationFilterIndex: 0,
        registrationTotal: 0, registrationCountLabel: '' });
    });
    it('deduplicates the same selection and refuses malformed native indices', async () => {
      const read = await roster();
      for (const value of [0, '0', -1, 3, 1.5, '1x', '', null, undefined, ['1'], {}]) filter(value);
      await flush();
      expect(read).toHaveBeenCalledTimes(1);
      filter(1); filter('1'); await flush();
      expect(read).toHaveBeenCalledTimes(2);
    });
    it('ignores callbacks during history, post-submit refresh, hide, unload or navigation', async () => {
      const read = await roster();
      page.onFreeTab({ currentTarget: { dataset: { tab: 'history' } } }); await flush();
      filter(1); expect(page.data.registrationFilterIndex).toBe(0);
      page.onFreeTab({ currentTarget: { dataset: { tab: 'registrations' } } }); await flush();
      const count = read.mock.calls.length;
      page.setData({ submitRefreshNeeded: true }); filter(1);
      page.setData({ submitRefreshNeeded: false });
      page.navigating = true; filter(1); page.navigating = false;
      page.onHide(); filter(1); page.onUnload(); filter(1); await flush();
      expect(page.data.registrationFilterIndex).toBe(0);
      expect(read).toHaveBeenCalledTimes(count);
    });
    it('rechecks the owner inside the native filter callback and resets selected private state', async () => {
      const read = await roster(); filter(2); await flush();
      const count = read.mock.calls.length;
      owner = 'mock:new-owner'; filter(1); await flush();
      expect(read).toHaveBeenCalledTimes(count);
      expect(page.data).toMatchObject({ viewState: 'forbidden', registrations: [], registrationFilterIndex: 0, registrationCountLabel: '' });
    });
  });
  it('loads an explicit unconfigured partition with server timezone and no fake approval', async () => {
    await open();
    expect(page.data).toMatchObject({ freeReady: true, campusTimezone: 'Asia/Shanghai', freeDirty: false, publishedPath: '' });
    expect(page.data.freeForm.startsAt).toBe('');
    expect(page.data.freeForm.capacityMode).toBe('');
  });
  describe('campus date and time pickers', () => {
    const pick = (field: string, part: string, value: string) => {
      expect(typeof page.onFreeTimeChange).toBe('function');
      page.onFreeTimeChange({ currentTarget: { dataset: { field, part } }, detail: { value } });
    };
    const selectRange = () => {
      pick('startsAt', 'date', '2099-10-13');
      pick('startsAt', 'time', '08:30');
      pick('endsAt', 'time', '09:45');
      pick('endsAt', 'date', '2099-10-14');
      page.onCapacityChange({ detail: { value: 'UNLIMITED' } });
    };
    const readConfiguration = async (settings = configuration) => {
      page.onLoad({ id });
      jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue(settings as any);
      page.onShow(); await flush();
    };
    it('keeps both picker pairs blank until the user explicitly selects them', async () => {
      await open();
      expect(page.data.freeTimes).toEqual({
        startsAt: { date: '', time: '' }, endsAt: { date: '', time: '' },
      });
      await page.onFreeSave();
      expect(page.data.freeForm.startsAt).toBe('');
      expect(page.data.freeForm.endsAt).toBe('');
    });
    it.each(['date', 'time'])('retains a partial %s selection with back protection and refuses to send old or invented times', async (part) => {
      await open();
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration');
      const submit = jest.spyOn(page.freeRuntime, 'submit');
      pick('startsAt', part, part === 'date' ? '2099-10-13' : '08:30');
      const before = JSON.parse(JSON.stringify(page.data.freeTimes));
      expect(page.data.freeDirty).toBe(true);
      page.onBack();
      expect((global as any).wx.showModal).toHaveBeenCalled();
      (global as any).wx.showModal.mock.calls[0][0].success({ confirm: false });
      await page.onFreeSave(); await page.onSubmit();
      expect(write).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
      expect(page.data.freeMessage).toMatch(/日期.*时间|时间.*日期/);
      page.onHide(); page.onShow(); await flush();
      expect(page.data.freeTimes).toEqual(before);
    });
    it('saves a cross-day Shanghai range as UTC and reads the selected values back', async () => {
      await open(); selectRange();
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration');
      await page.onFreeSave();
      expect(write).toHaveBeenCalledWith(id, 1, {
        startsAt: '2099-10-13T00:30:00.000Z', endsAt: '2099-10-14T01:45:00.000Z',
        capacityMode: 'UNLIMITED', maxRegistrations: null,
      });
      expect(page.data).toMatchObject({ freeDirty: false, version: 2, startsLabel: '2099-10-13 08:30' });
      await page.onReload(); await flush();
      expect(page.data.freeTimes).toEqual({
        startsAt: { date: '2099-10-13', time: '08:30' }, endsAt: { date: '2099-10-14', time: '09:45' },
      });
    });
    it('displays and saves using the server campus timezone across a device-date boundary', async () => {
      await readConfiguration();
      expect(page.data.freeTimes).toEqual({
        startsAt: { date: '2099-10-12', time: '20:00' }, endsAt: { date: '2099-10-13', time: '20:00' },
      });
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration').mockResolvedValue({ ...receipt, version: 2 });
      pick('startsAt', 'time', '21:15');
      await page.onFreeSave();
      expect(write).toHaveBeenCalledWith(id, 1, expect.objectContaining({ startsAt: '2099-10-13T01:15:00.000Z' }));
      expect(page.data.freeTimes.startsAt.time).toBe('21:15');
    });
    it('preserves server seconds and milliseconds when changing capacity or the selected minute', async () => {
      await open();
      await page.freeRuntime.saveConfiguration(id, 1, {
        ...configuration.freeRegistration, startsAt: '2099-10-13T00:00:27.456Z', endsAt: '2099-10-14T00:00:59.123Z',
      });
      await page.onRetry();
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration');
      page.onCapacityChange({ detail: { value: 'LIMITED' } }); input('maxRegistrations', '12');
      await page.onFreeSave();
      expect(write.mock.calls[0][2]).toMatchObject({ startsAt: '2099-10-13T00:00:27.456Z', endsAt: '2099-10-14T00:00:59.123Z' });
      pick('startsAt', 'time', '08:30'); await page.onFreeSave();
      expect(write.mock.calls[1][2]).toMatchObject({ startsAt: '2099-10-13T00:30:27.456Z', endsAt: '2099-10-14T00:00:59.123Z' });
    });
    it.each([
      ['2026-03-08', '02:30', /不存在/],
      ['2026-11-01', '01:30', /重复/],
      ['2027-02-29', '08:00', /时间/],
    ])('rejects the invalid campus choice %s %s without a write', async (date, time, message) => {
      await readConfiguration();
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration');
      pick('startsAt', 'date', date); pick('startsAt', 'time', time);
      await page.onFreeSave();
      expect(write).not.toHaveBeenCalled();
      expect(page.data.freeMessage).toMatch(message);
      expect(page.data.freeTimes.startsAt).toEqual({ date, time });
      expect(page.data.freeDirty).toBe(true);
      pick('startsAt', 'date', '2099-10-12'); pick('startsAt', 'time', '20:30');
      write.mockResolvedValueOnce({ ...receipt, version: 2 });
      await page.onFreeSave();
      expect(write).toHaveBeenCalledTimes(1);
    });
    it('rejects an end that is not later than the start without changing either selection', async () => {
      await open(); selectRange();
      pick('endsAt', 'date', '2099-10-13'); pick('endsAt', 'time', '08:00');
      const before = JSON.parse(JSON.stringify(page.data.freeTimes));
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration');
      await page.onFreeSave();
      expect(write).not.toHaveBeenCalled(); expect(page.data.freeTimes).toEqual(before);
    });
    it('clears either saved time explicitly and requires complete settings before submission', async () => {
      await readConfiguration();
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration').mockResolvedValue({ ...receipt, version: 2 });
      const submit = jest.spyOn(page.freeRuntime, 'submit');
      expect(typeof page.onFreeTimeClear).toBe('function');
      page.onFreeTimeClear({ currentTarget: { dataset: { field: 'startsAt' } } });
      expect(page.data.freeTimes.startsAt).toEqual({ date: '', time: '' });
      expect(page.data.freeTimes.endsAt).toEqual({ date: '2099-10-13', time: '20:00' });
      await page.onFreeSave(); await page.onSubmit();
      expect(write).toHaveBeenCalledWith(id, 1, expect.objectContaining({ startsAt: null, endsAt: configuration.freeRegistration.endsAt }));
      expect(submit).not.toHaveBeenCalled();
    });
    it('returns to clean state when the user restores the original selected values', async () => {
      await readConfiguration();
      pick('startsAt', 'time', '21:00');
      expect(page.data.freeDirty).toBe(true);
      pick('startsAt', 'time', '20:00');
      expect(page.data.freeDirty).toBe(false);
    });
    it.each([
      ['Asia/Shanghai', '2028-02-29', '23:45', '2028-02-29T15:45:00.000Z'],
      ['Asia/Kathmandu', '2028-02-29', '08:30', '2028-02-29T02:45:00.000Z'],
      ['Etc/GMT+8', '2028-02-29', '08:30', '2028-02-29T16:30:00.000Z'],
      ['Pacific/Kiritimati', '2028-02-29', '00:15', '2028-02-28T10:15:00.000Z'],
      ['Australia/Lord_Howe', '2026-04-05', '02:15', '2026-04-04T15:45:00.000Z'],
    ])('resolves %s %s %s using the campus IANA zone', async (campusTimezone, date, time, startsAt) => {
      await readConfiguration({ ...configuration, campusTimezone, freeRegistration: {
        ...configuration.freeRegistration, startsAt: null as any,
      } });
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration').mockResolvedValue({ ...receipt, version: 2 });
      pick('startsAt', 'date', date); pick('startsAt', 'time', time);
      await page.onFreeSave();
      expect(write).toHaveBeenCalledWith(id, 1, expect.objectContaining({ startsAt }));
      expect(page.data.freeTimes.startsAt).toEqual({ date, time });
    });
    it.each([
      ['Australia/Lord_Howe', '2026-04-05', '01:45', /重复/],
      ['Australia/Lord_Howe', '2026-10-04', '02:15', /不存在/],
      ['Pacific/Apia', '2011-12-30', '12:00', /不存在/],
    ])('refuses the unusual transition %s %s %s', async (campusTimezone, date, time, message) => {
      await readConfiguration({ ...configuration, campusTimezone });
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration');
      pick('startsAt', 'date', date); pick('startsAt', 'time', time);
      await page.onFreeSave();
      expect(write).not.toHaveBeenCalled();
      expect(page.data.freeMessage).toMatch(message);
    });
    it.each(['2026-11-01T05:30:27.456Z', '2026-11-01T06:30:27.456Z'])('retains a previously resolved repeated-hour instant %s without choosing a new offset', async (startsAt) => {
      await readConfiguration({ ...configuration, freeRegistration: { ...configuration.freeRegistration, startsAt } });
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration').mockResolvedValue({ ...receipt, version: 2 });
      page.onCapacityChange({ detail: { value: 'LIMITED' } }); input('maxRegistrations', '3');
      await page.onFreeSave();
      expect(write).toHaveBeenCalledWith(id, 1, expect.objectContaining({ startsAt }));
      expect(page.data.freeTimes.startsAt).toEqual({ date: '2026-11-01', time: '01:30' });
    });
    it('keeps partial picks when a 409 reread changes the server version', async () => {
      await open();
      pick('startsAt', 'date', '2099-10-13');
      input('maxRegistrations', '12');
      const before = JSON.parse(JSON.stringify(page.data.freeTimes));
      jest.spyOn(page.freeRuntime, 'saveBasics').mockRejectedValueOnce({ statusCode: 409 });
      await page.onSave();
      await page.onReload(); await flush();
      expect(page.data.freeTimes).toEqual(before); expect(page.data.freeDirty).toBe(true);
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration');
      await page.onFreeSave();
      expect(write).not.toHaveBeenCalled();
    });
    it('preserves and replays the originally converted UTC body after a lost save response', async () => {
      await open(); selectRange();
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration').mockRejectedValueOnce({ statusCode: 0 });
      await page.onFreeSave();
      const before = JSON.parse(JSON.stringify(page.data.freeTimes));
      pick('startsAt', 'time', '12:00');
      page.onFreeTimeClear({ currentTarget: { dataset: { field: 'endsAt' } } });
      expect(page.data.freeTimes).toEqual(before);
      await page.onFreeSave();
      expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
      expect(page.data.freeSaveUnknown).toBe(false);
    });
    it.each(['reading', 'saving', 'freeSaving', 'submitting', 'submitUncertain', 'submitRefreshNeeded', 'dialog'])('ignores native picker and clear callbacks while %s is active', async (state) => {
      await readConfiguration();
      const before = JSON.parse(JSON.stringify(page.data.freeTimes));
      if (state === 'dialog') page.dialogPending = true;
      else page.setData({ [state]: true });
      pick('startsAt', 'time', '21:00');
      page.onFreeTimeClear({ currentTarget: { dataset: { field: 'endsAt' } } });
      expect(page.data.freeTimes).toEqual(before);
    });
    it('ignores invalid field, part and nonstring values from native callbacks', async () => {
      await open();
      const before = JSON.parse(JSON.stringify(page.data.freeTimes));
      pick('ownerId', 'date', '2099-10-13'); pick('startsAt', 'iso', '08:30');
      page.onFreeTimeChange({ currentTarget: { dataset: { field: 'startsAt', part: 'time' } }, detail: { value: ['08:30'] } });
      expect(page.data.freeTimes).toEqual(before);
    });
    it('ignores hidden or unloaded picker callbacks and clears picked dates on identity change', async () => {
      await open(); selectRange();
      const before = JSON.parse(JSON.stringify(page.data.freeTimes));
      page.onHide(); pick('startsAt', 'time', '12:00');
      expect(page.data.freeTimes).toEqual(before);
      owner = 'mock:new-owner'; page.onShow(); await flush();
      expect(page.data.freeTimes).toEqual({ startsAt: { date: '', time: '' }, endsAt: { date: '', time: '' } });
      const writes = page.setData.mock.calls.length;
      page.onUnload(); pick('startsAt', 'time', '12:00');
      expect(page.setData).toHaveBeenCalledTimes(writes);
    });
  });
  it('saves capacity and ISO settings with the global version, then basic save retains them', async () => {
    await open(); configure();
    await page.onFreeSave();
    expect(page.data).toMatchObject({ version: 2, freeDirty: false });
    page.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '更新标题' } });
    await page.onSave();
    expect(page.data.version).toBe(3);
    expect(page.data.freeForm.maxRegistrations).toBe('2147483647');
    expect(save).toHaveBeenCalledWith(id, 1, expect.objectContaining({ title: '更新标题' }));
  });
  it('basic save updates the version used by free configuration save', async () => {
    await open();
    page.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '更新' } });
    await page.onSave(); configure(); await page.onFreeSave();
    expect(page.data.version).toBe(3);
  });
  describe('confirmed partition saves reconcile the complete draft', () => {
    it.each(['basic', 'free'])('retains the confirmed %s version when both rereads are older than the receipt', async (partition) => {
      await open(); configure(); await page.onFreeSave();
      const before = structuredClone({ form: page.data.form, freeForm: page.data.freeForm, freeTimes: page.data.freeTimes });
      const basics = jest.spyOn(page.freeRuntime, 'saveBasics');
      const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration');
      (partition === 'basic' ? basics : settings).mockResolvedValueOnce({ ...receipt, version: 4 });
      const saving = partition === 'basic' ? page.onSave() : page.onFreeSave();
      await saving;
      expect(page.data).toMatchObject({ version: 4, needsVersionRefresh: true, freeReady: false,
        dirty: false, freeDirty: false, freeSaveUnknown: false, publishedPath: '' });
      expect({ form: page.data.form, freeForm: page.data.freeForm, freeTimes: page.data.freeTimes }).toEqual(before);
      const counts = [basics.mock.calls.length, settings.mock.calls.length];
      const submit = jest.spyOn(page.freeRuntime, 'submit');
      await page.onSave(); await page.onFreeSave(); await page.onSubmit();
      expect([basics.mock.calls.length, settings.mock.calls.length]).toEqual(counts);
      expect(submit).not.toHaveBeenCalled();
      const latest = await page.freeRuntime.getConfiguration(id);
      jest.spyOn(page.freeRuntime, 'getBasicDraft').mockResolvedValue({ ...draft, version: 4 });
      jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue({ ...latest, version: 4 });
      jest.spyOn(page.freeRuntime, 'getImages').mockResolvedValue({
        draftId: id, version: 4, images: { cover: null, share: null },
      });
      await page.onReload();
      expect(page.data).toMatchObject({ version: 4, needsVersionRefresh: false, freeReady: true, dirty: false, freeDirty: false });
      expect([basics.mock.calls.length, settings.mock.calls.length]).toEqual(counts);
    });
    it('detects an unseen free-settings change when unchanged basic fields replay at the newer global version', async () => {
      await open(); configure(); await page.onFreeSave();
      await page.freeRuntime.saveConfiguration(id, 2, {
        startsAt: '2099-10-13T00:00:00.000Z', endsAt: '2099-10-14T00:00:00.000Z',
        capacityMode: 'LIMITED', maxRegistrations: 9,
      });
      const reads = jest.spyOn(page.freeRuntime, 'getConfiguration');
      const submit = jest.spyOn(page.freeRuntime, 'submit');
      await page.onSave(); await flush();
      expect(reads).toHaveBeenCalledWith(id);
      expect(page.data).toMatchObject({ version: 3, freeDirty: true, needsVersionRefresh: false });
      expect(page.data.freeForm.maxRegistrations).toBe('2147483647');
      await page.onSubmit();
      expect(submit).not.toHaveBeenCalled();
    });
    it('detects unseen basic changes when unchanged free settings replay at the newer global version', async () => {
      await open(); configure(); await page.onFreeSave();
      await page.freeRuntime.saveBasics(id, 2, { ...draft.basicInformation, title: '另一会话的新标题' });
      const reads = jest.spyOn(page.freeRuntime, 'getBasicDraft');
      const submit = jest.spyOn(page.freeRuntime, 'submit');
      await page.onFreeSave(); await flush();
      expect(reads).toHaveBeenCalledWith(id);
      expect(page.data).toMatchObject({ version: 3, dirty: true, needsVersionRefresh: false });
      expect(page.data.form.title).toBe(draft.basicInformation.title);
      await page.onSubmit();
      expect(submit).not.toHaveBeenCalled();
    });
    it.each(['basic', 'free'])('blocks all writes while the confirmed %s save is being reconciled and retries only reads after failure', async (partition) => {
      await open(); configure(); await page.onFreeSave();
      const pending = defer();
      jest.spyOn(page.freeRuntime, 'getBasicDraft').mockReturnValueOnce(pending.promise as any);
      const basics = jest.spyOn(page.freeRuntime, 'saveBasics');
      const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration');
      const submit = jest.spyOn(page.freeRuntime, 'submit');
      const saving = partition === 'basic' ? page.onSave() : page.onFreeSave();
      await flush();
      expect(page.data).toMatchObject({ reading: true, needsVersionRefresh: true,
        createUncertain: false, freeSaveUnknown: false });
      const writeCounts = [basics.mock.calls.length, settings.mock.calls.length];
      await page.onSave(); await page.onFreeSave(); await page.onSubmit();
      expect([basics.mock.calls.length, settings.mock.calls.length]).toEqual(writeCounts);
      expect(submit).not.toHaveBeenCalled();
      pending.reject({ statusCode: 500 }); await saving;
      expect(page.data).toMatchObject({ reading: false, needsVersionRefresh: true, viewState: 'ready' });
      await page.onSave(); await page.onFreeSave(); await page.onSubmit();
      expect([basics.mock.calls.length, settings.mock.calls.length]).toEqual(writeCounts);
      await page.onReload();
      expect(page.data).toMatchObject({ needsVersionRefresh: false, viewState: 'ready', version: 2 });
      expect([basics.mock.calls.length, settings.mock.calls.length]).toEqual(writeCounts);
      expect(page.freeSaveAttempt).toBeUndefined();
    });
    it.each([401, 403, 404])('clears private data after a confirmed save followed by a configuration GET %s', async (statusCode) => {
      await open(); configure(); await page.onFreeSave();
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration');
      jest.spyOn(page.freeRuntime, 'getConfiguration').mockRejectedValueOnce({ statusCode });
      await page.onFreeSave(); await flush();
      expect(write).toHaveBeenCalledTimes(1);
      expect(page.data).toMatchObject({ viewState: 'forbidden', draftId: '', version: 0,
        freeSaveUnknown: false, freeDirty: false, dirty: false, history: [], registrations: [] });
      expect(page.freeSaveAttempt).toBeUndefined();
    });
    it.each(['onHide', 'onUnload'])('ignores a late reconciliation reply after %s and preserves the confirmed save outcome', async (method) => {
      await open(); configure(); await page.onFreeSave();
      const pending = defer();
      jest.spyOn(page.freeRuntime, 'getBasicDraft').mockReturnValueOnce(pending.promise as any);
      const saving = page.onFreeSave(); await flush();
      expect(page.data.reading).toBe(true);
      page[method]();
      const count = page.setData.mock.calls.length;
      pending.resolve({ ...draft, version: 2 });
      await saving;
      expect(page.setData).toHaveBeenCalledTimes(count);
      expect(page.data).toMatchObject({ freeSaveUnknown: false, needsVersionRefresh: true, version: 2 });
      expect(page.freeSaveAttempt).toBeUndefined();
      if (method === 'onHide') {
        page.onShow();
        await page.onReload(); await flush();
        expect(page.data).toMatchObject({ needsVersionRefresh: false, version: 2, freeDirty: false });
      }
    });
  });
  it('free changes enable unload and back protection', async () => {
    await open(); input('startsAt', '2099-10-13T08:00:00Z');
    expect(page.data.freeDirty).toBe(true);
    expect((global as any).wx.enableAlertBeforeUnload).toHaveBeenCalled();
    page.onBack();
    expect((global as any).wx.showModal).toHaveBeenCalled();
    expect((global as any).wx.navigateBack).not.toHaveBeenCalled();
  });
  it('unknown submission freezes same key and body and blocks all edits and writes', async () => {
    await open(); configure(); await page.onFreeSave();
    const submit = jest.spyOn(page.freeRuntime, 'submit').mockRejectedValueOnce({ statusCode: 0 });
    await page.onSubmit();
    expect(page.data.submitUncertain).toBe(true);
    const previous = submit.mock.calls[0];
    input('endsAt', '2100-01-01T00:00:00Z');
    await page.onSave(); await page.onFreeSave();
    await page.onSubmit();
    expect(submit.mock.calls[1]).toEqual(previous);
    expect(page.data.submitUncertain).toBe(false);
    expect(page.data.history[0].status).toBe('SUBMITTED');
    expect(page.data.publishedPath).toBe('');
  });
  it('mutually excludes basic, free and submission writes while a request is in flight', async () => {
    await open(); configure();
    const pending = defer();
    const write = jest.spyOn(page.freeRuntime, 'saveConfiguration').mockReturnValueOnce(pending.promise as any);
    const submit = jest.spyOn(page.freeRuntime, 'submit');
    page.onFreeSave(); await flush();
    await page.onSave(); page.onFreeSave(); await page.onSubmit();
    expect(save).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled(); expect(write).toHaveBeenCalledTimes(1);
    pending.resolve({ ...receipt, version: 2 }); await flush();
  });
  it('409 retains free inputs until an explicit coherent two-part reread', async () => {
    await open(); configure();
    jest.spyOn(page.freeRuntime, 'saveConfiguration').mockRejectedValueOnce({ statusCode: 409 });
    await page.onFreeSave();
    expect(page.data.needsVersionRefresh).toBe(true);
    expect(page.data.freeForm.maxRegistrations).toBe('2147483647');
    await page.onReload();
    expect(page.data.needsVersionRefresh).toBe(false);
    expect(page.data.freeDirty).toBe(true);
  });
  it('clears private free fields, histories and unknown attempts on owner change', async () => {
    await open(); configure(); await page.onFreeSave();
    await page.onSubmit();
    page.onHide(); owner = 'new-owner'; page.onShow(); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', freeDirty: false, submitUncertain: false, history: [], registrations: [], publishedPath: '' });
    expect(page.data.freeForm.startsAt).toBe('');
  });
  it.each([401, 403])('clears every private partition on free HTTP %s', async (statusCode) => {
    await open(); configure();
    jest.spyOn(page.freeRuntime, 'saveConfiguration').mockRejectedValueOnce({ statusCode });
    await page.onFreeSave();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.freeForm.startsAt).toBe('');
  });
  it('rejects calendar-invalid and offset-free times without writing', async () => {
    await open(); configure();
    const write = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    input('startsAt', '2099-02-30T08:00:00+08:00'); await page.onFreeSave();
    input('startsAt', '2099-10-13T08:00:00'); await page.onFreeSave();
    expect(write).not.toHaveBeenCalled();
    expect(page.data.freeDirty).toBe(true);
  });
  it('ignores late free reads while hidden and requires fresh reading on show', async () => {
    await open();
    const pending = defer();
    jest.spyOn(page.freeRuntime, 'getConfiguration').mockReturnValueOnce(pending.promise as any);
    page.onReload(); await flush(); page.onHide();
    const writes = page.setData.mock.calls.length;
    pending.resolve({}); await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    page.onShow(); await flush();
    expect(page.data.freeReady).toBe(true);
  });
  it('releases an unsent queued save on hide so new settings can be edited', async () => {
    await open(); configure();
    const write = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    page.onFreeSave(); page.onHide(); await flush(); page.onShow(); await flush();
    expect(write).not.toHaveBeenCalled();
    expect(page.data.freeSaving).toBe(false);
    input('maxRegistrations', '3'); await page.onFreeSave();
    expect(write).toHaveBeenCalledWith(id, 1, expect.objectContaining({ maxRegistrations: 3 }));
  });
  it('replays a hidden write using the original settings and version without applying a late reply', async () => {
    await open(); configure();
    const pending = defer();
    const write = jest.spyOn(page.freeRuntime, 'saveConfiguration').mockReturnValueOnce(pending.promise as any);
    page.onFreeSave(); await flush(); page.onHide();
    const writes = page.setData.mock.calls.length;
    pending.resolve({ ...receipt, version: 2 }); await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    page.onShow(); await flush();
    expect(page.data.freeSaveUnknown).toBe(true);
    input('maxRegistrations', '3'); await page.onFreeSave();
    expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
  });
  it('rejects mixed basic/config versions and exposes explicit reread', async () => {
    await open();
    jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValueOnce({ ...configuration, version: 2 } as any);
    await page.onReload();
    expect(page.data).toMatchObject({ needsVersionRefresh: true, version: 1, freeReady: false });
  });
  it('never copies an unapproved candidate and copies only a matching approved publication', async () => {
    await open();
    const configs = jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue({
      ...configuration, publishedVersionId: null, publishedVersion: null,
    } as any);
    const histories = jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage([{ ...approved, status: 'SUBMITTED', reviewedAt: null }]) as any);
    await page.onReload(); await flush(); page.onCopyPath();
    expect((global as any).wx.setClipboardData).not.toHaveBeenCalled();
    histories.mockResolvedValue(resultPage([approved]) as any);
    configs.mockResolvedValue(configuration as any);
    await page.onReload(); await flush();
    expect(page.data.startsLabel).toBe('2099-10-12 20:00');
    page.onCopyPath(); page.onCopyPath();
    expect((global as any).wx.setClipboardData).toHaveBeenCalledTimes(1);
    expect((global as any).wx.setClipboardData.mock.calls[0][0].data).toBe(`/pages/parent/campaign-registration/index?campaignId=${campaignId}&versionId=${versionId}`);
    (global as any).wx.setClipboardData.mock.calls[0][0].fail({});
    page.onCopyPath();
    expect((global as any).wx.setClipboardData).toHaveBeenCalledTimes(2);
    configs.mockResolvedValue({ ...configuration, lifecycle: 'CLOSED' } as any);
    await page.onReload(); await flush();
    expect(page.data.publishedPath).toBe('');
  });
  describe('approved free activity sharing', () => {
    const recipient = `/pages/parent/campaign-registration/index?campaignId=${campaignId}&versionId=${versionId}`;
    const imageUrl = '/pages/partner/assets/profile-mark.png';
    const preparePublication = async () => {
      await open();
      jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue(configuration as any);
      jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage([approved]) as any);
      await page.onReload(); await flush();
    };
    const prepareCleanPublication = async () => {
      page.onLoad({ id });
      jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue(configuration as any);
      jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage([approved]) as any);
      page.onShow(); await flush();
      expect(page.data).toMatchObject({ dirty: false, freeDirty: false, canSharePublished: true });
    };
    const fallback = () => {
      expect(typeof page.onShareAppMessage).toBe('function');
      expect(page.onShareAppMessage()).toEqual({
        title: '免费报名活动', path: '/pages/parent/campaign-registration/index', imageUrl,
      });
    };
    describe('configured frozen thumbnail', () => {
      const image = { id: '00000000-0000-4000-8000-000000000090', mimeType: 'image/jpeg', sizeBytes: 1024,
        accessUrl: 'https://synthetic.invalid/approved-image', accessUrlExpiresAt: '2099-01-01T00:00:00.000Z' };
      let nativeImage: jest.Mock;
      const prepareImage = async (overrides = {}) => {
        nativeImage = (global as any).wx.getImageInfo = jest.fn();
        page.onLoad({ id });
        jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue({
          ...configuration, publishedShareImage: image, ...overrides,
        } as any);
        jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage([approved]) as any);
        page.onShow(); await flush();
      };
      const success = (index = 0, path = 'wxfile://tmp_approved.jpg') =>
        nativeImage.mock.calls[index][0].success({ path, width: 800, height: 600 });
      it('prepares the approved image locally and never uses a changed private preview', async () => {
        await prepareImage();
        expect(nativeImage).toHaveBeenCalledTimes(1);
        expect(nativeImage.mock.calls[0][0].src).toBe(image.accessUrl);
        expect(page.data.canSharePublished).toBe(false);
        page.setData({ imagePreviews: { cover: 'wxfile://private-cover', share: 'wxfile://private-share' } });
        success();
        expect(page.data.canSharePublished).toBe(true);
        expect(page.onShareAppMessage()).toEqual({
          title: approved.title, path: recipient, imageUrl: 'wxfile://tmp_approved.jpg',
        });
        expect(page.data.shareImageMessage).toBe('');
      });
      it('keeps the prepared local image when its server capability expires', async () => {
        await prepareImage(); success();
        const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2100-01-01T00:00:00Z'));
        try { expect(page.onShareAppMessage().imageUrl).toBe('wxfile://tmp_approved.jpg'); }
        finally { clock.mockRestore(); }
      });
      it.each(['http://tmp/share.jpg', 'http://usr/share.jpg'])('accepts the native local image path %s', async path => {
        await prepareImage(); success(0, path);
        expect(page.onShareAppMessage().imageUrl).toBe(path);
      });
      it.each(['duringNavigation', 'afterFailedReturn'])('isolates a pending image callback %s', async timing => {
        await prepareImage();
        page.onBack();
        if (timing === 'duringNavigation') {
          const writes = page.setData.mock.calls.length;
          success();
          expect(page.setData).toHaveBeenCalledTimes(writes);
        }
        (global as any).wx.navigateBack.mock.calls[0][0].fail({});
        (global as any).wx.reLaunch.mock.calls[0][0].fail({});
        const writes = page.setData.mock.calls.length;
        success();
        expect(page.setData).toHaveBeenCalledTimes(writes);
        expect(page.data.canSharePublished).toBe(false);
        success(1, 'wxfile://tmp_after_return.jpg');
        expect(page.onShareAppMessage().imageUrl).toBe('wxfile://tmp_after_return.jpg');
      });
      it.each(['failed', 'empty', 'remote', 'wrongRatio', 'throw', 'expired', 'timeout'])(
        'uses the safe default after %s image preparation', async outcome => {
          if (outcome === 'timeout') jest.useFakeTimers();
          try {
            await prepareImage(outcome === 'expired'
              ? { publishedShareImage: { ...image, accessUrlExpiresAt: '2000-01-01T00:00:00.000Z' } } : {});
            if (outcome === 'failed') nativeImage.mock.calls[0][0].fail({});
            if (outcome === 'empty') success(0, '');
            if (outcome === 'remote') success(0, 'https://other.invalid/private.jpg');
            if (outcome === 'wrongRatio') nativeImage.mock.calls[0][0].success({ path: 'wxfile://tmp_bad.jpg', width: 750, height: 1125 });
            if (outcome === 'throw') {
              nativeImage.mockImplementation(() => { throw Error('synthetic image diagnostic'); });
              await page.onReload(); await flush();
            }
            if (outcome === 'timeout') jest.advanceTimersByTime(8000);
            expect(page.data.canSharePublished).toBe(true);
            expect(page.onShareAppMessage()).toEqual({ title: approved.title, path: recipient, imageUrl });
            expect(page.data.shareImageMessage).toBe('转发图读取失败，将使用默认图');
            if (outcome === 'timeout') {
              success();
              expect(page.onShareAppMessage().imageUrl).toBe(imageUrl);
            }
          } finally { if (outcome === 'timeout') jest.useRealTimers(); }
        });
      it.each(['hidden', 'unloaded', 'identity', 'closed', 'replaced', 'rereadFailure'])(
        'discards an old image reply after %s', async state => {
          await prepareImage();
          if (state === 'hidden') page.onHide();
          if (state === 'unloaded') page.onUnload();
          if (state === 'identity') owner = 'new-owner';
          if (state === 'closed' || state === 'replaced') {
            jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue({
              ...configuration, lifecycle: state === 'closed' ? 'CLOSED' : 'OPEN',
              publishedShareImage: state === 'replaced' ? { ...image, id } : image,
            } as any);
            await page.onReload(); await flush();
          }
          if (state === 'rereadFailure') {
            jest.spyOn(page.freeRuntime, 'getConfiguration').mockRejectedValueOnce({ statusCode: 500 });
            await page.onReload(); await flush();
          }
          const writes = page.setData.mock.calls.length;
          success();
          if (state !== 'identity') expect(page.setData).toHaveBeenCalledTimes(writes);
          expect(page.onShareAppMessage().imageUrl).toBe(imageUrl);
          if (state === 'identity') expect(page.data.viewState).toBe('forbidden');
          if (state === 'replaced') {
            success(1, 'wxfile://tmp_new.jpg');
            expect(page.onShareAppMessage().imageUrl).toBe('wxfile://tmp_new.jpg');
          }
        });
      it('can reread after a failed image and consume duplicate callbacks only once', async () => {
        await prepareImage();
        nativeImage.mock.calls[0][0].fail({});
        success();
        expect(page.onShareAppMessage().imageUrl).toBe(imageUrl);
        await page.onReload(); await flush();
        success(1);
        nativeImage.mock.calls[1][0].fail({});
        expect(page.onShareAppMessage().imageUrl).toBe('wxfile://tmp_approved.jpg');
      });
    });
    it.each([
      ['CLOSED', 'success'], ['CLOSED', 'fail'],
      ['unchanged', 'success'], ['unchanged', 'fail'],
      ['replaced', 'success'], ['replaced', 'fail'],
    ] as const)('ignores old clipboard %s publication callbacks after rereading with %s outcome', async (publication, outcome) => {
      await prepareCleanPublication();
      const clipboard = (global as any).wx.setClipboardData;
      page.onCopyPath();
      const old = clipboard.mock.calls[0][0];
      const nextVersionId = '00000000-0000-4000-8000-000000000004';
      const nextApproved = publication === 'replaced' ? { ...approved, versionId: nextVersionId, title: '新版批准标题' } : approved;
      get.mockResolvedValue({ ...draft, version: 3 });
      jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue({
        ...configuration, version: 3, lifecycle: publication === 'CLOSED' ? 'CLOSED' : 'OPEN',
        publishedVersionId: nextApproved.versionId, publishedVersion: nextApproved,
      } as any);
      await page.onReload(); await flush();
      const writes = page.setData.mock.calls.length;
      old[outcome]({});
      expect(page.setData).toHaveBeenCalledTimes(writes);
      page.onCopyPath();
      expect(clipboard).toHaveBeenCalledTimes(publication === 'CLOSED' ? 1 : 2);
      if (publication !== 'CLOSED') {
        expect(clipboard.mock.calls[1][0].data).toBe(publication === 'replaced'
          ? `/pages/parent/campaign-registration/index?campaignId=${campaignId}&versionId=${nextVersionId}` : recipient);
        clipboard.mock.calls[1][0].success({});
        expect(page.data.freeMessage).toBe('家长报名路径已复制');
      }
    });
    it.each(['draft', 'history'] as const)('suppresses clipboard completion during an in-flight %s read and permits retry afterwards', async (stage) => {
      await prepareCleanPublication();
      const clipboard = (global as any).wx.setClipboardData;
      page.onCopyPath();
      const late = defer();
      jest.spyOn(page.freeRuntime, stage === 'draft' ? 'getBasicDraft' : 'versions').mockReturnValueOnce(late.promise as any);
      const reading = stage === 'draft' ? page.onReload() : page.onListRetry();
      await flush();
      const writes = page.setData.mock.calls.length;
      clipboard.mock.calls[0][0].success({});
      expect(page.setData).toHaveBeenCalledTimes(writes);
      page.onCopyPath();
      expect(clipboard).toHaveBeenCalledTimes(1);
      late.resolve(stage === 'draft' ? draft : resultPage([approved]));
      await reading; await flush();
      page.onCopyPath();
      expect(clipboard).toHaveBeenCalledTimes(2);
    });
    it.each(['callbacks', 'throw'] as const)('releases the clipboard lock after failed return via %s without letting old callbacks unlock a newer copy', async (failure) => {
      await prepareCleanPublication();
      const native = (global as any).wx, clipboard = native.setClipboardData;
      page.onCopyPath();
      const old = clipboard.mock.calls[0][0];
      if (failure === 'throw') {
        native.navigateBack.mockImplementationOnce(() => { throw Error('private navigation diagnostic'); });
        native.reLaunch.mockImplementationOnce(() => { throw Error('private fallback diagnostic'); });
      }
      page.onBack();
      if (failure === 'callbacks') {
        native.navigateBack.mock.calls[0][0].fail({});
        native.reLaunch.mock.calls[0][0].fail({});
      }
      expect(page.data).toMatchObject({ canSharePublished: true, message: '返回失败，请重试' });
      page.onCopyPath();
      expect(clipboard).toHaveBeenCalledTimes(2);
      const writes = page.setData.mock.calls.length;
      old.success({}); old.fail({});
      page.onCopyPath();
      expect(clipboard).toHaveBeenCalledTimes(2);
      expect(page.setData).toHaveBeenCalledTimes(writes);
      clipboard.mock.calls[1][0].fail({});
      expect(page.data.freeMessage).toBe('复制失败，请重试');
      page.onCopyPath();
      expect(clipboard).toHaveBeenCalledTimes(3);
    });
    it('keeps a newer copy locked after a hidden old copy completes', async () => {
      await prepareCleanPublication();
      const clipboard = (global as any).wx.setClipboardData;
      page.onCopyPath();
      const old = clipboard.mock.calls[0][0];
      page.onHide(); page.onShow(); await flush();
      page.onCopyPath();
      expect(clipboard).toHaveBeenCalledTimes(2);
      const writes = page.setData.mock.calls.length;
      old.fail({});
      page.onCopyPath();
      expect(clipboard).toHaveBeenCalledTimes(2);
      expect(page.setData).toHaveBeenCalledTimes(writes);
      clipboard.mock.calls[1][0].success({});
      expect(page.data.freeMessage).toBe('家长报名路径已复制');
    });
    it('clears private state when identity changes before clipboard completion', async () => {
      await prepareCleanPublication();
      page.onCopyPath();
      owner = 'different-owner';
      (global as any).wx.setClipboardData.mock.calls[0][0].success({});
      expect(page.data).toMatchObject({ viewState: 'forbidden', publishedPath: '', freeMessage: '', canSharePublished: false });
    });
    it('retries after a synchronous clipboard exception and consumes duplicate callbacks once', async () => {
      await prepareCleanPublication();
      const clipboard = (global as any).wx.setClipboardData;
      clipboard.mockImplementationOnce(() => { throw Error('private clipboard diagnostic'); });
      expect(() => page.onCopyPath()).not.toThrow();
      expect(page.data.freeMessage).toBe('复制失败，请重试');
      page.onCopyPath();
      const current = clipboard.mock.calls[1][0];
      current.success({});
      page.onCopyPath();
      const writes = page.setData.mock.calls.length;
      current.fail({}); current.success({});
      page.onCopyPath();
      expect(clipboard).toHaveBeenCalledTimes(3);
      expect(page.setData).toHaveBeenCalledTimes(writes);
      expect(page.data.freeMessage).toBe('家长报名路径已复制');
    });
    it.each([
      ['getBasicDraft', 'success'], ['getBasicDraft', 'denial'],
      ['getConfiguration', 'success'], ['getConfiguration', 'denial'],
    ] as const)('requires fresh reads after failed return cancels %s and ignores its late %s', async (method, outcome) => {
      await prepareCleanPublication();
      const late = defer();
      jest.spyOn(page.freeRuntime, method).mockReturnValueOnce(late.promise as any);
      const basicsWrite = jest.spyOn(page.freeRuntime, 'saveBasics');
      const freeWrite = jest.spyOn(page.freeRuntime, 'saveConfiguration');
      const submit = jest.spyOn(page.freeRuntime, 'submit');
      const reading = page.onReload(); await flush();
      expect(page.data.reading).toBe(true);
      page.onBack();
      const backs = (global as any).wx.navigateBack.mock.calls;
      backs[backs.length - 1][0].fail({});
      const launches = (global as any).wx.reLaunch.mock.calls;
      launches[launches.length - 1][0].fail({});
      expect(page.data).toMatchObject({
        viewState: 'ready', reading: false, needsVersionRefresh: true,
        dirty: false, freeDirty: false, canSharePublished: false, publishedPath: '',
      });
      expect(page.navigating).toBe(false);
      await page.onSave(); await page.onFreeSave(); await page.onSubmit();
      expect(basicsWrite).not.toHaveBeenCalled();
      expect(freeWrite).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      const writes = page.setData.mock.calls.length;
      if (outcome === 'success') late.resolve(method === 'getBasicDraft' ? draft : configuration);
      else late.reject({ statusCode: 403 });
      await reading; await flush();
      expect(page.setData).toHaveBeenCalledTimes(writes);
      await page.onListRetry();
      expect(page.data).toMatchObject({ needsVersionRefresh: true, canSharePublished: false, publishedPath: '' });
      expect(page.freeConfiguration).toBeUndefined();
      page.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '返回失败后保留的名称' } });
      page.onCapacityChange({ detail: { value: 'LIMITED' } });
      input('maxRegistrations', '7');
      const inputBefore = structuredClone({ form: page.data.form, freeForm: page.data.freeForm, freeTimes: page.data.freeTimes });
      const lifecycle = outcome === 'success' ? 'OPEN' : 'CLOSED';
      get.mockResolvedValue({ ...draft, version: 3 });
      jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue({ ...configuration, version: 3, lifecycle } as any);
      await page.onReload(); await flush();
      expect(page.data).toMatchObject({
        needsVersionRefresh: false, reading: false, version: 3, dirty: true, freeDirty: true,
        canSharePublished: lifecycle === 'OPEN', lifecycle,
      });
      expect({ form: page.data.form, freeForm: page.data.freeForm, freeTimes: page.data.freeTimes }).toEqual(inputBefore);
      expect(basicsWrite).not.toHaveBeenCalled();
      expect(freeWrite).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
    });
    it('keeps a completed snapshot usable after failed return when no draft read was interrupted', async () => {
      await prepareCleanPublication();
      page.onBack();
      (global as any).wx.navigateBack.mock.calls[0][0].fail({});
      (global as any).wx.reLaunch.mock.calls[0][0].fail({});
      expect(page.data).toMatchObject({ reading: false, needsVersionRefresh: false, canSharePublished: true });
      expect(page.onShareAppMessage().path).toBe(recipient);
    });
    it('lets the in-flight reread finish after cancelling the unsaved return confirmation', async () => {
      await prepareCleanPublication();
      page.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '取消返回保留名称' } });
      const late = defer();
      jest.spyOn(page.freeRuntime, 'getConfiguration').mockReturnValueOnce(late.promise as any);
      const reading = page.onReload(); await flush();
      page.onBack();
      (global as any).wx.showModal.mock.calls[0][0].success({ confirm: false });
      expect((global as any).wx.navigateBack).not.toHaveBeenCalled();
      expect(page.data).toMatchObject({ reading: true, needsVersionRefresh: false });
      late.resolve({ ...configuration, lifecycle: 'CLOSED' });
      await reading; await flush();
      expect(page.data).toMatchObject({
        reading: false, needsVersionRefresh: false, dirty: true,
        form: { title: '取消返回保留名称' }, lifecycle: 'CLOSED', canSharePublished: false,
      });
    });
    it.each(['OPEN', 'CLOSED'])('rereads publication %s after cancelling an unsent basic save on immediate return', async (lifecycle) => {
      await preparePublication();
      const write = jest.spyOn(page.freeRuntime, 'saveBasics');
      const config = jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue({
        ...configuration, lifecycle,
      } as any);
      const previousReads = get.mock.calls.length, previousConfigs = config.mock.calls.length;
      page.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '返场保留的修改' } });
      const pending = page.onSave();
      page.onHide();
      page.onShow();
      await pending; await flush();
      expect(write).not.toHaveBeenCalled();
      // Mock image loading also reads the underlying draft.
      expect(get).toHaveBeenCalledTimes(previousReads + 2);
      expect(config).toHaveBeenCalledTimes(previousConfigs + 1);
      expect(page.data).toMatchObject({
        viewState: 'ready', saving: false, reading: false, dirty: true,
        form: { title: '返场保留的修改' }, lifecycle,
        publishedPath: lifecycle === 'OPEN' ? recipient : '',
        canSharePublished: lifecycle === 'OPEN',
      });
      if (lifecycle === 'OPEN') expect(page.onShareAppMessage().path).toBe(recipient);
      else fallback();
    });
    it('shares the exact publication on entry even when twenty later rejections fill the first history page', async () => {
      page.onLoad({ id });
      jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue({ ...configuration, publishedVersion: approved } as any);
      const rejected = Array.from({ length: 20 }, (_, index) => ({
        ...approved, versionId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
        title: '后续驳回标题', status: 'REJECTED', sequence: 21 - index, reviewReason: '合成驳回原因',
      }));
      const histories = jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage(rejected, 1, 2) as any);
      page.onShow(); await flush();
      expect(page.data.history).toHaveLength(20);
      expect(page.data.history.some((row: any) => row.versionId === versionId)).toBe(false);
      expect(histories).toHaveBeenCalledTimes(1);
      expect(page.data.canSharePublished).toBe(true);
      expect(page.onShareAppMessage()).toEqual({ title: approved.title, path: recipient, imageUrl });
      page.onCopyPath();
      expect((global as any).wx.setClipboardData).toHaveBeenCalledWith(expect.objectContaining({ data: recipient }));
    });
    it('re-establishes the publication after returning directly to the registration tab without loading history', async () => {
      await preparePublication();
      jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue({ ...configuration, publishedVersion: approved } as any);
      const histories = jest.spyOn(page.freeRuntime, 'versions');
      page.onFreeTab({ currentTarget: { dataset: { tab: 'registrations' } } }); await flush();
      const count = histories.mock.calls.length;
      page.onHide(); page.onShow(); await flush();
      expect(histories).toHaveBeenCalledTimes(count);
      expect(page.data.canSharePublished).toBe(true);
      expect(page.onShareAppMessage()).toEqual({ title: approved.title, path: recipient, imageUrl });
    });
    it('rebuilds the exact publication after submission refresh when the first history page contains only newer candidates', async () => {
      await open(); configure(); await page.onFreeSave();
      const candidate = { ...approved, versionId: '00000000-0000-4000-8000-000000000022',
        sequence: 22, status: 'SUBMITTED', version: 1, reviewedAt: null };
      const submit = jest.spyOn(page.freeRuntime, 'submit').mockResolvedValue(candidate as any);
      const configs = jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue({ ...configuration, version: 2 } as any);
      const newer = Array.from({ length: 19 }, (_, index) => ({
        ...approved, versionId: `00000000-0000-4000-8000-${String(index + 40).padStart(12, '0')}`,
        status: 'REJECTED', sequence: 21 - index, title: '后续驳回标题', reviewReason: '合成驳回原因',
      }));
      const histories = jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage([candidate, ...newer], 1, 2) as any);
      await page.onSubmit();
      expect(submit).toHaveBeenCalledTimes(1);
      expect(configs).toHaveBeenCalledTimes(1);
      expect(histories).toHaveBeenCalledTimes(1);
      expect(histories).toHaveBeenCalledWith(id, 1);
      expect(page.data).toMatchObject({ hasPendingReview: true, submitRefreshNeeded: false, canSharePublished: true });
      expect(page.data.history.some((row: any) => row.versionId === versionId)).toBe(false);
      expect(page.onShareAppMessage()).toEqual({ title: approved.title, path: recipient, imageUrl });
      expect(page.submitAttempt).toBeUndefined();
    });
    it('hides sharing before approval and returns a safe recipient page instead of the private editor', async () => {
      await open();
      expect((global as any).wx.hideShareMenu).toHaveBeenCalled();
      expect((global as any).wx.showShareMenu).not.toHaveBeenCalled();
      expect(page.data.canSharePublished).toBe(false);
      fallback();
    });
    it('shares the frozen approved title and public identifiers with an explicit nonprivate thumbnail', async () => {
      await preparePublication();
      page.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '未送审新标题' } });
      page.onInput({ currentTarget: { dataset: { field: 'contactPhone' } }, detail: { value: '测试私有电话' } });
      expect(typeof page.onShareAppMessage).toBe('function');
      expect(page.onShareAppMessage()).toEqual({ title: approved.title, path: recipient, imageUrl });
      expect(page.data.canSharePublished).toBe(true);
      expect((global as any).wx.showShareMenu).toHaveBeenCalledWith({ menus: ['shareAppMessage'] });
      const fs = require('node:fs');
      const path = require('node:path');
      expect(fs.existsSync(path.join(__dirname, '..', imageUrl))).toBe(true);
      expect(JSON.stringify(page.onShareAppMessage())).not.toMatch(/未送审|私有电话|draftId|studentId|token/);
    });
    it.each(['SUBMITTED', 'REJECTED', 'versionId', 'campaignId', 'draftId'])('does not share a %s publication summary', async (state) => {
      await preparePublication();
      page.freeConfiguration = { ...page.freeConfiguration, publishedVersion: {
        ...approved, ...(state === 'SUBMITTED' || state === 'REJECTED' ? { status: state }
          : { [state]: state === 'draftId' ? campaignId : id }),
      } };
      fallback();
    });
    it('clears a cached share after activity closure', async () => {
      await preparePublication();
      jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue({ ...configuration, lifecycle: 'CLOSED' } as any);
      await page.onReload(); await flush();
      expect(page.data.canSharePublished).toBe(false);
      expect((global as any).wx.hideShareMenu).toHaveBeenLastCalledWith({});
      fallback();
    });
    it.each([401, 403])('revokes sharing after a mocked service HTTP %s rejection', async (statusCode) => {
      await preparePublication();
      jest.spyOn(page.freeRuntime, 'versions').mockRejectedValueOnce({ statusCode });
      await page.onListRetry();
      expect(page.data).toMatchObject({ viewState: 'forbidden', canSharePublished: false });
      fallback();
    });
    it('does not use the old publication during an in-flight history refresh or after it fails', async () => {
      await preparePublication();
      const pending = defer();
      jest.spyOn(page.freeRuntime, 'versions').mockReturnValueOnce(pending.promise as any);
      const reading = page.onListRetry(); await flush();
      expect(page.data.canSharePublished).toBe(false);
      fallback();
      pending.reject({ statusCode: 500 }); await reading;
      expect(page.data.canSharePublished).toBe(false);
      fallback();
      await page.onListRetry();
      expect(page.data.canSharePublished).toBe(true);
    });
    it.each([
      ['getBasicDraft', 0], ['getBasicDraft', 500],
      ['getConfiguration', 0], ['getConfiguration', 500],
    ] as const)('keeps sharing revoked after %s fails with %s until a successful reread', async (method, statusCode) => {
      await preparePublication();
      const before = structuredClone({ form: page.data.form, freeForm: page.data.freeForm });
      jest.spyOn(page.freeRuntime, method).mockRejectedValueOnce({ statusCode });
      await page.onReload(); await flush();
      expect(page.data).toMatchObject({ viewState: 'ready', reading: false, canSharePublished: false, publishedPath: '' });
      expect({ form: page.data.form, freeForm: page.data.freeForm }).toEqual(before);
      fallback();
      await page.onListRetry();
      expect(page.data.canSharePublished).toBe(false);
      fallback();
      await page.onReload(); await flush();
      expect(page.data.canSharePublished).toBe(true);
      expect(page.onShareAppMessage()).toEqual({ title: approved.title, path: recipient, imageUrl });
    });
    it('rechecks identity in the native share handler even without onShow or another request', async () => {
      await preparePublication();
      owner = 'different-owner';
      fallback();
      expect(page.data).toMatchObject({ viewState: 'forbidden', canSharePublished: false });
    });
    it('does not share while hidden, after unloading, or while returning from the editor', async () => {
      await preparePublication();
      page.onBack();
      if (page.dialogPending) (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true });
      expect(page.navigating).toBe(true);
      fallback();
      page.navigating = false;
      page.onHide();
      expect(page.data.canSharePublished).toBe(false);
      fallback();
      page.onShow(); await flush();
      expect(page.data.canSharePublished).toBe(true);
      page.onUnload();
      fallback();
    });
    it('still returns a safe share when native menu APIs are unavailable or throw', async () => {
      (global as any).wx.hideShareMenu.mockImplementation(() => { throw Error('native menu unavailable'); });
      (global as any).wx.showShareMenu.mockImplementation(() => { throw Error('native menu unavailable'); });
      await preparePublication();
      expect(typeof page.onShareAppMessage).toBe('function');
      expect(page.onShareAppMessage()).toEqual({ title: approved.title, path: recipient, imageUrl });
      delete (global as any).wx.hideShareMenu;
      delete (global as any).wx.showShareMenu;
      page.onHide();
      fallback();
    });
  });
  it('shows frozen title and long review reason independently from current draft changes', async () => {
    await open();
    const reason = '请补充时段'.repeat(100);
    jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage([{ ...approved, status: 'REJECTED', reviewReason: reason }]) as any);
    await page.onListRetry();
    page.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '未送审新标题' } });
    expect(page.data.history[0]).toMatchObject({ title: '冻结批准标题', reviewReason: reason, statusLabel: '已驳回' });
  });
  it('keeps paginated minimal registrations on failure, masks missing student names and invalidates stale tab replies', async () => {
    await open();
    const rows = [{ registrationId: id, versionId, status: 'CANCELLED', registeredAt: '2026-10-13T00:00:00.000Z',
      cancelledAt: '2026-10-13T01:00:00.000Z', studentName: null }];
    const list = jest.spyOn(page.freeRuntime, 'registrations').mockResolvedValueOnce(resultPage(rows, 1, 2) as any);
    page.onFreeTab({ currentTarget: { dataset: { tab: 'registrations' } } }); await flush();
    expect(page.data.registrations[0]).toMatchObject({ studentLabel: '信息不可见', statusLabel: '已撤销' });
    list.mockRejectedValueOnce({ statusCode: 500 });
    await page.onListMore();
    expect(page.data.registrations).toHaveLength(1); expect(page.data.listError).toBeTruthy();
    const pending = defer(); list.mockReturnValueOnce(pending.promise as any);
    page.onListRetry(); await flush();
    page.onFreeTab({ currentTarget: { dataset: { tab: 'history' } } }); await flush();
    const writes = page.setData.mock.calls.length;
    pending.resolve(resultPage([])); await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(page.data.registrations).toHaveLength(1);
  });
  it.each([401, 403])('clears all private fields on a list HTTP %s', async (statusCode) => {
    await open();
    jest.spyOn(page.freeRuntime, 'versions').mockRejectedValueOnce({ statusCode });
    await page.onListRetry();
    expect(page.data).toMatchObject({ viewState: 'forbidden', history: [], registrations: [], publishedPath: '' });
  });
  it('blocks writes while a back confirmation is pending', async () => {
    await open(); configure(); page.onBack();
    const write = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    await page.onFreeSave();
    expect(write).not.toHaveBeenCalled();
  });
  it('accepts a newer receipt but requires explicit reread before another partition write', async () => {
    await open(); configure();
    jest.spyOn(page.freeRuntime, 'saveConfiguration').mockResolvedValueOnce({ ...receipt, version: 4 });
    await page.onFreeSave();
    expect(page.data).toMatchObject({ version: 4, freeDirty: false, needsVersionRefresh: true });
    await page.onSave(); expect(save).not.toHaveBeenCalled();
  });
  it('reads whether a nonfree draft has a free campaign but never enables free writes without saved FREE metadata', async () => {
    get.mockResolvedValueOnce({ ...draft, basicInformation: { ...draft.basicInformation, campaignType: 'REGULAR_GROUP' } });
    page.onLoad({ id });
    const config = jest.spyOn(page.freeRuntime, 'getConfiguration');
    page.onShow(); await flush(); await page.onSubmit(); await page.onFreeSave();
    expect(config).toHaveBeenCalledWith(id);
    expect(page.data).toMatchObject({ freeReady: false, hasFreeCampaign: false, history: [], registrations: [] });
  });
  it('requires saved FREE metadata again after saving another type', async () => {
    await open();
    page.onTypeChange({ detail: { value: 'REGULAR_GROUP' } });
    await page.onSave();
    page.onTypeChange({ detail: { value: 'FREE_REGISTRATION' } });
    const config = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    await page.onFreeSave();
    expect(config).not.toHaveBeenCalled();
    expect(page.data.freeReady).toBe(false);
  });
  describe('free campaign management after private type changes', () => {
    const recipient = `/pages/parent/campaign-registration/index?campaignId=${campaignId}&versionId=${versionId}`;
    const rows = [{
      registrationId: id, versionId, status: 'REGISTERED', registeredAt: '2026-10-13T00:00:00.000Z',
      cancelledAt: null, studentName: '合成学员',
    }];
    const prepare = async (type = 'FREE_REGISTRATION', lifecycle = 'OPEN', status = 'APPROVED') => {
      get.mockResolvedValue({ ...draft, basicInformation: { ...draft.basicInformation, campaignType: type } });
      page.onLoad({ id });
      const config = jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue({
        ...configuration, lifecycle, publishedVersionId: status === 'APPROVED' ? versionId : null,
        publishedVersion: status === 'APPROVED' ? approved : null,
      } as any);
      const history = jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage([{
        ...approved, status, reviewedAt: status === 'SUBMITTED' ? null : approved.reviewedAt,
        reviewReason: status === 'REJECTED' ? '请核对时段' : null,
      }]) as any);
      const registrations = jest.spyOn(page.freeRuntime, 'registrations').mockResolvedValue(resultPage(rows) as any);
      page.onShow(); await flush();
      return { config, history, registrations };
    };
    it('retains published sharing and history when the local type changes without saving', async () => {
      await prepare();
      page.onTypeChange({ detail: { value: 'REGULAR_GROUP' } });
      expect(page.data).toMatchObject({ hasFreeCampaign: true, dirty: true, canSharePublished: true });
      expect(page.onShareAppMessage()).toMatchObject({ title: approved.title, path: recipient });
      await page.onListRetry();
      expect(page.data.history[0].title).toBe(approved.title);
    });
    it('retains read management after saving another type and blocks free edits and submission', async () => {
      const { config, registrations } = await prepare();
      config.mockResolvedValue({ ...configuration, version: 2 } as any);
      page.onTypeChange({ detail: { value: 'REGULAR_GROUP' } });
      await page.onSave(); await flush();
      expect(page.data).toMatchObject({ version: 2, hasFreeCampaign: true, freeReady: false, canSharePublished: true });
      page.onFreeTab({ currentTarget: { dataset: { tab: 'registrations' } } }); await flush();
      expect(registrations).toHaveBeenCalledWith(id, 1);
      expect(page.data.registrations[0].studentLabel).toBe('合成学员');
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration'), submit = jest.spyOn(page.freeRuntime, 'submit');
      const before = structuredClone(page.data.freeForm);
      input('maxRegistrations', '3');
      await page.onFreeSave(); await page.onSubmit();
      expect(write).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
      expect(page.data.freeForm).toEqual(before);
      expect(page.onShareAppMessage()).toMatchObject({ title: approved.title, path: recipient });
    });
    it.each(['REGULAR_GROUP', 'FLASH_SALE', null])('reopens saved %s metadata with the frozen free history and public path', async (type) => {
      await prepare(type as any);
      expect(page.data).toMatchObject({ freeReady: false, hasFreeCampaign: true, historyPage: 1, canSharePublished: true });
      expect(page.data.history[0].title).toBe(approved.title);
      expect(page.onShareAppMessage()).toMatchObject({ title: approved.title, path: recipient });
      page.onCopyPath();
      expect((global as any).wx.setClipboardData.mock.calls.at(-1)[0].data).toBe(recipient);
    });
    it('keeps the selected registration filter during a nonfree hide/show reread', async () => {
      const { registrations } = await prepare('FLASH_SALE');
      page.onFreeTab({ currentTarget: { dataset: { tab: 'registrations' } } }); await flush();
      page.onRegistrationFilterChange({ detail: { value: '1' } }); await flush();
      expect(registrations).toHaveBeenLastCalledWith(id, 1, 'REGISTERED');
      page.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '尚未保存名称' } });
      const calls = registrations.mock.calls.length;
      page.onHide(); page.onShow(); await flush();
      expect(page.data).toMatchObject({ registrationFilterIndex: 1, registrationTotal: 1, freeReady: false, hasFreeCampaign: true });
      expect(page.data.form.title).toBe('尚未保存名称');
      expect(registrations).toHaveBeenCalledTimes(calls + 1);
      expect(registrations).toHaveBeenLastCalledWith(id, 1, 'REGISTERED');
    });
    it.each(['SUBMITTED', 'REJECTED'])('keeps %s history readable after a type change without allowing it to be shared', async (status) => {
      await prepare('REGULAR_GROUP', 'OPEN', status);
      expect(page.data).toMatchObject({ hasFreeCampaign: true, freeReady: false, canSharePublished: false, publishedPath: '' });
      expect(page.data.history[0].status).toBe(status);
    });
    it('keeps closed history and registrations readable while rejecting share and copy commands', async () => {
      const { registrations } = await prepare('REGULAR_GROUP', 'CLOSED');
      expect(page.data).toMatchObject({ hasFreeCampaign: true, lifecycle: 'CLOSED', publishedPath: '', canSharePublished: false });
      expect(page.data.history).toHaveLength(1);
      page.onCopyPath();
      expect((global as any).wx.setClipboardData).not.toHaveBeenCalled();
      page.onFreeTab({ currentTarget: { dataset: { tab: 'registrations' } } }); await flush();
      expect(registrations).toHaveBeenCalledWith(id, 1);
      expect(page.data.registrations).toHaveLength(1);
    });
    it.each([401, 403, 404])('clears retained management on a current %s response for a changed-type draft', async (statusCode) => {
      const { history } = await prepare('REGULAR_GROUP');
      history.mockRejectedValueOnce({ statusCode });
      await page.onListRetry();
      expect(page.data).toMatchObject({
        viewState: 'forbidden', hasFreeCampaign: false, freeReady: false, history: [], registrations: [],
        publishedPath: '', canSharePublished: false,
      });
    });
    it('requires saving FREE metadata again before re-enabling configuration writes on an existing campaign', async () => {
      await prepare('REGULAR_GROUP');
      page.onTypeChange({ detail: { value: 'FREE_REGISTRATION' } });
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration'), submit = jest.spyOn(page.freeRuntime, 'submit');
      await page.onFreeSave(); await page.onSubmit();
      expect(write).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
      expect(page.data).toMatchObject({ freeReady: false, hasFreeCampaign: true, canSharePublished: true });
    });
    it.each(['success', 'denial'])('ignores a hidden changed-type history reply with %s and re-reads on return', async (outcome) => {
      const { history } = await prepare('REGULAR_GROUP'), old = defer();
      history.mockReturnValueOnce(old.promise as any);
      const read = page.onListRetry(); await flush(); page.onHide();
      const writes = page.setData.mock.calls.length;
      if (outcome === 'success') old.resolve(resultPage([approved]));
      else old.reject({ statusCode: 403 });
      await read;
      expect(page.setData).toHaveBeenCalledTimes(writes);
      page.onShow(); await flush();
      expect(page.data).toMatchObject({ hasFreeCampaign: true, canSharePublished: true, viewState: 'ready' });
    });
    it('revokes share and copy after a configuration failure until a coherent changed-type reread', async () => {
      const { config } = await prepare('REGULAR_GROUP');
      config.mockRejectedValueOnce({ statusCode: 500 });
      await page.onReload(); await flush(); page.onCopyPath();
      expect((global as any).wx.setClipboardData).not.toHaveBeenCalled();
      expect(page.data.canSharePublished).toBe(false);
      await page.onListRetry();
      expect(page.data.canSharePublished).toBe(false);
      await page.onReload(); await flush();
      expect(page.data.canSharePublished).toBe(true);
    });
    it.each(['history', 'registrations'])('refreshes closure before sharing on return to a dirty changed-type %s tab', async (tab) => {
      const { config } = await prepare('REGULAR_GROUP');
      if (tab === 'registrations') {
        page.onFreeTab({ currentTarget: { dataset: { tab } } }); await flush();
      }
      page.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '尚未保存名称' } });
      page.onHide();
      const pending = defer(), calls = config.mock.calls.length;
      config.mockReturnValueOnce(pending.promise as any);
      page.onShow(); await flush();
      expect(config).toHaveBeenCalledTimes(calls + 1);
      expect(page.data.canSharePublished).toBe(false);
      page.onCopyPath();
      expect((global as any).wx.setClipboardData).not.toHaveBeenCalled();
      pending.resolve({ ...configuration, lifecycle: 'CLOSED' }); await flush();
      expect(page.data).toMatchObject({ lifecycle: 'CLOSED', canSharePublished: false, publishedPath: '', dirty: true });
      expect(page.data.form.title).toBe('尚未保存名称');
      expect(page.onShareAppMessage().path).toBe('/pages/parent/campaign-registration/index');
    });
    it.each(['hidden', 'returned'])('refreshes publication after a basic save receipt arrives while %s', async (timing) => {
      const { config } = await prepare('REGULAR_GROUP'), pending = defer();
      page.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '已确认新名称' } });
      jest.spyOn(page.freeRuntime, 'saveBasics').mockReturnValueOnce(pending.promise as any);
      const saving = page.onSave(); await flush(); page.onHide();
      get.mockResolvedValue({ ...draft, version: 2, basicInformation: {
        ...draft.basicInformation, campaignType: 'REGULAR_GROUP', title: '已确认新名称',
      } });
      config.mockResolvedValue({ ...configuration, version: 2, lifecycle: 'CLOSED' } as any);
      if (timing === 'returned') { page.onShow(); await flush(); }
      pending.resolve({ ...receipt, version: 2 }); await saving; await flush();
      if (timing === 'hidden') { page.onShow(); await flush(); }
      expect(config).toHaveBeenCalledTimes(2);
      expect(page.data).toMatchObject({ lifecycle: 'CLOSED', canSharePublished: false, publishedPath: '', version: 2 });
      expect(page.data.form.title).toBe('已确认新名称');
      page.onCopyPath();
      expect((global as any).wx.setClipboardData).not.toHaveBeenCalled();
    });
  });
  it('preserves an unknown submission across hide/show and ignores the late receipt', async () => {
    await open(); configure(); await page.onFreeSave();
    const pending = defer();
    const submit = jest.spyOn(page.freeRuntime, 'submit').mockReturnValueOnce(pending.promise as any);
    page.onSubmit(); await flush(); page.onHide();
    const writes = page.setData.mock.calls.length;
    pending.resolve({ ...approved, status: 'SUBMITTED' }); await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    page.onShow(); await flush(); page.onBack();
    expect((global as any).wx.showModal.mock.calls[0][0].content).toMatch(/送审结果/);
    (global as any).wx.showModal.mock.calls[0][0].success({ confirm: false });
    await page.onSubmit();
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
  });
  it('clears private data on show after a hidden write returns forbidden, without rendering while hidden', async () => {
    await open(); configure();
    const pending = defer();
    jest.spyOn(page.freeRuntime, 'saveConfiguration').mockReturnValueOnce(pending.promise as any);
    page.onFreeSave(); await flush(); page.onHide();
    const writes = page.setData.mock.calls.length;
    pending.reject({ statusCode: 403 }); await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    page.onShow(); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', history: [], registrations: [], freeDirty: false });
    expect(page.data.freeForm.startsAt).toBe('');
  });
  it.each(['APPROVED', 'REJECTED'])('reads current %s state after replaying a lost submission receipt', async (status) => {
    await open(); configure(); await page.onFreeSave();
    const original = { ...approved, status: 'SUBMITTED', version: 1, reviewedAt: null };
    const submit = jest.spyOn(page.freeRuntime, 'submit')
      .mockRejectedValueOnce({ statusCode: 0 }).mockResolvedValueOnce(original as any);
    await page.onSubmit();
    const attempt = page.submitAttempt;
    const currentConfig = { ...configuration, version: 2, publishedVersionId: status === 'APPROVED' ? versionId : null,
      publishedVersion: status === 'APPROVED' ? approved : null };
    const configs = jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue(currentConfig as any);
    const histories = jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage([{
      ...approved, status, reviewReason: status === 'REJECTED' ? '请调整时段' : null,
    }]) as any);
    await page.onSubmit();
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
    expect(configs).toHaveBeenCalledTimes(1); expect(histories).toHaveBeenCalledWith(id, 1);
    expect(page.data.history[0].status).toBe(status);
    expect(page.data.hasPendingReview).toBe(false);
    expect(page.data.publishedPath).toBe(status === 'APPROVED'
      ? `/pages/parent/campaign-registration/index?campaignId=${campaignId}&versionId=${versionId}` : '');
    expect(page.submitAttempt).toBeUndefined();
    expect(attempt.key).toBe(submit.mock.calls[0][2]);
  });
  it.each(['configuration', 'history'])('blocks all writes and retains the original key when post-submit %s reading fails', async (stage) => {
    await open(); configure(); await page.onFreeSave();
    const original = { ...approved, status: 'SUBMITTED', version: 1, reviewedAt: null };
    const submit = jest.spyOn(page.freeRuntime, 'submit').mockResolvedValue(original as any);
    const configs = jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue({ ...configuration, version: 2 } as any);
    const histories = jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage([approved]) as any);
    (stage === 'configuration' ? configs : histories).mockRejectedValueOnce({ statusCode: 500 });
    await page.onSubmit();
    expect(page.data.submitRefreshNeeded).toBe(true);
    expect(page.data.history).toEqual([]);
    const attempt = page.submitAttempt;
    expect(attempt.key).toBe(submit.mock.calls[0][2]);
    const configWrite = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    input('maxRegistrations', '3');
    await page.onFreeSave(); await page.onSave();
    expect(configWrite).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    expect(page.data.freeForm.maxRegistrations).toBe('2147483647');
    page.onBack();
    expect((global as any).wx.showModal.mock.calls[0][0].content).toMatch(/审核状态|送审/);
    (global as any).wx.showModal.mock.calls[0][0].success({ confirm: false });
    await page.onSubmit();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(page.data).toMatchObject({ submitRefreshNeeded: false, submitUncertain: false, hasPendingReview: false });
    expect(page.data.history[0].status).toBe('APPROVED');
    expect(page.submitAttempt).toBeUndefined();
  });
  it('retains post-submit read failure across hide/show and retries reading without another POST', async () => {
    await open(); configure(); await page.onFreeSave();
    const submit = jest.spyOn(page.freeRuntime, 'submit').mockResolvedValue({
      ...approved, status: 'SUBMITTED', version: 1, reviewedAt: null,
    } as any);
    const configs = jest.spyOn(page.freeRuntime, 'getConfiguration').mockRejectedValueOnce({ statusCode: 500 });
    await page.onSubmit();
    const attempt = page.submitAttempt;
    page.onHide(); page.onShow(); await flush();
    expect(page.data.submitRefreshNeeded).toBe(true);
    expect(page.submitAttempt).toBe(attempt);
    expect(configs).toHaveBeenCalledTimes(1);
    configs.mockResolvedValue({ ...configuration, version: 2 } as any);
    jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage([approved]) as any);
    await page.onListRetry();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(page.data.history[0].status).toBe('APPROVED');
    expect(page.submitAttempt).toBeUndefined();
  });
  it('invalidates a post-submit read on hide and preserves the confirmed attempt for explicit retry', async () => {
    await open(); configure(); await page.onFreeSave();
    const pending = defer();
    const submit = jest.spyOn(page.freeRuntime, 'submit').mockResolvedValue({
      ...approved, status: 'SUBMITTED', version: 1, reviewedAt: null,
    } as any);
    const configs = jest.spyOn(page.freeRuntime, 'getConfiguration').mockReturnValueOnce(pending.promise as any);
    jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage([approved]) as any);
    page.onSubmit(); await flush();
    expect(configs).toHaveBeenCalled();
    page.onHide(); const writes = page.setData.mock.calls.length;
    pending.resolve({ ...configuration, version: 2 }); await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    page.onShow(); await flush();
    expect(page.data.submitRefreshNeeded).toBe(true);
    configs.mockResolvedValue({ ...configuration, version: 2 } as any);
    await page.onSubmissionRefresh();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(page.data.history[0].status).toBe('APPROVED');
  });
  it('can explicitly retry a post-submit read on show before the hidden old read settles', async () => {
    await open(); configure(); await page.onFreeSave();
    const oldRead = defer();
    const submit = jest.spyOn(page.freeRuntime, 'submit').mockResolvedValue({
      ...approved, status: 'SUBMITTED', version: 1, reviewedAt: null,
    } as any);
    const configs = jest.spyOn(page.freeRuntime, 'getConfiguration')
      .mockReturnValueOnce(oldRead.promise as any).mockResolvedValue({ ...configuration, version: 2 } as any);
    jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage([approved]) as any);
    const original = page.onSubmit(); await flush();
    page.onHide(); page.onShow(); await flush();
    expect(page.data).toMatchObject({ reading: false, submitRefreshNeeded: true });
    await page.onSubmissionRefresh();
    expect(configs).toHaveBeenCalledTimes(2); expect(submit).toHaveBeenCalledTimes(1);
    expect(page.data.history[0].status).toBe('APPROVED');
    expect(page.data.submitRefreshNeeded).toBe(false);
    const writes = page.setData.mock.calls.length;
    oldRead.resolve({ ...configuration, version: 2 }); await original;
    expect(page.setData).toHaveBeenCalledTimes(writes);
  });
  it('releases a post-submit read invalidated by failed back navigation for a fresh read retry', async () => {
    await open(); configure(); await page.onFreeSave();
    const oldRead = defer();
    const submit = jest.spyOn(page.freeRuntime, 'submit').mockResolvedValue({
      ...approved, status: 'SUBMITTED', version: 1, reviewedAt: null,
    } as any);
    const configs = jest.spyOn(page.freeRuntime, 'getConfiguration')
      .mockReturnValueOnce(oldRead.promise as any).mockResolvedValue({ ...configuration, version: 2 } as any);
    jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage([approved]) as any);
    const original = page.onSubmit(); await flush();
    page.onBack();
    expect((global as any).wx.showModal).toHaveBeenCalled();
    (global as any).wx.showModal.mock.calls[0][0].success({ confirm: true });
    (global as any).wx.navigateBack.mock.calls[0][0].fail({});
    (global as any).wx.reLaunch.mock.calls[0][0].fail({});
    expect(page.data).toMatchObject({ reading: false, submitRefreshNeeded: true });
    const retry = page.onSubmissionRefresh(); await flush();
    expect(configs).toHaveBeenCalledTimes(2);
    await retry;
    expect(page.data.history[0].status).toBe('APPROVED');
    expect(submit).toHaveBeenCalledTimes(1);
    oldRead.resolve({ ...configuration, version: 2 }); await original;
  });
  it('deduplicates current review rereads and blocks edits and writes until both reads finish', async () => {
    await open(); configure(); await page.onFreeSave();
    const pending = defer();
    const submit = jest.spyOn(page.freeRuntime, 'submit').mockResolvedValue({
      ...approved, status: 'SUBMITTED', version: 1, reviewedAt: null,
    } as any);
    const configs = jest.spyOn(page.freeRuntime, 'getConfiguration').mockReturnValueOnce(pending.promise as any);
    jest.spyOn(page.freeRuntime, 'versions').mockResolvedValue(resultPage([approved]) as any);
    const original = page.onSubmit(); await flush();
    page.onSubmissionRefresh(); page.onSubmit(); await flush();
    const write = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    page.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '不应修改' } });
    input('maxRegistrations', '3'); await page.onSave(); await page.onFreeSave();
    expect(configs).toHaveBeenCalledTimes(1); expect(submit).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    expect(page.data.form.title).toBe(draft.basicInformation.title);
    expect(page.data.freeForm.maxRegistrations).toBe('2147483647');
    pending.resolve({ ...configuration, version: 2 }); await original;
    expect(page.data.submitRefreshNeeded).toBe(false);
  });
  it.each([401, 403])('clears both private partitions and the original key on post-submit HTTP %s', async (statusCode) => {
    await open(); configure(); await page.onFreeSave();
    jest.spyOn(page.freeRuntime, 'submit').mockResolvedValue({
      ...approved, status: 'SUBMITTED', version: 1, reviewedAt: null,
    } as any);
    jest.spyOn(page.freeRuntime, 'getConfiguration').mockRejectedValueOnce({ statusCode });
    await page.onSubmit();
    expect(page.data).toMatchObject({ viewState: 'forbidden', submitRefreshNeeded: false, history: [], publishedPath: '' });
    expect(page.data.form.title).toBe(''); expect(page.data.freeForm.startsAt).toBe('');
    expect(page.submitAttempt).toBeUndefined();
  });
  describe('post-submit parallel read denial races', () => {
    const race = async (lateStage: string) => {
      await open(); configure(); await page.onFreeSave();
      const configRead = defer(), historyRead = defer();
      const configs = jest.spyOn(page.freeRuntime, 'getConfiguration').mockReturnValueOnce(configRead.promise as any);
      const histories = jest.spyOn(page.freeRuntime, 'versions').mockReturnValueOnce(historyRead.promise as any);
      const submit = jest.spyOn(page.freeRuntime, 'submit').mockResolvedValue({
        ...approved, status: 'SUBMITTED', version: 1, reviewedAt: null,
      } as any);
      const initial = page.onSubmit(); await flush();
      const attempt = page.submitAttempt;
      (lateStage === 'configuration' ? historyRead : configRead).reject({ statusCode: 500 });
      await initial;
      expect(page.data).toMatchObject({ viewState: 'ready', reading: false, submitRefreshNeeded: true });
      expect(page.submitAttempt).toBe(attempt);
      expect(attempt.key).toBe(submit.mock.calls[0][2]);
      return { late: lateStage === 'configuration' ? configRead : historyRead, configs, histories, submit, attempt };
    };
    it.each([
      ['configuration', 401], ['configuration', 403], ['history', 401], ['history', 403],
      ['configuration', 404], ['history', 404],
    ])('clears private state on late %s HTTP %s after the sibling already failed 500', async (lateStage, statusCode) => {
      const { late, submit } = await race(String(lateStage));
      const write = jest.spyOn(page.freeRuntime, 'saveConfiguration');
      await page.onSave(); await page.onFreeSave();
      expect(save).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
      late.reject({ statusCode }); await flush();
      expect(page.data).toMatchObject({
        viewState: 'forbidden', draftId: '', version: 0, reading: false, submitRefreshNeeded: false,
        freeReady: false, history: [], registrations: [], publishedPath: '', campusTimezone: '',
      });
      expect(page.data.form).toEqual({ title: '', campaignType: '', shareDescription: '', contactPhone: '' });
      expect(page.data.freeForm).toEqual({ startsAt: '', endsAt: '', capacityMode: '', maxRegistrations: '' });
      expect(page.submitAttempt).toBeUndefined(); expect(page.freeConfiguration).toBeUndefined();
      await page.onSubmissionRefresh(); await page.onSubmit(); await page.onSave(); await page.onFreeSave();
      expect(submit).toHaveBeenCalledTimes(1); expect(save).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    });
    it.each(['configuration', 'history'])('defers late hidden %s denial until show without rendering while hidden', async (lateStage) => {
      const { late } = await race(lateStage);
      page.onHide(); const writes = page.setData.mock.calls.length;
      late.reject({ statusCode: 403 }); await flush();
      expect(page.setData).toHaveBeenCalledTimes(writes);
      page.onShow(); await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', history: [], registrations: [], submitRefreshNeeded: false });
      expect(page.data.form.title).toBe(''); expect(page.data.freeForm.startsAt).toBe('');
      expect(page.submitAttempt).toBeUndefined();
    });
    it.each(['configuration', 'history'])('ignores late %s denial after unload', async (lateStage) => {
      const { late } = await race(lateStage);
      page.onUnload(); const writes = page.setData.mock.calls.length;
      late.reject({ statusCode: 401 }); await flush();
      expect(page.setData).toHaveBeenCalledTimes(writes);
      expect(page.hiddenPrivateDenied).toBe(false);
    });
    it.each(['configuration', 'history'])('does not let a late old-owner %s denial clear the new owner form', async (lateStage) => {
      const { late } = await race(lateStage);
      page.onHide(); owner = 'mock:new-owner'; page.onShow(); await flush();
      get.mockResolvedValue({ ...draft, basicInformation: { ...draft.basicInformation, title: '新身份草稿' } });
      page.onLoad({ id }); page.onShow(); await flush();
      expect(page.data.viewState).toBe('ready');
      expect(page.data.form.title).toBe('新身份草稿');
      const writes = page.setData.mock.calls.length;
      late.reject({ statusCode: 403 }); await flush();
      expect(page.setData).toHaveBeenCalledTimes(writes);
      expect(page.hiddenPrivateDenied).toBe(false);
      page.onHide(); page.onShow(); await flush();
      expect(page.data.viewState).toBe('ready');
      expect(page.data.form.title).toBe('新身份草稿');
    });
    it.each(['configuration', 'history'])('does not latch an old-owner hidden %s denial', async (lateStage) => {
      const { late } = await race(lateStage);
      page.onHide(); owner = 'mock:new-owner';
      const writes = page.setData.mock.calls.length;
      late.reject({ statusCode: 401 }); await flush();
      expect(page.setData).toHaveBeenCalledTimes(writes);
      expect(page.hiddenPrivateDenied).toBe(false);
    });
    it.each(['configuration', 'history'])('invalidates late %s denial when a fresh GET retry has started for the same key', async (lateStage) => {
      const { late, configs, histories, submit, attempt } = await race(lateStage);
      const freshConfig = defer();
      configs.mockReturnValueOnce(freshConfig.promise as any);
      histories.mockResolvedValueOnce(resultPage([approved]) as any);
      const retry = page.onSubmissionRefresh(); await flush();
      late.reject({ statusCode: 403 }); await flush();
      expect(page.data).toMatchObject({ viewState: 'ready', reading: true, submitRefreshNeeded: true });
      expect(page.submitAttempt).toBe(attempt);
      freshConfig.resolve({ ...configuration, version: 2 }); await retry;
      expect(page.data).toMatchObject({ viewState: 'ready', reading: false, submitRefreshNeeded: false });
      expect(page.data.history[0].status).toBe('APPROVED');
      expect(submit).toHaveBeenCalledTimes(1);
      expect(page.submitAttempt).toBeUndefined();
    });
    it.each(['configuration', 'history'])('retains the key on a late ordinary %s failure and retries only GET', async (lateStage) => {
      const { late, configs, histories, submit, attempt } = await race(lateStage);
      late.reject({ statusCode: 500 }); await flush();
      expect(page.data).toMatchObject({ viewState: 'ready', reading: false, submitRefreshNeeded: true });
      expect(page.submitAttempt).toBe(attempt);
      configs.mockResolvedValueOnce({ ...configuration, version: 2 } as any);
      histories.mockResolvedValueOnce(resultPage([approved]) as any);
      await page.onSubmissionRefresh();
      expect(page.data).toMatchObject({ viewState: 'ready', reading: false, submitRefreshNeeded: false });
      expect(submit).toHaveBeenCalledTimes(1);
      expect(page.submitAttempt).toBeUndefined();
    });
  });
  it.each(['basic', 'free', 'submit'])('preserves the %s 409 gate and both draft partitions across hide/show until explicit reread', async (kind) => {
    await open(); configure(); await page.onFreeSave();
    const freeWrite = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    const submit = jest.spyOn(page.freeRuntime, 'submit');
    if (kind === 'basic') jest.spyOn(page.freeRuntime, 'saveBasics').mockRejectedValueOnce({ statusCode: 409 });
    if (kind === 'free') freeWrite.mockRejectedValueOnce({ statusCode: 409 });
    if (kind === 'submit') submit.mockRejectedValueOnce({ statusCode: 409 });
    await (kind === 'basic' ? page.onSave() : kind === 'free' ? page.onFreeSave() : page.onSubmit());
    expect(page.data.needsVersionRefresh).toBe(true);
    const before = JSON.parse(JSON.stringify({ form: page.data.form, freeForm: page.data.freeForm }));
    const reads = get.mock.calls.length;
    const histories = jest.spyOn(page.freeRuntime, 'versions');
    const configs = jest.spyOn(page.freeRuntime, 'getConfiguration');
    page.onHide(); page.onShow(); await flush();
    page.onPullDownRefresh(); await flush();
    expect(page.data.needsVersionRefresh).toBe(true);
    expect({ form: page.data.form, freeForm: page.data.freeForm }).toEqual(before);
    expect(get).toHaveBeenCalledTimes(reads);
    expect(configs).not.toHaveBeenCalled(); expect(histories).not.toHaveBeenCalled();
    const writes = [save.mock.calls.length, freeWrite.mock.calls.length, submit.mock.calls.length];
    await page.onSave(); await page.onFreeSave(); await page.onSubmit();
    expect([save.mock.calls.length, freeWrite.mock.calls.length, submit.mock.calls.length]).toEqual(writes);
    get.mockResolvedValue({ ...draft, version: 3, basicInformation: { ...draft.basicInformation, title: '服务端新标题' } });
    await page.onReload(); await flush();
    expect(page.data.needsVersionRefresh).toBe(false);
    expect(page.data.form).toEqual(before.form); expect(page.data.freeForm).toEqual(before.freeForm);
    expect(page.data.version).toBe(4);
  });
  it('retains the conflict gate and dirty forms when explicit reread fails, then retries only reading', async () => {
    await open(); configure();
    page.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '未保存新名称' } });
    const write = jest.spyOn(page.freeRuntime, 'saveConfiguration').mockRejectedValueOnce({ statusCode: 409 });
    await page.onFreeSave();
    const before = JSON.parse(JSON.stringify({ form: page.data.form, freeForm: page.data.freeForm }));
    get.mockRejectedValueOnce({ statusCode: 500 });
    await page.onReload();
    expect(page.data).toMatchObject({ needsVersionRefresh: true, dirty: true, freeDirty: true, reading: false });
    page.onHide(); page.onShow(); await flush();
    expect({ form: page.data.form, freeForm: page.data.freeForm }).toEqual(before);
    await page.onSave(); await page.onFreeSave();
    expect(write).toHaveBeenCalledTimes(1); expect(save).not.toHaveBeenCalled();
    get.mockResolvedValue({ ...draft, version: 3, basicInformation: { ...draft.basicInformation, title: '服务端修改' } });
    await page.onReload(); await flush();
    expect(page.data).toMatchObject({ needsVersionRefresh: false, version: 3, dirty: true, freeDirty: true });
    expect({ form: page.data.form, freeForm: page.data.freeForm }).toEqual(before);
  });
});
