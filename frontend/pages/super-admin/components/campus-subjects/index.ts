import {
  createCampusSubjectService, type CampusSubjectPort, type CampusSubject, type CampusSubjectLink,
  type SubjectLinkKind, type SubjectUpdate, type SubjectBinding,
} from '../../runtime/campus-subject.service';
import { createMutationKey } from '../../../../utils/super-admin-format';

type Lane = 'subjects' | 'classes' | 'packages';
const isLane = (value: string): value is Lane => ['subjects', 'classes', 'packages'].includes(value);
const kindOf = (lane: Lane): SubjectLinkKind => lane === 'classes' ? 'CLASS' : 'PACKAGE';
function emptyLane<T>() {
  return { rows: [] as T[], page: 1, requestedPage: 1, total: 0, totalPages: 0,
    query: '', search: '', loading: false, loaded: false, error: '' };
}
type Editor = { id: string; name: string; isActive: boolean; version: number };
type Binding = {
  id: string; lane: Lane; name: string; currentLabel: string;
  subjectId: string | null; selectedLabel: string; pickerIndex: number; version: number; reason: string;
};
const emptyData = () => ({
  subjects: emptyLane<CampusSubject>(), classes: emptyLane<CampusSubjectLink>(),
  packages: emptyLane<CampusSubjectLink>(), subjectOptions: [] as Array<{ id: string | null; name: string }>,
  catalog: [] as CampusSubject[], optionsLoading: false, optionsLoaded: false, optionsError: '',
  editor: null as Editor | null, binding: null as Binding | null,
  mutationState: '', mutationError: '', mutationLabel: '', notice: '', forbidden: false, forbiddenMessage: '',
});
type Operation = {
  type: 'CREATE' | 'SUBJECT' | 'LINK'; campusId: string; id: string; kind: SubjectLinkKind;
  body: { name: string } | SubjectUpdate | SubjectBinding; key: string; label: string;
};
type State = {
  attached: boolean; hidden: boolean; detached: boolean; stopped: boolean; initialShowPending: boolean;
  owner: string; campusId: string; epoch: number; runtime?: CampusSubjectPort;
  sequences: Map<string, number>; reads: Map<string, { key: string; promise: Promise<void> }>;
  operation?: Operation; mutationPending?: Promise<void>;
};
const states = new WeakMap<object, State>();
function state(instance: object): State {
  let value = states.get(instance);
  if (!value) {
    value = { attached: false, hidden: true, detached: false, stopped: false, initialShowPending: false,
      owner: '', campusId: '', epoch: 0, sequences: new Map(), reads: new Map() };
    states.set(instance, value);
  }
  return value;
}
const status = (error: unknown): number => typeof error === 'object' && error !== null &&
  'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 0;

Component({
  properties: {
    campusId: {
      type: String, value: '',
      observer(value: string) {
        const current = state(this);
        if (!current.attached || value === current.campusId) return;
        this.clearPrivate(false);
        current.campusId = value;
        if (!current.hidden && !current.stopped) this.start();
      },
    },
    blocked: {
      type: Boolean, value: false,
      observer(value: boolean) {
        if (value) this.clearPrivate(false);
        else if (state(this).attached && !state(this).hidden) this.start();
      },
    },
  },
  data: emptyData(),
  lifetimes: {
    attached() {
      const current = state(this);
      current.attached = true;
      current.hidden = false;
      current.detached = false;
      current.campusId = this.data.campusId;
      current.initialShowPending = true;
      this.start();
    },
    detached() {
      this.clearPrivate(false);
      const current = state(this);
      current.detached = true;
      current.attached = false;
      current.hidden = true;
      current.runtime = undefined;
      current.owner = '';
    },
  },
  pageLifetimes: {
    show() {
      const current = state(this);
      if (!current.attached || current.detached) return;
      current.hidden = false;
      if (!this.validateOwner()) return;
      if (current.initialShowPending) { current.initialShowPending = false; return; }
      this.start();
    },
    hide() {
      const current = state(this);
      current.hidden = true;
      current.initialShowPending = false;
      this.clearPrivate(true);
    },
  },
  methods: {
    clearPrivate(preserveOperation: boolean) {
      const current = state(this);
      ++current.epoch;
      current.reads.clear();
      current.sequences.clear();
      current.mutationPending = undefined;
      if (!preserveOperation) current.operation = undefined;
      this.setData({ ...emptyData(), forbidden: current.stopped,
        forbiddenMessage: current.stopped ? this.data.forbiddenMessage : '' });
    },
    stop(message: string) {
      const current = state(this);
      if (current.stopped) return;
      current.stopped = true;
      this.clearPrivate(false);
      this.setData({ forbidden: true, forbiddenMessage: message });
      this.triggerEvent('forbidden', { message });
    },
    validateOwner() {
      const current = state(this);
      if (current.stopped) return false;
      if (current.runtime && (!current.owner || current.runtime.getSessionKey() !== current.owner)) {
        this.stop('登录已更新，请重新登录后进入校区'); return false;
      }
      return true;
    },
    usable() {
      const current = state(this);
      return current.attached && !current.hidden && !current.detached && !this.data.blocked &&
        Boolean(this.data.campusId) && this.validateOwner();
    },
    start() {
      const current = state(this);
      if (!this.usable()) return;
      if (!current.runtime) {
        current.runtime = createCampusSubjectService();
        current.owner = current.runtime.getSessionKey();
      }
      if (!this.validateOwner()) return;
      if (current.operation) this.setData({ mutationState: 'unknown', mutationLabel: current.operation.label,
        mutationError: '上次提交结果待确认，请重试原操作' });
      this.refreshLists();
    },
    refreshLists() {
      void this.readLane('subjects');
      void this.readLane('classes');
      void this.readLane('packages');
      void this.readOptions();
    },
    readLane(lane: Lane, requestedPage?: number): Promise<void> {
      const current = state(this);
      if (!isLane(lane) || !this.usable() || !current.runtime) return Promise.resolve();
      const view = this.data[lane];
      const page = requestedPage ?? view.requestedPage;
      const query = view.query;
      const campusId = this.data.campusId;
      const runtime = current.runtime;
      const epoch = current.epoch;
      const key = JSON.stringify([campusId, epoch, page, query]);
      const pending = current.reads.get(lane);
      if (pending?.key === key) return pending.promise;
      const sequence = (current.sequences.get(lane) ?? 0) + 1;
      current.sequences.set(lane, sequence);
      const valid = () => epoch === current.epoch && current.sequences.get(lane) === sequence && this.usable();
      this.setData({ [lane]: { ...view, requestedPage: page, loading: true, error: '' } });
      const promise = Promise.resolve().then(async () => {
        if (!valid()) return;
        try {
          const result = lane === 'subjects' ? await runtime.subjects(campusId, page, 20, query)
            : await runtime.links(campusId, kindOf(lane), page, query);
          if (!valid()) return;
          this.setData({ [lane]: { ...this.data[lane], rows: result.data, page, requestedPage: page,
            total: result.meta.total, totalPages: result.meta.totalPages, loaded: true, loading: false, error: '' } });
        } catch (error) {
          if (!valid()) return;
          if (status(error) === 401 || status(error) === 403) { this.stop('登录已失效或无科目维护权限，请重新登录'); return; }
          this.setData({ [lane]: { ...this.data[lane], loading: false, error: '列表加载失败，请重试' } });
        }
      }).finally(() => { if (current.reads.get(lane)?.promise === promise) current.reads.delete(lane); });
      current.reads.set(lane, { key, promise });
      return promise;
    },
    readOptions(): Promise<void> {
      const current = state(this);
      if (!this.usable() || !current.runtime) return Promise.resolve();
      const existing = current.reads.get('options');
      if (existing) return existing.promise;
      const epoch = current.epoch;
      const runtime = current.runtime;
      const campusId = this.data.campusId;
      const sequence = (current.sequences.get('options') ?? 0) + 1;
      current.sequences.set('options', sequence);
      const valid = () => epoch === current.epoch && current.sequences.get('options') === sequence && this.usable();
      this.setData({ optionsLoading: true, optionsLoaded: false, subjectOptions: [], catalog: [], optionsError: '' });
      const promise = Promise.resolve().then(async () => {
        if (!valid()) return;
        try {
          const catalog = await runtime.allSubjects(campusId, valid);
          if (!valid()) return;
          this.setData({ catalog, optionsLoaded: true, optionsLoading: false,
            subjectOptions: [{ id: null, name: '未归类' }, ...catalog.filter((item) => item.isActive).map(({ id, name }) => ({ id, name }))] });
        } catch (error) {
          if (!valid()) return;
          if (status(error) === 401 || status(error) === 403) { this.stop('登录已失效或无科目维护权限，请重新登录'); return; }
          this.setData({ optionsLoading: false, optionsError: '可选科目加载失败，请重试' });
        }
      }).finally(() => { if (current.reads.get('options')?.promise === promise) current.reads.delete('options'); });
      current.reads.set('options', { key: '', promise });
      return promise;
    },
    onRetry(event: WechatMiniprogram.TouchEvent) {
      const lane = String(event.currentTarget.dataset.lane);
      if (lane === 'options') void this.readOptions();
      else if (isLane(lane)) void this.readLane(lane);
    },
    onPage(event: WechatMiniprogram.TouchEvent) {
      const lane = String(event.currentTarget.dataset.lane);
      const direction = Number(event.currentTarget.dataset.direction);
      if (!isLane(lane) || ![-1, 1].includes(direction) || !this.usable()) return;
      const view = this.data[lane];
      const next = view.page + direction;
      if (next >= 1 && next <= view.totalPages) void this.readLane(lane, next);
    },
    onSearchInput(event: WechatMiniprogram.Input) {
      const lane = String(event.currentTarget.dataset.lane);
      if (isLane(lane) && this.usable()) this.setData({ [lane]: { ...this.data[lane], search: event.detail.value.slice(0, 100) } });
    },
    onSearch(event: WechatMiniprogram.TouchEvent) {
      const lane = String(event.currentTarget.dataset.lane);
      if (!isLane(lane) || !this.usable()) return;
      const query = this.data[lane].search.trim().normalize('NFC');
      if (query !== this.data[lane].query) this.setData({ [lane]: { ...emptyLane(), query, search: query } });
      void this.readLane(lane, 1);
    },
    editable() { return this.usable() && !state(this).operation; },
    onCreate() {
      if (!this.editable()) return;
      this.setData({ editor: { id: '', name: '', isActive: true, version: 0 }, binding: null, mutationError: '', notice: '' });
    },
    onEdit(event: WechatMiniprogram.TouchEvent) {
      if (!this.editable()) return;
      const row = this.data.subjects.rows.find((item) => item.id === event.currentTarget.dataset.id);
      if (row) this.setData({ editor: { id: row.id, name: row.name, isActive: row.isActive, version: row.version },
        binding: null, mutationError: '', notice: '' });
    },
    onNameInput(event: WechatMiniprogram.Input) {
      if (this.editable() && this.data.editor) this.setData({ editor: { ...this.data.editor, name: event.detail.value } });
    },
    onActiveChange(event: WechatMiniprogram.SwitchChange) {
      if (this.editable() && this.data.editor) this.setData({ editor: { ...this.data.editor, isActive: event.detail.value } });
    },
    onCancelEdit() {
      if (this.editable()) this.setData({ editor: null, binding: null, mutationError: '' });
    },
    onBind(event: WechatMiniprogram.TouchEvent) {
      const lane = String(event.currentTarget.dataset.lane);
      if (!this.editable() || !this.data.optionsLoaded || (lane !== 'classes' && lane !== 'packages')) return;
      const row = this.data[lane].rows.find((item) => item.id === event.currentTarget.dataset.id);
      if (!row) return;
      const subject = this.data.catalog.find((item) => item.id === row.subjectId);
      const currentLabel = row.subjectId === null ? '未归类'
        : `${row.subjectName ?? '科目名称待核对'}${subject?.isActive === false ? '（已停用）' : ''}`;
      this.setData({ editor: null, mutationError: '', notice: '', binding: {
        id: row.id, lane, name: row.name, currentLabel, subjectId: row.subjectId,
        selectedLabel: currentLabel, pickerIndex: Math.max(0, this.data.subjectOptions.findIndex((item) => item.id === row.subjectId)),
        version: row.version, reason: '',
      } });
    },
    onSubjectPick(event: WechatMiniprogram.PickerChange) {
      if (!this.editable() || !this.data.binding || !this.data.optionsLoaded) return;
      const index = Number(event.detail.value);
      const selected = this.data.subjectOptions[index];
      if (!Number.isInteger(index) || !selected) return;
      this.setData({ binding: { ...this.data.binding, subjectId: selected.id, selectedLabel: selected.name, pickerIndex: index } });
    },
    onClearSubject() {
      if (this.editable() && this.data.binding && this.data.optionsLoaded) {
        this.setData({ binding: { ...this.data.binding, subjectId: null, selectedLabel: '未归类', pickerIndex: 0 } });
      }
    },
    onReasonInput(event: WechatMiniprogram.Input) {
      if (this.editable() && this.data.binding) this.setData({ binding: { ...this.data.binding, reason: event.detail.value } });
    },
    onSaveSubject(): Promise<void> {
      if (!this.editable() || !this.data.editor) return Promise.resolve();
      const editor = this.data.editor;
      const name = editor.name.trim().normalize('NFC');
      if (!name || name.length > 80) {
        this.setData({ mutationError: '请填写一至八十字科目名称' }); return Promise.resolve();
      }
      state(this).operation = {
        type: editor.id ? 'SUBJECT' : 'CREATE', campusId: this.data.campusId, id: editor.id, kind: 'PACKAGE',
        body: Object.freeze(editor.id ? { name, isActive: editor.isActive, expectedVersion: editor.version } : { name }),
        key: createMutationKey('campus-subject'), label: `${editor.id ? '保存' : '创建'}科目：${name}`,
      };
      return this.submitOperation();
    },
    onSaveBinding(): Promise<void> {
      const binding = this.data.binding;
      if (!this.editable() || !binding || !this.data.optionsLoaded) return Promise.resolve();
      const reason = binding.reason.trim().normalize('NFC');
      if (!reason || reason.length > 200) {
        this.setData({ mutationError: '请填写一至二百字调整原因' }); return Promise.resolve();
      }
      if (!this.data.subjectOptions.some((item) => item.id === binding.subjectId)) {
        this.setData({ mutationError: '请选择启用科目或未归类' }); return Promise.resolve();
      }
      state(this).operation = {
        type: 'LINK', campusId: this.data.campusId, id: binding.id, kind: kindOf(binding.lane),
        body: Object.freeze({ subjectId: binding.subjectId, expectedVersion: binding.version, reason }),
        key: createMutationKey('campus-subject-link'), label: `${binding.name}：${binding.selectedLabel}`,
      };
      return this.submitOperation();
    },
    onRetryMutation(): Promise<void> {
      const current = state(this);
      if (!this.usable()) return Promise.resolve();
      if (current.mutationPending) return current.mutationPending;
      return this.data.mutationState === 'unknown' ? this.submitOperation() : Promise.resolve();
    },
    submitOperation(): Promise<void> {
      const current = state(this);
      if (current.mutationPending) return current.mutationPending;
      const operation = current.operation;
      if (!this.usable() || !operation || !current.runtime) return Promise.resolve();
      const runtime = current.runtime;
      const epoch = current.epoch;
      const valid = () => epoch === current.epoch && current.operation === operation && this.usable();
      this.setData({ mutationState: 'submitting', mutationError: '', mutationLabel: operation.label });
      const promise = Promise.resolve().then(async () => {
        if (!valid()) return;
        try {
          if (operation.type === 'CREATE') await runtime.create(operation.campusId, operation.body as { name: string }, operation.key);
          else if (operation.type === 'SUBJECT') await runtime.update(operation.campusId, operation.id, operation.body as SubjectUpdate, operation.key);
          else await runtime.bind(operation.campusId, operation.kind, operation.id, operation.body as SubjectBinding, operation.key);
          if (!valid()) return;
          current.operation = undefined;
          this.setData({ mutationState: '', mutationError: '', mutationLabel: '', editor: null, binding: null,
            notice: operation.type === 'LINK' ? '科目关联已保存' : '科目已保存' });
          this.invalidateReads();
          this.refreshLists();
        } catch (error) {
          if (!valid()) return;
          const code = status(error);
          if (code === 401 || code === 403) { this.stop('登录已失效或无科目维护权限，请重新登录'); return; }
          const idempotencyPending = typeof error === 'object' && error !== null &&
            'code' in error && error.code === 'IDEMPOTENCY_CONFLICT';
          if (code === 0 || code >= 500 || code === 408 || idempotencyPending) {
            this.setData({ mutationState: 'unknown', mutationError: '提交结果待确认，请重试原操作' }); return;
          }
          current.operation = undefined;
          this.setData({ mutationState: '', mutationLabel: '', mutationError: code === 409 ? '' : '保存失败，请核对填写内容后重试' });
          if (code === 409) {
            this.setData({ editor: null, binding: null, notice: '记录或科目已更新，请重新选择后保存' });
            this.invalidateReads();
            this.refreshLists();
          }
        }
      }).finally(() => { if (current.mutationPending === promise) current.mutationPending = undefined; });
      current.mutationPending = promise;
      return promise;
    },
    invalidateReads() {
      const current = state(this);
      current.reads.clear();
      for (const lane of ['subjects', 'classes', 'packages', 'options']) {
        current.sequences.set(lane, (current.sequences.get(lane) ?? 0) + 1);
      }
    },
  },
});
