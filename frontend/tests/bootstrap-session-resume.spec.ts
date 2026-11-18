import {
  API_BASE, apiRuntime, captureHeadquartersBootstrap, flushBootstrap,
  HEADQUARTERS_URL, headquartersMe,
} from './operator-headquarters-bootstrap.fixture';
import type { BootstrapHost } from './operator-headquarters-bootstrap.fixture';

describe('bootstrap session checks after returning to the page', () => {
  let host: BootstrapHost;
  afterEach(() => host?.close());

  it('keeps the first onLoad request valid through the initial onShow', async () => {
    host = captureHeadquartersBootstrap(apiRuntime());
    const page = host.instantiate();
    page.onLoad();
    page.onShow();
    expect(host.calls).toHaveLength(1);
    host.replyMe(0, headquartersMe);
    await flushBootstrap();
    expect(host.platform.reLaunch).toHaveBeenCalledWith({ url: HEADQUARTERS_URL });
  });

  it.each(['success', 'network'] as const)(
    'rechecks on return and ignores the hidden older read: %s',
    async mode => {
      host = captureHeadquartersBootstrap(apiRuntime());
      const page = host.instantiate();
      const old = page.loadSession();
      page.onHide();
      page.onShow();
      if (mode === 'success') host.replyMe(0, headquartersMe);
      else host.calls[0].fail(new Error('synthetic-hidden-read'));
      await old;
      await flushBootstrap();
      expect(host.calls).toHaveLength(2);
      expect(page.setData.mock.calls.every(([patch]) => patch.viewState === 'loading')).toBe(true);
      expect(host.platform.reLaunch).not.toHaveBeenCalled();
      host.replyMe(1, headquartersMe);
      await flushBootstrap();
      expect(host.platform.reLaunch).toHaveBeenCalledTimes(1);
      expect(host.platform.reLaunch).toHaveBeenCalledWith({ url: HEADQUARTERS_URL });
    },
  );

  it('checks the newly bound token after returning without resubmitting the binding', async () => {
    host = captureHeadquartersBootstrap(apiRuntime());
    const page = host.instantiate() as ReturnType<BootstrapHost['instantiate']> & {
      onWechatPhoneTap(event: { detail: { code: string } }): Promise<void>;
    };
    page.data.viewState = 'login';
    const pending = page.onWechatPhoneTap({ detail: { code: 'synthetic-phone-code' } });
    await flushBootstrap();
    expect(host.calls[0].method).toBe('POST');
    page.onHide();
    host.replyLogin(0, headquartersMe, 'synthetic-bound-headquarters');
    await pending;
    expect(page.data.viewState).toBe('submitting');
    expect(host.platform.reLaunch).not.toHaveBeenCalled();
    page.onShow();
    await flushBootstrap();
    expect(host.calls[1]).toMatchObject({
      method: 'GET', url: `${API_BASE}/me`,
      header: { Authorization: 'Bearer synthetic-bound-headquarters' },
    });
    host.replyMe(1, headquartersMe);
    await flushBootstrap();
    expect(host.platform.reLaunch).toHaveBeenCalledWith({ url: HEADQUARTERS_URL });
    expect(host.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  });

  it('waits for a pending binding when the logged-out page returns before its reply', async () => {
    host = captureHeadquartersBootstrap(apiRuntime());
    host.service.logout();
    const page = host.instantiate() as ReturnType<BootstrapHost['instantiate']> & {
      onWechatPhoneTap(event: { detail: { code: string } }): Promise<void>;
    };
    page.data.viewState = 'login';
    const pending = page.onWechatPhoneTap({ detail: { code: 'synthetic-pending-phone' } });
    await flushBootstrap();
    page.onHide();
    page.onShow();
    await flushBootstrap();
    expect(page.data.viewState).toBe('submitting');
    expect(host.calls).toHaveLength(1);
    host.replyLogin(0, headquartersMe, 'synthetic-returned-binding');
    await pending;
    await flushBootstrap();
    expect(host.calls[1]).toMatchObject({
      method: 'GET', header: { Authorization: 'Bearer synthetic-returned-binding' },
    });
    host.replyMe(1, headquartersMe);
    await flushBootstrap();
    expect(host.platform.reLaunch).toHaveBeenCalledWith({ url: HEADQUARTERS_URL });
    expect(host.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  });
});
