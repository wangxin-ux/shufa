'use strict';
const assert = require('node:assert/strict');
const { createHost, account, uuid } = require('./super-admin-headquarters-lifecycle.host.cjs');
const writes = host => host.calls.filter(row => ['PATCH', 'POST', 'PUT'].includes(row.method));
// The page module is evaluated in a separate vm realm, so its objects carry
// foreign prototypes that trip deepStrictEqual even when the values match.
// Comparing serialised form keeps the check exact without the realm.
const same = (actual, expected) => assert.deepEqual(
  JSON.parse(JSON.stringify(actual ?? null)), JSON.parse(JSON.stringify(expected ?? null)));
const event = row => ({ currentTarget: { dataset: { id: row.id, version: row.version, status: row.status } } });
const input = value => ({ detail: { value } });
async function withHost(operation, options) {
  const host = createHost(options);
  host.state.accounts[0].bindingStatus = 'BOUND';
  try { await host.open(); await operation(host); } finally { host.close(); }
}
async function status(host) {
  const count = host.modals.length;
  host.page.onStatusAction(event(host.page.data.accounts[0])); assert.equal(host.modals.length, count + 1);
  host.confirm(); await host.settle();
}
async function unbind(host) {
  const count = host.modals.length;
  host.page.onUnbindAction(event(host.page.data.accounts[0])); assert.equal(host.modals.length, count + 1);
  host.confirm(); await host.settle();
}
for (const kind of ['status', 'unbind'])
  test('HQ ' + kind + ': current row, explicit confirmation, stable contract payload and retained grants', () => withHost(async host => {
    host.state.grants = [{ userId: uuid(900), campusId: uuid(1), isActive: true, version: 2 }];
    const row = host.page.data.accounts[0], before = structuredClone(host.state.grants);
    host.page[kind === 'status' ? 'onStatusAction' : 'onUnbindAction'](event(row));
    assert.equal(host.modals.length, 1); assert.equal(writes(host).length, 0);
    host.confirm(); host.confirm(); await host.settle();
    assert.equal(writes(host).length, 1); assert.equal(host.state.writes, 1);
    same(writes(host)[0].data, kind === 'status' ? { status: 'DISABLED', expectedVersion: 1 } : { expectedVersion: 1 });
    assert.equal(writes(host)[0].method, kind === 'status' ? 'PATCH' : 'POST');
    assert.equal(host.page.data.accounts[0].version, 2);
    assert.equal(host.page.data.accounts[0][kind === 'status' ? 'status' : 'bindingStatus'], kind === 'status' ? 'DISABLED' : 'UNBOUND');
    same(host.state.grants, before);
    if (kind === 'status') { await status(host); assert.equal(host.page.data.accounts[0].status, 'ACTIVE'); }
  }));
test('HQ cancellation consumes the confirmation and cannot dispatch later', () => withHost(async host => {
  host.page.onStatusAction(event(host.page.data.accounts[0]));
  assert.equal(host.modals.length, 1); host.cancel(); host.confirm(); await host.settle();
  assert.equal(writes(host).length, 0);
}));
test('Lifecycle confirmation excludes ordinary/HQ writes, creation, search and paging', () => withHost(async host => {
  const page = host.page; page.onToggleCreate(); page.onNameInput(input('合成普通账号')); page.onPhoneInput(input('19900000002'));
  page.onStatusAction(event(page.data.accounts[0])); assert.equal(host.modals.length, 1);
  const before = host.calls.length;
  page.onUnbindAction(event(page.data.accounts[0])); page.onHeadquartersAction(event(page.data.accounts[0]));
  page.onCreate(); page.onSearch(); page.onNextPage(); page.onRetry(); await host.settle();
  assert.equal(host.calls.length, before); assert.equal(host.modals.length, 1);
  host.confirm(); await host.settle(); assert.equal(writes(host).length, 1);
}));
test('An existing grant confirmation excludes lifecycle and ordinary creation', () => withHost(async host => {
  host.page.onHeadquartersAction(event(host.page.data.accounts[0])); await host.settle();
  host.page.onGrantValueChange(input(true)); host.page.onGrantConfirm(); assert.equal(host.modals.length, 1);
  host.page.onStatusAction(event(host.page.data.accounts[0])); host.page.onCreate();
  assert.equal(host.modals.length, 1); host.confirm(); await host.settle(); assert.equal(writes(host).length, 1);
  assert.equal(writes(host)[0].method, 'PUT');
}));
for (const kind of ['status', 'unbind'])
  test('Lost ' + kind + ' receipt reconciles without inferring success, then explicitly retries the exact original', () => withHost(async host => {
    let once = false;
    host.state.afterCommit = request => {
      if (once) return false; once = true; request.fail({ errMsg: 'synthetic committed response lost' }); return true;
    };
    await (kind === 'status' ? status : unbind)(host);
    assert.equal(writes(host).length, 1); assert.equal(host.page.data.lifecycleUncertain, true);
    assert.equal(host.page.data.lifecycleReconciled, true);
    const first = writes(host)[0];
    assert(host.calls.slice(host.calls.indexOf(first) + 1).some(row => row.method === 'GET' && row.url.includes('/staff-accounts')));
    await statusNoConfirm(host); assert.equal(writes(host).length, 1);
    host.page.onLifecycleRetry(); assert.equal(writes(host).length, 1);
    host.confirm(); await host.settle(); assert.equal(writes(host).length, 2);
    same(writes(host)[1].data, first.data);
    assert.equal(writes(host)[1].header['Idempotency-Key'], first.header['Idempotency-Key']);
    assert.equal(host.page.data.lifecycleUncertain, false); assert.equal(host.state.writes, 1);
  }));
test('Replaying an old receipt cannot replace newer authoritative status or version', () => withHost(async host => {
  host.state.afterCommit = (request, receipt) => {
    host.state.afterCommit = undefined;
    Object.assign(host.state.accounts[0], { status: 'ACTIVE', version: receipt.version + 1 });
    request.fail({ errMsg: 'synthetic receipt lost' }); return true;
  };
  await status(host); assert.equal(host.page.data.lifecycleUncertain, true);
  host.page.onLifecycleRetry(); host.confirm(); await host.settle();
  assert.equal(host.page.data.accounts[0].status, 'ACTIVE'); assert.equal(host.page.data.accounts[0].version, 3);
}));
for (const refreshFails of [false, true])
  test('409 refresh ' + (refreshFails ? 'failure bars stale versions until explicit read succeeds' : 'installs authoritative state without auto write'), () => withHost(async host => {
    host.state.accounts[0].version = 8;
    if (refreshFails) host.state.intercept = request => {
      if (request.method === 'GET' && request.url.includes('/staff-accounts')) {
        request.success({ statusCode: 503, data: {} }); return true;
      } return false;
    };
    await status(host); assert.equal(writes(host).length, 1); assert.equal(host.page.data.lifecycleConflict, true);
    if (!refreshFails) assert.equal(host.page.data.accounts[0].version, 8);
    else {
      assert.equal(host.page.data.lifecycleStale, true);
      await statusNoConfirm(host); host.page.onCreate(); host.page.onHeadquartersAction(event(host.page.data.accounts[0]));
      assert.equal(writes(host).length, 1); assert.equal(host.modals.length, 1);
      host.state.intercept = undefined; host.page.onLifecycleReconcile(); await host.settle();
      assert.equal(host.page.data.lifecycleStale, false); assert.equal(host.page.data.accounts[0].version, 8);
      assert.match(host.page.data.lifecycleMessage, /已读取最新状态/);
      assert.doesNotMatch(host.page.data.lifecycleMessage, /服务器处理失败/);
    }
  }));
test('Unknown result with failed read cannot offer or dispatch original retry', () => withHost(async host => {
  host.state.intercept = request => {
    if (request.method === 'PATCH') { request.fail({ errMsg: 'synthetic lost' }); return true; }
    if (request.url.includes('/staff-accounts')) { request.success({ statusCode: 503, data: {} }); return true; }
    return false;
  };
  await status(host); assert.equal(host.page.data.lifecycleUncertain, true); assert.equal(host.page.data.lifecycleReconciled, false);
  const count = host.modals.length; host.page.onLifecycleRetry(); assert.equal(host.modals.length, count);
}));
for (const code of [401, 403])
  test('Current lifecycle denial ' + code + ' clears all private data and retained commands', () => withHost(async host => {
    host.state.intercept = request => {
      if (request.method === 'PATCH') { request.success({ statusCode: code, data: { code: 'FORBIDDEN' } }); return true; }
      return false;
    };
    await status(host); assert.equal(host.page.data.viewState, 'forbidden');
    same(host.page.data.accounts, []); same(host.page.data.hqRows, []);
    assert.equal(host.page.data.lifecycleUncertain, false); assert.equal(host.page.data.lifecycleTarget, null);
  }));
for (const change of ['hide', 'unload', 'token', 'api', 'driver', 'logout', 'identity', 'roles'])
  test('An old lifecycle confirmation is invalidated by ' + change, () => withHost(async host => {
    host.page.onStatusAction(event(host.page.data.accounts[0])); assert.equal(host.modals.length, 1);
    if (change === 'hide') { host.hide(); await host.show(); }
    else if (change === 'unload') host.page.onUnload();
    else if (change === 'logout') host.store.set('education.session.logged-out', true);
    else if (change === 'identity') host.state.me.userId = uuid(1001);
    else if (change === 'roles') host.state.me.roles.push({ code: 'HR', campusId: null });
    else host.change(change === 'token' ? { accessToken: 'SYNTHETIC-NEXT' } :
      change === 'api' ? { apiBaseUrl: 'https://next.example.test' } : { dataDriver: 'mock' });
    host.confirm(); await host.settle(); assert.equal(writes(host).length, 0);
  }));
for (const code of [200, 401, 403])
  test('Late ' + code + ' lifecycle reply cannot clear or populate a replacement session', () => withHost(async host => {
    let held;
    host.state.intercept = request => { if (request.method !== 'PATCH') return false; held = request; return true; };
    host.page.onStatusAction(event(host.page.data.accounts[0])); assert.equal(host.modals.length, 1);
    host.confirm(); await host.settle(); assert(held);
    host.hide(); host.change({ accessToken: 'SYNTHETIC-REPLACEMENT' }); host.state.intercept = undefined; await host.show();
    const before = structuredClone(host.page.data);
    held.success({ statusCode: code, data: code === 200 ? { data: account({ status: 'DISABLED', version: 2 }) } : { code: 'FORBIDDEN' } });
    await host.settle(); same(host.page.data, before); assert.equal(host.page.data.viewState, 'success');
  }));
for (const change of ['token', 'api'])
  test('Foreground ' + change + ' replacement can reload before the superseded lifecycle flight replies', () => withHost(async host => {
    let held;
    host.state.intercept = request => { if (request.method !== 'PATCH') return false; held = request; return true; };
    host.page.onStatusAction(event(host.page.data.accounts[0])); host.confirm(); await host.settle(); assert(held);
    host.change(change === 'token' ? { accessToken: 'SYNTHETIC-FOREGROUND-NEXT' } : { apiBaseUrl: 'https://foreground-next.example.test' });
    host.state.intercept = undefined; host.page.onRetry(); await host.settle();
    assert.equal(host.page.data.viewState, 'success'); assert.equal(host.page.data.accounts.length, 1);
    assert.equal(host.page.data.lifecycleLocked, false);
    const before = structuredClone(host.page.data);
    held.success({ statusCode: 403, data: { code: 'FORBIDDEN' } }); await host.settle();
    same(host.page.data, before);
  }));
test('Same-session hide/show keeps only an uncertain in-memory command and never automatically writes', () => withHost(async host => {
  let held;
  host.state.intercept = request => { if (request.method !== 'PATCH') return false; held = request; return true; };
  host.page.onStatusAction(event(host.page.data.accounts[0])); assert.equal(host.modals.length, 1);
  host.confirm(); await host.settle(); assert(held); host.hide(); await host.show();
  held.fail({ errMsg: 'synthetic ended flight' }); await host.settle();
  assert.equal(writes(host).length, 1); assert.equal(host.page.data.lifecycleUncertain, true);
  assert.equal(host.page.data.lifecycleReconciled, true); assert.equal(host.store.size, 1);
}));
test('Ordinary create, status, unbind and pagination retain their existing service endpoints', () => withHost(async host => {
  host.state.accounts = Array.from({ length: 101 }, (_, i) => account({ id: uuid(2000 + i),
    campusId: uuid(1), campusName: '合成校区', bindingStatus: 'BOUND' }));
  await host.page.loadAccounts(); await host.page.onNextPage(); assert.equal(host.page.data.page, 2);
  await host.page.onPreviousPage(); await status(host); await unbind(host);
  host.page.onToggleCreate(); host.page.onNameInput(input('合成普通')); host.page.onPhoneInput(input('19900000002'));
  host.page.onRoleChange(input('4')); await host.page.onCreate(); await host.settle();
  const request = writes(host).at(-1); assert.equal(new URL(request.url).pathname, '/management/staff-accounts');
  assert.equal(request.data.campusId, uuid(1)); assert.equal(request.data.roleCode, 'OPERATOR');
}));
test('Phone-less partner unbind stays forbidden', () => withHost(async host => {
  host.state.accounts[0] = account({ roleCode: 'PARTNER', campusId: uuid(1), maskedPhone: '未绑定个人手机号', bindingStatus: 'BOUND' });
  await host.page.loadAccounts(); host.page.onUnbindAction(event(host.page.data.accounts[0]));
  assert.equal(host.modals.length, 0); assert.equal(writes(host).length, 0);
}));
test('HQ creation and grants remain functional before lifecycle commands', () => withHost(async host => {
  const page = host.page; page.onToggleCreate(); page.onCreationModeChange(input('1'));
  page.onNameInput(input('合成总部新账号')); page.onPhoneInput(input('19900000001'));
  page.onCreate(); host.confirm(); await host.settle(); assert.equal(page.data.hqReady, true);
  page.onGrantValueChange(input(true)); page.onGrantConfirm(); host.confirm(); await host.settle();
  assert.equal(page.data.hqSelected.version, 1);
  const row = page.data.accounts.find(row => row.id === uuid(901));
  page.onStatusAction(event(row)); host.confirm(); await host.settle();
  assert.equal(page.data.hqTarget.status, 'DISABLED'); assert.equal(page.data.hqSelected.isActive, true);
}));
test('Explicit local Mock supports HQ enable/disable/unbind in memory with no HTTP or storage writes', () => withHost(async host => {
  const page = host.page; page.onToggleCreate(); page.onCreationModeChange(input('1'));
  page.onNameInput(input('合成总部本地')); page.onPhoneInput(input('19900000001'));
  page.onCreate(); host.confirm(); await host.settle();
  let row = page.data.accounts.find(row => row.headquartersOperator); assert(row);
  page.onStatusAction(event(row)); assert.equal(host.modals.length, 2); host.confirm(); await host.settle();
  const id = row.id; row = page.data.accounts.find(current => current.id === id);
  assert.equal(row.status, 'DISABLED'); assert.equal(host.calls.length, 0); assert.equal(host.store.size, 1);
  page.onStatusAction(event(row)); host.confirm(); await host.settle();
  row = page.data.accounts.find(current => current.id === id);
  assert.equal(row.status, 'ACTIVE'); assert.equal(row.bindingStatus, 'UNBOUND'); assert.equal(row.version, 3);
  page.onUnbindAction(event(row)); assert.equal(host.modals.length, 3);
}, { env: { dataDriver: 'mock', enableTestAccountSwitcher: true, mockWechatAccount: 'SUPER_ADMIN' } }));
for (const patch of [{ campusId: undefined }, { campusId: '' }, { roles: [{ code: 'OPERATOR', campusId: null }] },
  { roleCode: 'SUPER_ADMIN' }, { bindingStatus: 'UNKNOWN' }])
  test('Malformed scope/binding cannot be treated as a manageable HQ target: ' + JSON.stringify(patch), () => withHost(async host => {
    host.state.accounts[0] = account({ ...patch, bindingStatus: patch.bindingStatus ?? 'BOUND' });
    await host.page.loadAccounts();
    host.page.onStatusAction(event(host.page.data.accounts[0])); host.page.onUnbindAction(event(host.page.data.accounts[0]));
    assert.equal(host.modals.length, 0); assert.equal(writes(host).length, 0);
  }));
for (const roles of [[{ code: 'OPERATOR', campusId: null }], [{ code: 'SUPER_ADMIN' }],
  [{ code: 'SUPER_ADMIN', campusId: '' }], [{ code: 'SUPER_ADMIN', campusId: uuid(1) }],
  [{ code: 'SUPER_ADMIN', campusId: null }, { code: 'HR', campusId: null }]])
  test('Lifecycle management requires exact current exclusive null-campus SUPER_ADMIN: ' + JSON.stringify(roles), () => withHost(async host => {
    host.state.me.roles = roles; await host.page.loadAccounts();
    assert.equal(host.page.data.viewState, 'forbidden'); same(host.page.data.accounts, []);
    assert.equal(writes(host).length, 0);
  }));
async function statusNoConfirm(host) { host.page.onStatusAction(event(host.page.data.accounts[0])); await host.settle(); }
