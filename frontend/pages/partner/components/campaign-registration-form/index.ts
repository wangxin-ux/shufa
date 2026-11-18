import { defaultRegistrationForm, type RegistrationQuestion } from '../../runtime/campaign-registration-form';

type QuestionKind = RegistrationQuestion['kind'];
const kinds: Array<{ value: QuestionKind; label: string }> = [
  { value: 'TEXT', label: '文本' }, { value: 'NUMBER', label: '数字' },
  { value: 'SINGLE_CHOICE', label: '单选' }, { value: 'MULTI_CHOICE', label: '多选' },
  { value: 'AGE', label: '年龄' }, { value: 'DATE', label: '日期' }, { value: 'MOBILE', label: '手机号' },
];
type FormEvent = {
  currentTarget: { dataset: { id?: unknown; field?: unknown; option?: unknown; direction?: unknown } };
  detail?: { value?: unknown };
};
const choice = (kind: QuestionKind) => kind === 'SINGLE_CHOICE' || kind === 'MULTI_CHOICE';
const copy = (questions: RegistrationQuestion[]) => questions.map(q => ({ ...q, options: [...q.options] }));
function indexValue(value: unknown): number {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return -1;
  return Number.isSafeInteger(Number(value)) ? Number(value) : -1;
}
let nextId = 0;

Component({
  properties: {
    questions: { type: Array, value: [], observer() { this.syncRows(); } },
    disabled: { type: Boolean, value: false },
    preview: { type: Boolean, value: false },
  },
  data: {
    kinds,
    rows: [] as Array<RegistrationQuestion & {
      kindIndex: number; kindLabel: string; optionRows: Array<{ index: number; value: string }>;
    }>,
  },
  lifetimes: { attached() { this.syncRows(); } },
  methods: {
    syncRows() {
      this.setData({ rows: (this.data.questions as RegistrationQuestion[]).map(q => {
        const kindIndex = kinds.findIndex(kind => kind.value === q.kind);
        return { ...q, options: [...q.options], kindIndex, kindLabel: kinds[kindIndex]?.label ?? '',
          optionRows: q.options.map((value, index) => ({ index, value })) };
      }) });
    },
    canEdit(): boolean { return !this.data.disabled && !this.data.preview; },
    emit(questions: RegistrationQuestion[]) {
      if (this.canEdit()) this.triggerEvent('change', { questions: copy(questions) });
    },
    update(id: unknown, change: (question: RegistrationQuestion) => void) {
      if (!this.canEdit() || typeof id !== 'string') return;
      const questions = copy(this.data.questions as RegistrationQuestion[]);
      const current = questions.find(q => q.id === id);
      if (!current) return;
      change(current);
      this.emit(questions);
    },
    onTextInput(event: FormEvent) {
      const { id, field } = event.currentTarget.dataset;
      const value = event.detail?.value;
      if ((field !== 'label' && field !== 'hint') || typeof value !== 'string') return;
      this.update(id, q => { q[field] = value; });
    },
    onRequiredChange(event: FormEvent) {
      const value = event.detail?.value;
      if (typeof value !== 'boolean') return;
      this.update(event.currentTarget.dataset.id, q => { q.required = value; });
    },
    onKindChange(event: FormEvent) {
      const selected = kinds[indexValue(event.detail?.value)];
      if (!selected) return;
      this.update(event.currentTarget.dataset.id, q => {
        q.options = choice(selected.value) ? choice(q.kind) ? q.options : ['选项1', '选项2'] : [];
        q.kind = selected.value;
      });
    },
    onOptionInput(event: FormEvent) {
      const { id, option } = event.currentTarget.dataset;
      const position = indexValue(option), value = event.detail?.value;
      const q = (this.data.questions as RegistrationQuestion[]).find(row => row.id === id);
      if (!q || !choice(q.kind) || position < 0 || position >= q.options.length || typeof value !== 'string') return;
      this.update(id, row => { row.options[position] = value; });
    },
    onAddOption(event: FormEvent) {
      const { id } = event.currentTarget.dataset;
      const q = (this.data.questions as RegistrationQuestion[]).find(row => row.id === id);
      if (!q || !choice(q.kind) || q.options.length >= 20) return;
      this.update(id, row => {
        let number = row.options.length + 1;
        const existing = new Set(row.options.map(value => value.trim()));
        while (existing.has(`选项${number}`)) number++;
        row.options.push(`选项${number}`);
      });
    },
    onRemoveOption(event: FormEvent) {
      const { id, option } = event.currentTarget.dataset;
      const position = indexValue(option);
      const q = (this.data.questions as RegistrationQuestion[]).find(row => row.id === id);
      if (!q || !choice(q.kind) || q.options.length <= 2 || position < 0 || position >= q.options.length) return;
      this.update(id, row => { row.options.splice(position, 1); });
    },
    onAdd() {
      if (!this.canEdit() || this.data.questions.length >= 20) return;
      const questions = copy(this.data.questions as RegistrationQuestion[]);
      let id: string;
      do { id = `question-${Date.now().toString(36)}-${++nextId}`; } while (questions.some(q => q.id === id));
      this.emit([...questions, { id, kind: 'TEXT', label: '', hint: '', required: false, options: [] }]);
    },
    onDefaults() {
      if (this.canEdit() && this.data.questions.length === 0) this.emit(defaultRegistrationForm());
    },
    onRemove(event: FormEvent) {
      const { id } = event.currentTarget.dataset;
      if (!(this.data.questions as RegistrationQuestion[]).some(q => q.id === id)) return;
      this.emit((this.data.questions as RegistrationQuestion[]).filter(q => q.id !== id));
    },
    onMove(event: FormEvent) {
      if (!this.canEdit()) return;
      const { id, direction } = event.currentTarget.dataset;
      if (direction !== -1 && direction !== 1 && direction !== '-1' && direction !== '1') return;
      const questions = copy(this.data.questions as RegistrationQuestion[]);
      const from = questions.findIndex(q => q.id === id), to = from + Number(direction);
      if (from < 0 || to < 0 || to >= questions.length) return;
      [questions[from], questions[to]] = [questions[to], questions[from]];
      this.emit(questions);
    },
  },
});
