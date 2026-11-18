import { createSuperAdminRuntimeEnv, type SuperAdminRuntimeEnv } from '../../../config/super-admin-env';
import { SessionServiceError } from '../../../services/session.service';

export interface CampusSubject { id: string; name: string; isActive: boolean; version: number }
export type SubjectLinkKind = 'CLASS' | 'PACKAGE';
export interface CampusSubjectLink {
  id: string; name: string; studentName: string | null;
  subjectId: string | null; subjectName: string | null; version: number;
}
export interface SubjectPage<T> {
  data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number };
}
export interface SubjectUpdate { name: string; isActive: boolean; expectedVersion: number }
export interface SubjectBinding { subjectId: string | null; expectedVersion: number; reason: string }
export interface SubjectBindingAck { id: string; subjectId: string | null; version: number }
export interface CampusSubjectPort {
  getSessionKey(): string;
  subjects(campusId: string, page?: number, pageSize?: number, query?: string): Promise<SubjectPage<CampusSubject>>;
  allSubjects(campusId: string, current?: () => boolean): Promise<CampusSubject[]>;
  links(campusId: string, kind: SubjectLinkKind, page?: number, query?: string): Promise<SubjectPage<CampusSubjectLink>>;
  create(campusId: string, body: { name: string }, key: string): Promise<CampusSubject>;
  update(campusId: string, id: string, body: SubjectUpdate, key: string): Promise<CampusSubject>;
  bind(campusId: string, kind: SubjectLinkKind, id: string, body: SubjectBinding, key: string): Promise<SubjectBindingAck>;
}
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, minimum = 1): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && Boolean(value.trim()) && value.length <= max;
const keyOf = (env: SuperAdminRuntimeEnv) =>
  JSON.stringify([env.dataDriver, env.apiBaseUrl.trim().replace(/\/+$/, ''), env.accessToken.trim(), env.mockScenario]);
export const campusSubjectSessionKey = () => keyOf(createSuperAdminRuntimeEnv());
function error(statusCode: number, code = 'SUBJECT_UNAVAILABLE'): SessionServiceError {
  return new SessionServiceError(statusCode, code,
    statusCode === 401 ? '登录已更新或失效，请重新登录'
      : statusCode === 403 ? '当前账号无权维护校区科目'
      : statusCode === 409 ? '记录或科目已更新，请重新读取后核对'
      : statusCode === 400 ? '科目维护参数无效，请核对'
      : statusCode === 404 ? '校区或记录不存在，请重新读取'
      : statusCode === 0 ? '网络连接失败，请重试'
      : statusCode === 502 ? '科目响应格式异常，请重试'
      : '科目服务暂时不可用，请重试');
}
function invalid(): never { throw error(502, 'INVALID_RESPONSE'); }
function parseSubject(value: unknown): CampusSubject {
  if (!record(value) || !uuid(value.id) || !text(value.name, 80) ||
    typeof value.isActive !== 'boolean' || !integer(value.version)) invalid();
  return { id: value.id, name: value.name, isActive: value.isActive, version: value.version };
}
function parseLink(value: unknown): CampusSubjectLink {
  if (!record(value) || !uuid(value.id) || !text(value.name, 200) ||
    !(value.studentName === null || typeof value.studentName === 'string') ||
    !(value.subjectId === null || uuid(value.subjectId)) ||
    !(value.subjectName === null || text(value.subjectName, 80)) || !integer(value.version)) invalid();
  return { id: value.id, name: value.name, studentName: value.studentName,
    subjectId: value.subjectId, subjectName: value.subjectName, version: value.version };
}
function parsePage<T>(value: unknown, number: number, size: number, parse: (row: unknown) => T): SubjectPage<T> {
  if (!record(value) || !Array.isArray(value.data) || !record(value.meta)) invalid();
  const meta = value.meta;
  if (meta.page !== number || meta.pageSize !== size || !integer(meta.total, 0) ||
    !integer(meta.totalPages, 0) || meta.totalPages !== Math.ceil(meta.total / size) ||
    value.data.length !== Math.max(0, Math.min(size, meta.total - (number - 1) * size))) invalid();
  const data = value.data.map(parse);
  if (new Set(data.map((row) => (row as { id: string }).id)).size !== data.length) invalid();
  return { data, meta: { page: number, pageSize: size, total: meta.total, totalPages: meta.totalPages } };
}
type MockCampus = { subjects: CampusSubject[]; CLASS: CampusSubjectLink[]; PACKAGE: CampusSubjectLink[] };
type MockStore = { campuses: Map<string, MockCampus>; receipts: Map<string, { fingerprint: string; result: unknown }>; nextId: number };
let mockSession: { key: string; store: MockStore } | undefined;
function mockCampus(store: MockStore, campusId: string, empty: boolean): MockCampus {
  let campus = store.campuses.get(campusId);
  if (!campus) {
    const subjects = empty ? [] : [
      { id: '51000000-0000-4000-8000-000000000001', name: '合成书法', isActive: true, version: 1 },
      { id: '51000000-0000-4000-8000-000000000002', name: '合成绘画', isActive: false, version: 1 },
    ];
    const links = (kind: SubjectLinkKind) => empty ? [] : Array.from({ length: 23 }, (_, index) => ({
      id: `${kind === 'CLASS' ? '52000000' : '53000000'}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: `合成${kind === 'CLASS' ? '班级' : '课包'}${index + 1}`,
      studentName: kind === 'PACKAGE' ? `合成学员${index + 1}` : null,
      subjectId: index === 0 ? subjects[1].id : null,
      subjectName: index === 0 ? subjects[1].name : null, version: 1,
    }));
    campus = { subjects, CLASS: links('CLASS'), PACKAGE: links('PACKAGE') };
    store.campuses.set(campusId, campus);
  }
  return campus;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class CampusSubjectService implements CampusSubjectPort {
  private readonly owner: string;
  private readonly store?: MockStore;
  constructor(private readonly env: SuperAdminRuntimeEnv) {
    this.owner = keyOf(env);
    if (env.dataDriver === 'mock') {
      if (mockSession?.key !== this.owner) mockSession = {
        key: this.owner, store: { campuses: new Map(), receipts: new Map(), nextId: 100 },
      };
      this.store = mockSession.store;
    } else mockSession = undefined;
  }
  getSessionKey() { return campusSubjectSessionKey() === this.owner ? this.owner : ''; }
  private check(campusId: string) {
    if (!this.getSessionKey() || (this.env.dataDriver === 'api' && !this.env.accessToken.trim())) throw error(401);
    if (this.env.dataDriver === 'api' && !this.env.apiBaseUrl.trim()) throw error(400);
    if (this.env.dataDriver === 'api' ? !uuid(campusId) : !text(campusId, 200)) throw error(400);
    if (this.env.dataDriver === 'mock' && this.env.mockScenario === 'error') throw error(500);
  }
  private path(campusId: string) { return `/management/campuses/${encodeURIComponent(campusId)}/subjects`; }
  private async send(campusId: string, path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown, key?: string): Promise<unknown> {
    this.check(campusId);
    if (method !== 'GET' && !text(key, 128)) throw error(400);
    return new Promise((resolve, reject) => {
      const denied = () => { if (!this.getSessionKey()) { reject(error(401)); return true; } return false; };
      try {
        wx.request({
          url: this.env.apiBaseUrl.trim().replace(/\/+$/, '') + path,
          method: method as WechatMiniprogram.RequestOption['method'], timeout: 15000,
          header: { Authorization: `Bearer ${this.env.accessToken.trim()}`, 'Content-Type': 'application/json',
            ...(key ? { 'Idempotency-Key': key } : {}) },
          data: body as WechatMiniprogram.IAnyObject | undefined,
          success: (response) => {
            if (denied()) return;
            if (response.statusCode < 200 || response.statusCode >= 300) {
              const code = record(response.data) && typeof response.data.code === 'string' ? response.data.code : undefined;
              reject(error(response.statusCode, code)); return;
            }
            resolve(response.data);
          },
          fail: () => { if (!denied()) reject(error(0, 'NETWORK_ERROR')); },
        });
      } catch { if (!denied()) reject(error(0, 'NETWORK_ERROR')); }
    });
  }
  async subjects(campusId: string, number = 1, size = 20, query = '') {
    this.check(campusId); this.query(number, size, query);
    if (this.store) return this.mockPage(this.campus(campusId).subjects, number, size, query);
    return parsePage(await this.send(campusId,
      `${this.path(campusId)}?page=${number}&pageSize=${size}&query=${encodeURIComponent(query)}`, 'GET'), number, size, parseSubject);
  }
  async allSubjects(campusId: string, current: () => boolean = () => true): Promise<CampusSubject[]> {
    const checkRead = () => {
      if (!current()) throw new SessionServiceError(0, 'READ_CANCELLED', '本次读取已结束');
    };
    checkRead();
    const first = await this.subjects(campusId, 1, 100);
    checkRead();
    const items = [...first.data];
    for (let number = 2; number <= first.meta.totalPages; number++) {
      const next = await this.subjects(campusId, number, 100);
      checkRead();
      if (next.meta.total !== first.meta.total) invalid();
      items.push(...next.data);
    }
    if (items.length !== first.meta.total || new Set(items.map((item) => item.id)).size !== items.length) invalid();
    return items;
  }
  async links(campusId: string, kind: SubjectLinkKind, number = 1, query = '') {
    this.check(campusId); this.kind(kind); this.query(number, 20, query);
    if (this.store) {
      const campus = this.campus(campusId);
      const rows = campus[kind].map((row) => ({
        ...row, subjectName: campus.subjects.find((subject) => subject.id === row.subjectId)?.name ?? null,
      }));
      return this.mockPage(rows, number, 20, query);
    }
    return parsePage(await this.send(campusId,
      `${this.path(campusId)}/links?kind=${kind}&page=${number}&pageSize=20&query=${encodeURIComponent(query)}`, 'GET'), number, 20, parseLink);
  }
  async create(campusId: string, body: { name: string }, key: string): Promise<CampusSubject> {
    this.check(campusId);
    if (!text(body.name, 80)) throw error(400);
    if (this.store) return this.mockMutation(campusId, 'create', body, key, () => {
      const campus = this.campus(campusId);
      if (campus.subjects.some((item) => item.name === body.name.trim().normalize('NFC'))) throw error(409);
      const result = { id: `54000000-0000-4000-8000-${String(++this.store!.nextId).padStart(12, '0')}`,
        name: body.name.trim().normalize('NFC'), isActive: true, version: 1 };
      campus.subjects.push(result); return result;
    });
    const raw = await this.send(campusId, this.path(campusId), 'POST', body, key);
    if (!record(raw)) invalid();
    return parseSubject(raw.data);
  }
  async update(campusId: string, id: string, body: SubjectUpdate, key: string): Promise<CampusSubject> {
    this.check(campusId);
    if (!uuid(id) || !text(body.name, 80) || typeof body.isActive !== 'boolean' || !integer(body.expectedVersion)) throw error(400);
    if (this.store) return this.mockMutation(campusId, `subject:${id}`, body, key, () => {
      const campus = this.campus(campusId);
      const row = campus.subjects.find((item) => item.id === id);
      if (!row) throw error(404);
      if (row.version !== body.expectedVersion ||
        campus.subjects.some((item) => item.id !== id && item.name === body.name.trim().normalize('NFC'))) throw error(409);
      Object.assign(row, { name: body.name.trim().normalize('NFC'), isActive: body.isActive, version: row.version + 1 });
      return row;
    });
    const raw = await this.send(campusId, `${this.path(campusId)}/${id}`, 'PATCH', body, key);
    if (!record(raw)) invalid();
    const row = parseSubject(raw.data);
    if (row.id !== id || row.version <= body.expectedVersion) invalid();
    return row;
  }
  async bind(campusId: string, kind: SubjectLinkKind, id: string, body: SubjectBinding, key: string): Promise<SubjectBindingAck> {
    this.check(campusId); this.kind(kind);
    if (!uuid(id) || !(body.subjectId === null || uuid(body.subjectId)) ||
      !integer(body.expectedVersion) || !text(body.reason, 200)) throw error(400);
    if (this.store) return this.mockMutation(campusId, `${kind}:${id}`, body, key, () => {
      const campus = this.campus(campusId);
      const row = campus[kind].find((item) => item.id === id);
      if (!row) throw error(404);
      const subject = campus.subjects.find((item) => item.id === body.subjectId);
      if (row.version !== body.expectedVersion || (body.subjectId !== null && !subject?.isActive)) throw error(409);
      Object.assign(row, { subjectId: body.subjectId, subjectName: subject?.name ?? null, version: row.version + 1 });
      return { id: row.id, subjectId: row.subjectId, version: row.version };
    });
    const raw = await this.send(campusId, `${this.path(campusId)}/links/${kind}/${id}`, 'PATCH', body, key);
    if (!record(raw) || !record(raw.data)) invalid();
    const ack = raw.data;
    if (ack.id !== id || ack.subjectId !== body.subjectId || !integer(ack.version) || ack.version <= body.expectedVersion) invalid();
    return { id, subjectId: body.subjectId, version: ack.version };
  }
  private campus(campusId: string) { return mockCampus(this.store!, campusId, this.env.mockScenario === 'empty'); }
  private mockPage<T extends { name: string; studentName?: string | null }>(rows: T[], number: number, size: number, query: string): SubjectPage<T> {
    const filtered = rows.filter((item) => `${item.name} ${item.studentName ?? ''}`.includes(query));
    return { data: copy(filtered.slice((number - 1) * size, number * size)),
      meta: { page: number, pageSize: size, total: filtered.length, totalPages: Math.ceil(filtered.length / size) } };
  }
  private mockMutation<T>(campusId: string, route: string, body: unknown, key: string, action: () => T): T {
    if (!text(key, 128)) throw error(400);
    const fingerprint = JSON.stringify([route, body]);
    const receiptKey = JSON.stringify([campusId, key]);
    const previous = this.store!.receipts.get(receiptKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw error(409);
      return copy(previous.result as T);
    }
    const result = copy(action());
    this.store!.receipts.set(receiptKey, { fingerprint, result }); return copy(result);
  }
  private query(number: number, size: number, query: string) {
    if (!integer(number) || !integer(size) || size > 100 || typeof query !== 'string' || query.length > 100) throw error(400);
  }
  private kind(kind: SubjectLinkKind) { if (!['CLASS', 'PACKAGE'].includes(kind)) throw error(400); }
}
export function createCampusSubjectService(): CampusSubjectPort {
  return new CampusSubjectService(createSuperAdminRuntimeEnv());
}
