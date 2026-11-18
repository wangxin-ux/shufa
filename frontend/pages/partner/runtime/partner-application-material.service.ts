import { SessionServiceError } from '../../../services/session.service';
import type { PartnerApplicantSessionService } from './partner-applicant-session.service';
import type { PartnerApplicationStatus } from './partner-application.service';

export const MATERIAL_LABELS = {
  BUSINESS_LICENSE: '营业执照', INSTITUTION_LOGO: '机构 Logo',
  LEGAL_ID_FRONT: '法人证件正面', LEGAL_ID_BACK: '法人证件反面',
  STORE_FRONT: '门头照片', ENVIRONMENT: '环境照片',
} as const;
export type MaterialKind = keyof typeof MATERIAL_LABELS;
export interface MaterialReference { storedFileId: string; kind: MaterialKind }
export interface MaterialFile extends MaterialReference {
  mimeType: 'image/jpeg' | 'image/png'; sizeBytes: number; width: number; height: number;
}
export interface MaterialUpload extends MaterialReference {
  uploadId: string; state: 'RESERVED' | 'WRITING' | 'COMPLETED'; expectedVersion: number; requestKey: string;
}
export interface MaterialView {
  applicationId: string | null; status: PartnerApplicationStatus | null;
  version: number; readonly: boolean; materials: MaterialFile[]; uploads: MaterialUpload[];
}
export interface MaterialReceipt { applicationId: string; version: number; materialRecordId: string }
type Transport = Pick<PartnerApplicantSessionService, 'getSessionKey' | 'getReadKey' |
  'requestMaterials' | 'reserveMaterial' | 'transferMaterial' | 'downloadMaterial'>;
const uuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const kind = (value: unknown): value is MaterialKind =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(MATERIAL_LABELS, value);
function object(value: unknown, fields: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null) &&
    Reflect.ownKeys(value).length === fields.length &&
    Reflect.ownKeys(value).every((key) => typeof key === 'string' && fields.includes(key));
}
function invalid(response = true): never {
  throw new SessionServiceError(response ? 502 : 400, response ? 'INVALID_RESPONSE' : 'BAD_REQUEST',
    response ? '材料响应格式无效' : '材料请求格式无效');
}
function references(value: unknown, response = false): MaterialReference[] {
  if (!Array.isArray(value) || value.length > 14) invalid(response);
  const counts = new Map<string, number>();
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    if (!object(item, ['storedFileId', 'kind']) || !uuid(item.storedFileId) || !kind(item.kind) ||
        ids.has(item.storedFileId)) invalid(response);
    ids.add(item.storedFileId);
    const count = (counts.get(item.kind) ?? 0) + 1;
    if (count > (item.kind === 'ENVIRONMENT' ? 9 : 1)) invalid(response);
    counts.set(item.kind, count);
    return { storedFileId: item.storedFileId, kind: item.kind };
  });
}
function file(value: unknown): MaterialFile {
  if (!object(value, ['storedFileId', 'kind', 'mimeType', 'sizeBytes', 'width', 'height']) ||
      !uuid(value.storedFileId) || !kind(value.kind) ||
      !['image/jpeg', 'image/png'].includes(value.mimeType as string) ||
      !integer(value.sizeBytes, 1, 3 * 1024 * 1024) ||
      !integer(value.width, 1, 8192) || !integer(value.height, 1, 8192) ||
      value.width * value.height > 16_777_216) invalid();
  return value as unknown as MaterialFile;
}
function upload(value: unknown): MaterialUpload {
  if (!object(value, ['uploadId', 'storedFileId', 'kind', 'state', 'expectedVersion', 'requestKey']) ||
      !uuid(value.uploadId) || !uuid(value.storedFileId) || !uuid(value.requestKey) || !kind(value.kind) ||
      !integer(value.expectedVersion, 1, 2_147_483_647) ||
      !['RESERVED', 'WRITING', 'COMPLETED'].includes(value.state as string)) invalid();
  return value as unknown as MaterialUpload;
}
function view(value: unknown): MaterialView {
  if (!object(value, ['applicationId', 'status', 'version', 'readonly', 'materials', 'uploads']) ||
      !integer(value.version, 0, 2_147_483_647) || typeof value.readonly !== 'boolean' ||
      !Array.isArray(value.materials) || value.materials.length > 14 ||
      !Array.isArray(value.uploads) || value.uploads.length > 3) invalid();
  if (value.applicationId === null) {
    if (value.version !== 0 || value.status !== null || value.materials.length || value.uploads.length) invalid();
  } else if (!uuid(value.applicationId) || !value.version ||
      !['DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED'].includes(value.status as string) ||
      (value.status !== 'DRAFT' && !value.readonly)) invalid();
  const materials = value.materials.map(file);
  references(materials.map(({ storedFileId, kind }) => ({ storedFileId, kind })), true);
  const uploads = value.uploads.map(upload);
  if (new Set(uploads.map((item) => item.uploadId)).size !== uploads.length ||
      new Set(uploads.map((item) => item.storedFileId)).size !== uploads.length) invalid();
  return { ...value, materials, uploads } as unknown as MaterialView;
}
function receipt(value: unknown): MaterialReceipt {
  if (!object(value, ['applicationId', 'version', 'materialRecordId']) || !uuid(value.applicationId) ||
      !uuid(value.materialRecordId) || !integer(value.version, 1, 2_147_483_647)) invalid();
  return value as unknown as MaterialReceipt;
}

export class PartnerApplicationMaterialService {
  private readonly reads = new Map<string, Promise<MaterialView>>();
  private readonly writes = new Map<string, { signature: string; promise: Promise<unknown> }>();
  constructor(private readonly sessions: Transport) {}
  load(): Promise<MaterialView> {
    const session = this.sessions.getSessionKey();
    if (!session) return Promise.reject(this.unauthorized());
    const key = this.sessions.getReadKey();
    const existing = this.reads.get(key);
    if (existing) return existing;
    const pending = this.sessions.requestMaterials('GET').then((value) => {
      this.assertCurrent(session);
      if (key !== this.sessions.getReadKey()) throw new SessionServiceError(409, 'READ_SUPERSEDED', '申请读取已更新');
      return view(value);
    }).finally(() => { if (this.reads.get(key) === pending) this.reads.delete(key); });
    this.reads.set(key, pending);
    return pending;
  }
  reserve(expectedVersion: number, materialKind: MaterialKind, requestKey: string): Promise<MaterialUpload> {
    if (!integer(expectedVersion, 1, 2_147_483_647) || !kind(materialKind) || !uuid(requestKey))
      return Promise.reject(new SessionServiceError(400, 'BAD_REQUEST', '请先保存机构信息'));
    const input = { expectedVersion, kind: materialKind, requestKey };
    return this.write(`reserve:${JSON.stringify(input)}`, () => this.sessions.reserveMaterial(input).then((value) => {
      const result = upload(value);
      if (result.expectedVersion !== expectedVersion || result.kind !== materialKind || result.requestKey !== requestKey) invalid();
      return result;
    }));
  }
  upload(intent: MaterialUpload, filePath: string): Promise<MaterialFile> {
    if (!filePath.trim()) return Promise.reject(new SessionServiceError(400, 'BAD_REQUEST', '请选择原图片'));
    return this.write(`upload:${intent.uploadId}:${filePath}`, () =>
      this.sessions.transferMaterial(intent.uploadId, filePath).then((value) => {
        const result = file(value);
        if (result.storedFileId !== intent.storedFileId || result.kind !== intent.kind) invalid();
        return result;
      }));
  }
  save(expectedVersion: number, input: MaterialReference[]): Promise<MaterialReceipt> {
    let materials: MaterialReference[];
    try {
      if (!integer(expectedVersion, 1, 2_147_483_647)) invalid(false);
      materials = references(input);
    } catch (error) { return Promise.reject(error); }
    const data = { expectedVersion, materials };
    return this.write(`save:${JSON.stringify(data)}`, () => this.sessions.requestMaterials('PUT', data).then(receipt));
  }
  async preview(storedFileId: string): Promise<string> {
    if (!uuid(storedFileId)) invalid(false);
    const key = this.sessions.getSessionKey();
    if (!key) throw this.unauthorized();
    const readKey = this.sessions.getReadKey();
    const path = await this.sessions.downloadMaterial(storedFileId);
    this.assertCurrent(key);
    if (readKey !== this.sessions.getReadKey()) throw new SessionServiceError(409, 'READ_SUPERSEDED', '申请读取已更新');
    return path;
  }
  private write<T>(signature: string, action: () => Promise<T>): Promise<T> {
    const key = this.sessions.getSessionKey();
    if (!key) return Promise.reject(this.unauthorized());
    const existing = this.writes.get(key);
    if (existing) return existing.signature === signature ? existing.promise as Promise<T> : Promise.reject(
      new SessionServiceError(409, 'SAVE_IN_PROGRESS', '材料正在处理'),
    );
    const pending = Promise.resolve().then(() => {
      this.assertCurrent(key);
      return action();
    }).then((result) => {
      this.assertCurrent(key); return result;
    }).finally(() => { if (this.writes.get(key)?.promise === pending) this.writes.delete(key); });
    this.writes.set(key, { signature, promise: pending });
    return pending;
  }
  private assertCurrent(key: string) {
    if (key !== this.sessions.getSessionKey()) throw new SessionServiceError(409, 'SESSION_SUPERSEDED', '申请会话已更新');
  }
  private unauthorized() { return new SessionServiceError(401, 'UNAUTHORIZED', '请先登录入驻申请'); }
}

export function newMaterialRequestKey(): Promise<string> {
  return new Promise((resolve, reject) => wx.getRandomValues({
    length: 16,
    success: (result) => {
      const bytes = new Uint8Array(result.randomValues);
      if (bytes.length !== 16) { reject(new Error('未获取到上传请求编号')); return; }
      bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
      resolve(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
    }, fail: () => reject(new Error('未获取到上传请求编号，请重试')),
  }));
}
