import {
  MATERIAL_LABELS, newMaterialRequestKey, type MaterialFile, type MaterialKind,
  type MaterialUpload, type PartnerApplicationMaterialService,
} from './partner-application-material.service';

type UploadRow = MaterialUpload & { label: string };
type FileRow = MaterialFile & { localPath: string; saved: boolean; label: string };
type Row = { kind: MaterialKind; title: string; files: FileRow[]; full: boolean };
const signature = (files: MaterialFile[]) => JSON.stringify(files.map(({ storedFileId, kind }) => ({ storedFileId, kind })));
const rows = (files: MaterialFile[] = [], paths = new Map<string, string>(), saved = new Set<string>()): Row[] =>
  (Object.keys(MATERIAL_LABELS) as MaterialKind[]).map((kind) => ({
    kind, title: MATERIAL_LABELS[kind],
    files: files.filter((file) => file.kind === kind).map((file, index) => ({
      ...file, localPath: paths.get(file.storedFileId) ?? '', saved: saved.has(file.storedFileId),
      label: `${index + 1} · ${Math.ceil(file.sizeBytes / 1024)}KB`,
    })),
    full: kind === 'ENVIRONMENT' && files.filter((file) => file.kind === kind).length >= 9,
  }));
export const materialEditorData = () => ({
  materialsOpen: false, materialsLoaded: false, materialsLoading: false, materialsWorking: false,
  materialsVersion: 0, materialsReadonly: false, materialsDirty: false,
  materialsNeedsRefresh: false, materialsMessage: '', materialsPending: false,
  materialsDraft: [] as MaterialFile[], materialsRows: rows(), materialsUploads: [] as UploadRow[],
});
interface Host {
  data: ReturnType<typeof materialEditorData> & { readonly: boolean; formalArchive: boolean };
  runtime?: { materials?: PartnerApplicationMaterialService; sessions: { getSessionKey(): string } };
  ownerKey: string;
  active(): boolean;
  materialsBlocked(): boolean;
  setData(patch: Partial<ReturnType<typeof materialEditorData>>): void;
  clearPrivate(message?: string): void;
  syncUnloadAlert(): void;
  loadDraft(preserve?: boolean): Promise<void>;
}
interface Selection {
  kind: MaterialKind; filePath: string; requestKey: string; expectedVersion: number; intent?: MaterialUpload;
}
const status = (error: unknown) => error && typeof error === 'object' && 'statusCode' in error
  ? Number(error.statusCode) : 0;

export class PartnerApplicationMaterialEditor {
  private generation = 0;
  private saved = signature([]);
  private savedIds = new Set<string>();
  private readonly paths = new Map<string, string>();
  private reading?: Promise<void>;
  private working?: Promise<void>;
  private selection?: Selection;
  constructor(private readonly host: Host) {}
  get busy() { return Boolean(this.working); }
  invalidate() { ++this.generation; this.reading = undefined; }
  clear() {
    this.invalidate(); this.working = undefined; this.selection = undefined;
    this.saved = signature([]); this.savedIds.clear(); this.paths.clear();
    this.host.setData(materialEditorData());
  }
  resume(): Promise<void> {
    if (this.working) return this.working.then(() => this.resume());
    if (!this.host.active()) return Promise.resolve();
    this.host.setData({ materialsLoading: false, materialsWorking: false });
    this.sync();
    return this.host.data.materialsOpen ? this.load(true) : Promise.resolve();
  }
  toggle() {
    if (!this.available() || this.busy || this.reading) return;
    this.host.setData({ materialsOpen: !this.host.data.materialsOpen });
    if (this.host.data.materialsOpen) void this.load(true);
  }
  load(preserve = false): Promise<void> {
    if (!this.available() || this.busy) return Promise.resolve();
    if (this.reading) return this.reading;
    const generation = ++this.generation;
    const key = this.host.ownerKey;
    const retain = preserve && this.host.data.materialsDirty;
    this.host.setData({ materialsLoading: true, materialsMessage: '' });
    const pending = Promise.resolve().then(() => {
      if (this.current(generation, key)) return this.host.runtime!.materials!.load();
    }).then((view) => {
      if (!view || !this.current(generation, key)) return;
      this.saved = signature(view.materials);
      this.savedIds = new Set(view.materials.map((file) => file.storedFileId));
      if (view.readonly || this.host.data.readonly) {
        this.selection = undefined; this.paths.clear();
      } else if (this.selection) {
        const intent = view.uploads.find((item) => item.requestKey === this.selection!.requestKey);
        if (intent) this.selection.intent = intent;
        else if (!this.selection.intent) this.selection.expectedVersion = view.version;
      }
      this.host.setData({
        materialsDraft: retain && !view.readonly && !this.host.data.readonly
          ? [...this.host.data.materialsDraft] : view.materials,
        materialsUploads: view.uploads.map((item) => ({ ...item, label: MATERIAL_LABELS[item.kind] })),
        materialsVersion: view.version, materialsReadonly: view.readonly, materialsLoaded: true,
        materialsNeedsRefresh: false, materialsMessage: '',
      });
      this.sync();
    }).catch((error: unknown) => {
      if (this.current(generation, key)) this.failure(error);
    }).finally(() => {
      if (this.reading === pending) this.reading = undefined;
      if (this.current(generation, key)) this.host.setData({ materialsLoading: false });
    });
    this.reading = pending;
    return pending;
  }
  choose(kind: string): Promise<void> {
    if (!this.editable() || !Object.prototype.hasOwnProperty.call(MATERIAL_LABELS, kind) ||
        this.selection || !this.host.data.materialsVersion) return Promise.resolve();
    if (kind === 'ENVIRONMENT' && this.host.data.materialsDraft.filter((file) => file.kind === kind).length >= 9)
      return Promise.resolve();
    return this.run(async (generation, key) => {
      const chosen = await this.chooseImage();
      if (!chosen || !this.owned(key)) return;
      const requestKey = await newMaterialRequestKey();
      if (!this.owned(key)) return;
      this.selection = { kind: kind as MaterialKind, filePath: chosen,
        requestKey, expectedVersion: this.host.data.materialsVersion };
      if (!this.current(generation, key)) return;
      this.sync();
      await this.transfer(generation, key);
    });
  }
  retry(): Promise<void> {
    if (!this.editable() || !this.selection) return Promise.resolve();
    return this.run((generation, key) => this.transfer(generation, key));
  }
  recover(id: string): Promise<void> {
    if (!this.editable() || this.selection) return Promise.resolve();
    const intent = this.host.data.materialsUploads.find((item) => item.uploadId === id);
    if (!intent) return Promise.resolve();
    return this.run(async (generation, key) => {
      const chosen = await this.chooseImage();
      if (!chosen || !this.owned(key)) return;
      this.selection = { kind: intent.kind, filePath: chosen, requestKey: intent.requestKey,
        expectedVersion: intent.expectedVersion, intent };
      if (!this.current(generation, key)) return;
      this.sync();
      await this.transfer(generation, key);
    });
  }
  remove(id: string) {
    if (!this.editable() || this.selection) return;
    this.host.setData({ materialsDraft: this.host.data.materialsDraft.filter((file) => file.storedFileId !== id), materialsMessage: '' });
    this.sync();
  }
  save(): Promise<void> {
    if (!this.editable() || this.selection || !this.host.data.materialsVersion) return Promise.resolve();
    let saved = false;
    let generation = 0;
    const key = this.host.ownerKey;
    const files = [...this.host.data.materialsDraft];
    return this.run(async (sequence, owner) => {
      generation = sequence;
      const receipt = await this.host.runtime!.materials!.save(this.host.data.materialsVersion,
        files.map(({ storedFileId, kind }) => ({ storedFileId, kind })));
      if (!this.current(sequence, owner)) return;
      this.saved = signature(files);
      this.savedIds = new Set(files.map((file) => file.storedFileId));
      this.host.setData({ materialsVersion: receipt.version, materialsMessage: '材料草稿已保存' });
      this.sync();
      saved = true;
    }).then(async () => {
      if (saved && this.current(generation, key)) await this.host.loadDraft(true);
    });
  }
  preview(id: string): Promise<void> {
    if (!this.available() || this.busy || this.reading || !this.host.data.materialsLoaded) return Promise.resolve();
    const file = this.host.data.materialsDraft.find((item) => item.storedFileId === id);
    if (!file) return Promise.resolve();
    return this.run(async (generation, key) => {
      const path = this.savedIds.has(id) ? await this.host.runtime!.materials!.preview(id) : this.paths.get(id);
      if (!this.current(generation, key)) return;
      if (!path) throw new Error('请先保存材料后预览');
      await new Promise<void>((resolve, reject) => wx.previewImage({
        current: path, urls: [path], success: () => resolve(), fail: () => reject(new Error('材料预览未打开，请重试')),
      }));
    });
  }
  private async transfer(generation: number, key: string) {
    const selection = this.selection!;
    if (!selection.intent) {
      const intent = await this.host.runtime!.materials!.reserve(selection.expectedVersion, selection.kind, selection.requestKey);
      if (!this.owned(key)) return;
      selection.intent = intent;
    }
    if (!this.current(generation, key)) return;
    const file = await this.host.runtime!.materials!.upload(selection.intent, selection.filePath);
    if (!this.current(generation, key)) return;
    const existing = this.host.data.materialsDraft.filter((item) =>
      item.storedFileId !== file.storedFileId && (file.kind === 'ENVIRONMENT' || item.kind !== file.kind));
    this.paths.set(file.storedFileId, selection.filePath);
    this.selection = undefined;
    const uploads = this.host.data.materialsUploads.filter((item) => item.uploadId !== selection.intent!.uploadId);
    this.host.setData({
      materialsDraft: [...existing, file], materialsMessage: '材料已上传，尚未保存',
      materialsUploads: [...uploads, { ...selection.intent, state: 'COMPLETED', label: MATERIAL_LABELS[file.kind] }],
    });
    this.sync();
  }
  private run(action: (generation: number, key: string) => Promise<void>): Promise<void> {
    const generation = ++this.generation;
    const key = this.host.ownerKey;
    this.host.setData({ materialsWorking: true, materialsMessage: '' });
    const pending = Promise.resolve().then(() => {
      if (this.current(generation, key)) return action(generation, key);
    }).catch((error: unknown) => {
      if (this.current(generation, key)) this.failure(error);
    }).finally(() => {
      if (this.working === pending) this.working = undefined;
      if (this.current(generation, key)) {
        this.host.setData({ materialsWorking: false }); this.sync();
      }
    });
    this.working = pending;
    return pending;
  }
  private chooseImage(): Promise<string | undefined> {
    return new Promise((resolve, reject) => wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['original'],
      success: (result) => {
        const selected = result.tempFiles[0];
        if (!selected?.tempFilePath || selected.size < 1 || selected.size > 3 * 1024 * 1024) {
          reject(new Error('请选择单张不超过 3MB 的图片')); return;
        }
        resolve(selected.tempFilePath);
      },
      fail: (error) => /cancel/i.test(error.errMsg) ? resolve(undefined) : reject(new Error('选择图片失败，请重试')),
    }));
  }
  private sync() {
    this.host.setData({
      materialsDirty: Boolean(this.selection) || signature(this.host.data.materialsDraft) !== this.saved,
      materialsPending: Boolean(this.selection),
      materialsRows: rows(this.host.data.materialsDraft, this.paths, this.savedIds),
    });
    this.host.syncUnloadAlert();
  }
  private available() {
    return this.host.active() && !this.host.materialsBlocked() && !this.host.data.formalArchive &&
      Boolean(this.host.runtime?.materials) && this.owned(this.host.ownerKey);
  }
  private editable() {
    return this.available() && !this.busy && !this.reading && this.host.data.materialsOpen &&
      this.host.data.materialsLoaded && !this.host.data.materialsReadonly && !this.host.data.readonly &&
      !this.host.data.materialsNeedsRefresh;
  }
  private owned(key: string) {
    if (!key || key !== this.host.ownerKey) return false;
    if (key !== this.host.runtime?.sessions.getSessionKey()) {
      this.host.clearPrivate('申请登录已更新，请重新登录'); return false;
    }
    return true;
  }
  private current(generation: number, key: string) {
    return this.host.active() && generation === this.generation && this.owned(key);
  }
  private failure(error: unknown) {
    if ([401, 403].includes(status(error))) {
      this.host.clearPrivate(status(error) === 401 ? '申请登录已失效，请重新登录' : '当前账号无权查看入驻材料'); return;
    }
    if (this.selection && [400, 409, 413].includes(status(error))) {
      const intent = this.selection.intent;
      if (intent && !this.host.data.materialsUploads.some((item) => item.uploadId === intent.uploadId)) {
        this.host.setData({ materialsUploads: [...this.host.data.materialsUploads,
          { ...intent, label: MATERIAL_LABELS[intent.kind] }] });
      }
      this.selection = undefined;
    }
    this.host.setData({
      materialsNeedsRefresh: this.host.data.materialsNeedsRefresh || status(error) === 409,
      materialsMessage: status(error) >= 500 ? '材料服务暂时不可用，请稍后重试'
        : status(error) === 409 ? '材料请求未完成，请读取最新版本后恢复原上传'
        : error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : '材料请求失败，请重试',
    });
    this.sync();
  }
}
