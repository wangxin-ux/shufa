'use strict';
const assert = require('node:assert/strict');
const { createHost, account, uuid } = require('./super-admin-headquarters-lifecycle.host.cjs');
const input = value => ({ detail: { value } });
const event = row => ({ currentTarget: { dataset: { id: row.id, version: row.version, status: row.status } } });
const writes = host => host.calls.filter(row => ['PATCH', 'POST', 'PUT'].includes(row.method));
async function start(host, kind) {
  const page = host.page;
  if (kind === 'create') {
    if (!page.data.createOpen) page.onToggleCreate();
    page.onCreationModeChange(input('1'));
    page.onNameInput(input('合成总部')); page.onPhoneInput(input('19900000001'));
    await page.onCreate();
  } else if (kind === 'grant') {
    page.onHeadquartersAction(event(page.data.accounts[0])); await host.settle();
    page.onGrantValueChange(input(true)); page.onGrantConfirm();
  } else page[kind === 'status' ? 'onStatusAction' : 'onUnbindAction'](event(page.data.accounts[0]));
  host.confirm(); await host.settle();
}
function success(kind, request) {
  if (kind === 'create') return { statusCode: 201, data: { data: { id: uuid(901),
    displayName: request.data.displayName, maskedPhone: '+86****0001', roleCode: 'OPERATOR',
    campusId: null, status: 'ACTIVE', version: 1, createdAt: '2026-10-30T00:00:00.000Z' } } };
  if (kind === 'grant') return { statusCode: 200,
    data: { data: { userId: uuid(900), campusId: uuid(1), isActive: true, version: 1 } } };
  return { statusCode: 200, data: { data: account({ campusId: uuid(1), campusName: '合成校区', version: 2,
    status: kind === 'status' ? 'DISABLED' : 'ACTIVE', bindingStatus: kind === 'unbind' ? 'UNBOUND' : 'BOUND' }) } };
}
async function withHost(kind, operation) {
  const host = createHost();
  if (kind === 'status' || kind === 'unbind') Object.assign(host.state.accounts[0],
    { campusId: uuid(1), campusName: '合成校区', bindingStatus: 'BOUND' });
  try { await host.open(); await operation(host); } finally { host.close(); }
}
for (const kind of ['create', 'grant', 'status', 'unbind'])
  for (const change of ['token', 'api'])
    for (const reply of ['success', '403'])
      test(kind + ' releases only its superseded ' + change + ' flight; late ' + reply + ' cannot release replacement work',
        () => withHost(kind, async host => {
          const held = [];
          host.state.intercept = request => {
            if (!['PATCH', 'POST', 'PUT'].includes(request.method)) return false;
            held.push(request); return true;
          };
          await start(host, kind); assert.equal(held.length, 1);
          host.change(change === 'token' ? { accessToken: 'SYNTHETIC-FLIGHT-REPLACEMENT' }
            : { apiBaseUrl: 'https://flight-replacement.example.test' });
          host.page.onRetry(); await host.settle();
          assert.equal(host.page.data.viewState, 'success', 'Replacement session must load without the old response');
          assert.equal(host.page.data.accounts.length, 1);
          await start(host, kind); assert.equal(held.length, 2, 'Replacement session must dispatch its own confirmed command');
          const currentData = structuredClone(host.page.data), modalCount = host.modals.length;
          held[0].success(reply === '403' ? { statusCode: 403, data: { code: 'FORBIDDEN' } } : success(kind, held[0]));
          await host.settle();
          assert.deepEqual(host.page.data, currentData, 'Old response/finally must preserve replacement data and busy state');
          host.page.onStatusAction(event(host.page.data.accounts[0]));
          assert.equal(host.modals.length, modalCount, 'Replacement flight must keep command exclusion');
          assert.equal(writes(host).length, 2);
          held[1].success({ statusCode: 403, data: { code: 'FORBIDDEN' } }); await host.settle();
        }));
for (const kind of ['status', 'unbind'])
  test(kind + ' protects a new flight after the original token is used again', () => withHost(kind, async host => {
    const original = host.store.get('education.runtime').accessToken, held = [];
    host.state.intercept = request => {
      if (!['PATCH', 'POST'].includes(request.method)) return false;
      held.push(request); return true;
    };
    await start(host, kind);
    host.change({ accessToken: 'SYNTHETIC-INTERMEDIATE' }); host.page.onRetry(); await host.settle();
    host.change({ accessToken: original }); host.page.onRetry(); await host.settle();
    assert.equal(host.page.data.viewState, 'success');
    await start(host, kind); assert.equal(held.length, 2);
    const data = structuredClone(host.page.data);
    held[0].success(success(kind, held[0])); await host.settle();
    assert.deepEqual(host.page.data, data);
    const modals = host.modals.length;
    host.page.onUnbindAction(event(host.page.data.accounts[0])); assert.equal(host.modals.length, modals);
    held[1].success({ statusCode: 403, data: { code: 'FORBIDDEN' } }); await host.settle();
  }));
for (const kind of ['create', 'grant', 'status', 'unbind'])
  test(kind + ' retains same-session in-flight exclusion across hide/show without automatic writes', () => withHost(kind, async host => {
    let held;
    host.state.intercept = request => {
      if (!['PATCH', 'POST', 'PUT'].includes(request.method)) return false;
      held = request; return true;
    };
    await start(host, kind); assert(held);
    host.hide(); await host.show();
    const modals = host.modals.length;
    host.page.onStatusAction(event(host.page.data.accounts[0]));
    assert.equal(host.modals.length, modals); assert.equal(writes(host).length, 1);
    held.success({ statusCode: 403, data: { code: 'FORBIDDEN' } }); await host.settle();
  }));
