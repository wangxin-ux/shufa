'use strict';
const fs = require('node:fs'), path = require('node:path');
const main = path.resolve(__dirname, '../..');
let mainRequire = require('node:module').createRequire(path.join(main, 'frontend/package.json'));
const vm = require('node:vm'), assert = require('node:assert/strict');
let ts;
let front = path.join(main, 'frontend'), candidate = front;
const uuid = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const account = (patch = {}) => ({ id: uuid(900), displayName: '合成总部运营', maskedPhone: '+86****0001',
  roleCode: 'OPERATOR', campusId: null, campusName: '总部', bindingStatus: 'UNBOUND', status: 'ACTIVE', version: 1,
  createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z', ...patch });
const campuses = count => Array.from({ length: count }, (_, index) => ({ id: uuid(index + 1),
  name: index ? '合成校区' + (index + 1) : '合成总部授权校区名称很长需要完整阅读并保持按钮可达',
  code: 'SYNTHETIC-' + index, timezone: 'Asia/Shanghai', contactPhone: null, address: null,
  lessonWarningThresholdUnits: 500, activeStudentCount: 0, teacherCount: 0, classCount: 0, warningStudentCount: 0 }));
const paged = (rows, page, pageSize) => ({ data: rows.slice((page - 1) * pageSize, page * pageSize),
  meta: { page, pageSize, total: rows.length, totalPages: Math.ceil(rows.length / pageSize) } });
const flush = async () => { for (let index = 0; index < 240; index++) await Promise.resolve(); };
function createHost(options = {}) {
  ts ??= mainRequire('typescript');
  const globals = ['wx', 'Page', 'getCurrentPages'].map(key => [key, Object.getOwnPropertyDescriptor(global, key)]);
  const store = new Map([['education.runtime', { dataDriver: 'api', apiBaseUrl: 'https://hq-management.example.test',
    accessToken: 'SYNTHETIC-NOT-A-CREDENTIAL', ...options.env }]]);
  let definition, page, depth = 2;
  const modules = new Map(), calls = [], modals = [], toasts = [], patches = [];
  const state = { accounts: [account()], campuses: campuses(options.campuses ?? 3), grants: [],
    results: new Map(), me: { userId: uuid(1000), roles: [{ code: 'SUPER_ADMIN', campusId: null }] },
    intercept: undefined, writes: 0 };
  const platform = {
    getStorageSync: key => store.get(key),
    getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ top: 28, height: 32, left: 294 }),
    showToast: input => toasts.push(input), showModal: input => modals.push(input),
    stopPullDownRefresh() {}, navigateBack() { state.returned = true; },
    reLaunch(input) { state.relaunched = input.url; },
    request(input) {
      // The page module runs in a separate vm realm, so its plain objects carry
      // that realm's prototypes and fail assert.deepStrictEqual against literals
      // written here. Normalise the recorded request into this realm.
      calls.push({ ...input, data: input.data === undefined ? undefined : JSON.parse(JSON.stringify(input.data)) });
      if (state.intercept?.(input)) return;
      const url = new URL(input.url), route = url.pathname, method = input.method;
      const reply = (data, statusCode = 200) => input.success({ data, statusCode });
      if (route === '/me') return reply({ data: state.me });
      const p = Number(url.searchParams.get('page') || 1), size = Number(url.searchParams.get('pageSize') || 20);
      if (route === '/management/campuses') return reply(paged(state.campuses, p, size));
      if (route === '/management/staff-accounts' && method === 'GET') {
        const query = url.searchParams.get('query') || '';
        return reply(paged(state.accounts.filter(row => !query || row.displayName.includes(query) ||
          query.includes('19900000001')), p, size));
      }
      if (route.endsWith('/campuses') && method === 'GET')
        return reply(paged([...state.grants].sort((a, b) => a.campusId.localeCompare(b.campusId)), p, size));
      const key = input.header?.['Idempotency-Key'];
      assert(key, 'Synthetic writes must carry explicit keys');
      const signature = JSON.stringify([route, input.data]), previous = state.results.get(key);
      if (previous) {
        if (previous.signature !== signature) return reply({ code: 'IDEMPOTENCY_CONFLICT' }, 409);
        return reply({ data: previous.result }, previous.status);
      }
      let result, status = 200;
      if (route === '/management/operator-headquarters') {
        status = 201;
        if (state.created) return reply({ code: 'STAFF_PHONE_ALREADY_EXISTS' }, 409);
        result = { id: uuid(901), displayName: input.data.displayName, maskedPhone: '+86****' + input.data.phone.slice(-4),
          roleCode: 'OPERATOR', campusId: null, status: 'ACTIVE', version: 1, createdAt: '2026-10-30T00:00:00.000Z' };
        state.created = result; state.accounts.push(account({ ...result }));
      } else if (route.includes('/operator-headquarters/') && method === 'PUT') {
        const userId = route.split('/')[3], campusId = route.split('/').at(-1);
        const old = state.grants.find(row => row.campusId === campusId), before = old ?? { userId, campusId, isActive: false, version: 0 };
        if (input.data.expectedVersion !== before.version) return reply({ code: 'CONFLICT' }, 409);
        result = { ...before, isActive: input.data.isActive,
          version: before.version + (before.isActive !== input.data.isActive ? 1 : 0) };
        if (old) Object.assign(old, result); else if (result.isActive) state.grants.push(result);
      } else if (/\/staff-accounts\/[^/]+\/(status|unbind-wechat)$/.test(route)) {
        const target = state.accounts.find(row => row.id === route.split('/')[3]);
        if (!target) return reply({ code: 'RESOURCE_NOT_FOUND' }, 404);
        if (input.data.expectedVersion !== target.version) return reply({ code: 'CONFLICT' }, 409);
        if (route.endsWith('/unbind-wechat') && target.maskedPhone === '未绑定个人手机号')
          return reply({ code: 'WECHAT_IDENTITY_CONFLICT' }, 409);
        result = { ...target, version: target.version + 1,
          updatedAt: '2026-10-30T01:00:00.000Z', ...(method === 'PATCH'
            ? { status: input.data.status } : { bindingStatus: 'UNBOUND' }) };
        Object.assign(target, result);
      } else if (route === '/management/staff-accounts') {
        status = 201; result = account({ ...input.data, id: uuid(902), maskedPhone: '+86****0002',
          campusName: input.data.campusId ? '合成校区' : '总部' });
        state.accounts.push(result);
      } else throw new Error('Unapproved synthetic route: ' + route);
      state.writes++;
      state.results.set(key, { signature, result, status });
      if (state.afterCommit?.(input, result)) return;
      return reply({ data: result }, status);
    },
  };
  global.wx = platform; global.Page = value => { definition = value; };
  // vm.runInThisContext() resolves free identifiers against the real V8 global,
  // which is not necessarily the jest-sandboxed `global`; mirror both.
  globalThis.wx = platform; globalThis.Page = value => { definition = value; };
  global.getCurrentPages = () => Array.from({ length: depth }, () => ({ route: 'pages/super-admin/staff-accounts/index' }));
  function load(file) {
    const relative = path.relative(front, file), replacement = path.join(candidate, relative);
    if (!fs.existsSync(file) && !fs.existsSync(replacement)) file += '.ts';
    const rel = path.relative(front, file), actual = path.join(candidate, rel);
    const physical = fs.existsSync(actual) ? actual : file;
    const key = path.resolve(file);
    if (modules.has(key)) return modules.get(key).exports;
    const module = { exports: {} }; modules.set(key, module);
    const source = fs.readFileSync(physical, 'utf8');
    if (file.endsWith('.json')) module.exports = JSON.parse(source);
    else {
      const code = ts.transpileModule(source, { fileName: physical,
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
      // The transpiled module body is evaluated by vm.runInThisContext(), whose
      // free identifiers bind to the real V8 global rather than the jest
      // sandbox, so the mini-program globals are injected as parameters.
      vm.runInThisContext(`(function(require,module,exports,Page,wx){${code}\n})`, { filename: physical })(
        name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name)) : mainRequire(name), module, module.exports,
        value => { definition = value; }, platform);
    }
    return module.exports;
  }
  return {
    state, calls, modals, store, platform, toasts, patches, load,
    get page() { return page; },
    async open() {
      load(path.join(front, 'pages/super-admin/staff-accounts/index.ts'));
      page = { ...definition, data: structuredClone(definition.data),
        setData(patch) {
          patches.push(structuredClone(patch));
          for (const [key, value] of Object.entries(patch)) {
            const indexed = /^(\w+)\[(\d+)\]$/.exec(key);
            if (indexed) this.data[indexed[1]][Number(indexed[2])] = structuredClone(value);
            else this.data[key] = structuredClone(value);
          }
        } };
      page.onLoad(); page.onShow?.(); await flush(); return page;
    },
    confirm(index = modals.length - 1) { modals[index].success({ confirm: true, cancel: false }); },
    cancel(index = modals.length - 1) { modals[index].success({ confirm: false, cancel: true }); },
    change(patch) { store.set('education.runtime', { ...store.get('education.runtime'), ...patch }); },
    async settle() { await flush(); },
    hide() { page.onHide(); }, async show() { page.onShow(); await flush(); },
    depth(value) { depth = value; },
    close() {
      page?.onUnload();
      for (const [key, descriptor] of globals)
        if (descriptor) Object.defineProperty(global, key, descriptor); else Reflect.deleteProperty(global, key);
    },
  };
}
const configureSources = (source, overlay) => { front = source; candidate = overlay;
  mainRequire = require('node:module').createRequire(path.join(source, 'package.json')); };
module.exports = { configureSources, createHost, uuid, account, campuses, paged, flush, front, candidate };
