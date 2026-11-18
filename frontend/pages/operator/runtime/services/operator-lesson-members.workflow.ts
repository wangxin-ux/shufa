import type { OperatorPageContext } from '../operator-page-context';
import type { OperatorPage, OperatorStudent } from '../types/operator';
import type { OperatorLessonRoster } from '../types/operator-lesson-members';
import { operatorMemberId } from '../data/operator-lesson-members-codec';

function validSearchPage(value: unknown, page: number): value is OperatorPage<OperatorStudent> {
  if (!value || typeof value !== 'object') return false;
  const result = value as OperatorPage<OperatorStudent>;
  const meta = result.meta;
  if (!Array.isArray(result.data) || !meta || meta.page !== page || meta.pageSize !== 20 ||
      !Number.isSafeInteger(meta.total) || meta.total < 0 ||
      !Number.isSafeInteger(meta.totalPages) || meta.totalPages !== Math.ceil(meta.total / 20) ||
      result.data.length !== Math.min(20, Math.max(0, meta.total - (page - 1) * 20))) return false;
  const ids = new Set<string>();
  return result.data.every(student => {
    if (!student || !operatorMemberId(student.id) || !operatorMemberId(student.campusId) ||
        typeof student.displayName !== 'string' || !student.displayName.trim() ||
        !(student.ageYears === null || (Number.isSafeInteger(student.ageYears) && student.ageYears >= 0)) ||
        !Array.isArray(student.classNames) ||
        student.classNames.some(name => typeof name !== 'string' || !name.trim()) ||
        ids.has(student.id.toLowerCase())) return false;
    ids.add(student.id.toLowerCase());
    return true;
  });
}

export function emptyOperatorLessonMembersView() {
  return {
    lessonSessionId: '', roster: null as OperatorLessonRoster | null,
    loading: false, errorMessage: '', message: '',
    searchInput: '', searchQuery: '', students: [] as OperatorStudent[],
    searchPage: 0, searchTotal: 0, searchHasMore: false, searching: false, searchError: '',
    selectedStudentId: '', selectedStudentName: '', selectedInRoster: false, removingStudentId: '',
    busy: false, blocking: false, recoveryAvailable: false, recoveryLabel: '核对名单',
  };
}
type View = ReturnType<typeof emptyOperatorLessonMembersView>;
type Command = {
  lessonSessionId: string; studentId: string; version: number; key: string;
  operation: 'add' | 'remove';
  phase: 'sending' | 'unknown' | 'replay' | 'readback' | 'conflict';
  message: string;
};
let sequence = 0;

export class OperatorLessonMembersWorkflow {
  private view = emptyOperatorLessonMembersView();
  private command?: Command;
  private writing = false;
  private visible = true;
  private disposed = false;
  private readSequence = 0;
  private searchSequence = 0;

  constructor(
    private readonly context: OperatorPageContext,
    private readonly update: (view: View) => void,
  ) {}

  private active() { return !this.disposed && this.visible && this.context.isActive(); }
  private patch(patch: Partial<View>) {
    this.view = { ...this.view, ...patch };
    this.view.selectedInRoster = Boolean(this.view.selectedStudentId &&
      this.view.roster?.members.some((member) => member.studentId === this.view.selectedStudentId));
    this.update(this.view);
  }
  private recovery() {
    const command = this.command;
    this.patch({
      busy: this.writing, blocking: Boolean(command),
      recoveryAvailable: Boolean(command && !this.writing),
      recoveryLabel: command?.phase === 'replay' ? '重试原操作' : '核对名单',
    });
  }
  isBlocking() { return Boolean(this.command); }
  isOpen() { return Boolean(this.view.lessonSessionId); }

  show() {
    if (this.disposed) return;
    this.visible = true;
    if (this.command) {
      if (this.command.phase === 'replay') this.command.phase = 'unknown';
      this.patch({ lessonSessionId: this.command.lessonSessionId,
        message: this.writing ? '正在提交名单' : '名单操作结果待确认' });
      this.recovery();
    }
  }
  hide() {
    this.visible = false;
    this.readSequence += 1;
    this.searchSequence += 1;
    if (this.command?.phase === 'replay') this.command.phase = 'unknown';
    this.view = emptyOperatorLessonMembersView();
    this.update(this.view);
  }
  invalidate() {
    this.command = undefined;
    this.writing = false;
    this.hide();
  }
  dispose() {
    this.invalidate();
    this.disposed = true;
  }
  open(lessonSessionId: string) {
    if (!this.active() || this.command) return;
    this.readSequence += 1;
    this.searchSequence += 1;
    this.patch({ ...emptyOperatorLessonMembersView(), lessonSessionId });
    void this.readRoster();
  }
  close(): boolean {
    if (!this.active() || this.command) return false;
    this.readSequence += 1;
    this.searchSequence += 1;
    this.patch(emptyOperatorLessonMembersView());
    return true;
  }
  private canChange() {
    const roster = this.view.roster;
    return this.active() && !this.command && !this.view.loading && !this.view.errorMessage &&
      Boolean(roster?.canChange && roster.status === 'SCHEDULED' &&
        Date.parse(roster.startsAt) > Date.now());
  }

  async readRoster() {
    if (!this.active() || this.writing || !this.view.lessonSessionId) return;
    const id = this.view.lessonSessionId;
    const read = ++this.readSequence;
    const command = this.command;
    this.patch({ loading: true, errorMessage: '' });
    const state = await this.context.service.loadLessonMembers(id);
    if (!this.context.isCurrent() || !this.active() || read !== this.readSequence ||
        this.view.lessonSessionId !== id) return;
    if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403)) {
      this.context.invalidate(state.message);
      return;
    }
    if (state.status !== 'success') {
      this.patch({ loading: false, errorMessage: state.status === 'error'
        ? state.message : '名单加载失败，请重试' });
      this.recovery();
      return;
    }
    this.patch({ roster: state.data, loading: false, removingStudentId: '', errorMessage: '' });
    if (command && this.command === command) {
      if (command.phase === 'conflict' || command.phase === 'readback') {
        this.command = undefined;
        this.patch({ message: command.phase === 'conflict'
          ? command.message : '课次名单已更新',
          ...(command.phase === 'readback' ? { selectedStudentId: '', selectedStudentName: '' } : {}),
        });
      } else if (command.phase === 'unknown') {
        command.phase = 'replay';
        this.patch({ message: '已核对最新名单，可确认原操作结果' });
      }
    }
    this.recovery();
  }

  setSearchInput(value: string) {
    if (this.canChange()) this.patch({ searchInput: value.slice(0, 80) });
  }
  async search(reset = true) {
    if (!this.canChange() || (!reset && (!this.view.searchHasMore || this.view.searching))) return;
    const search = ++this.searchSequence;
    const page = reset ? 1 : this.view.searchPage + 1;
    const query = reset ? this.view.searchInput.trim() : this.view.searchQuery;
    this.patch({ searching: true, searchError: '', searchQuery: query,
      ...(reset ? { students: [], searchPage: 0, searchTotal: 0, searchHasMore: false } : {}) });
    const state = await this.context.service.loadStudents({ page, pageSize: 20, ...(query ? { query } : {}) });
    if (!this.context.isCurrent() || !this.active() || search !== this.searchSequence) return;
    if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403)) {
      this.context.invalidate(state.message);
      return;
    }
    if (state.status !== 'success' && state.status !== 'empty') {
      this.patch({ searching: false, searchError: state.status === 'error' ? state.message : '学员加载失败，请重试' });
      return;
    }
    if (!validSearchPage(state.data, page)) {
      this.patch({ searching: false, searchError: '学员列表返回内容不一致，请重试' });
      return;
    }
    const rows = reset ? [] : this.view.students;
    const unique = new Map(rows.map((student) => [student.id, student]));
    for (const student of state.data.data) unique.set(student.id, student);
    this.patch({ students: [...unique.values()], searching: false,
      searchPage: state.data.meta.page, searchTotal: state.data.meta.total,
      searchHasMore: state.data.meta.page < state.data.meta.totalPages });
  }
  select(studentId: string) {
    if (!this.canChange()) return;
    const student = this.view.students.find((row) => row.id === studentId);
    if (student) this.patch({ selectedStudentId: student.id, selectedStudentName: student.displayName });
  }
  requestRemove(studentId: string) {
    if (this.canChange() && this.view.roster?.members.some(
      (row) => row.studentId === studentId && row.source === 'TEMPORARY' && row.canRemove,
    )) this.patch({ removingStudentId: studentId });
  }
  cancelRemove() { if (this.active() && !this.command) this.patch({ removingStudentId: '' }); }
  add() {
    const id = this.view.selectedStudentId;
    if (!this.canChange() || !id || this.view.roster?.members.some((row) => row.studentId === id)) return;
    this.start('add', id);
  }
  remove() {
    const id = this.view.removingStudentId;
    if (!this.canChange() || !this.view.roster?.members.some(
      (row) => row.studentId === id && row.source === 'TEMPORARY' && row.canRemove,
    )) return;
    this.start('remove', id);
  }
  private start(operation: Command['operation'], studentId: string) {
    const roster = this.view.roster!;
    const command: Command = { operation, studentId, lessonSessionId: roster.lessonSessionId,
      version: roster.lessonVersion,
      key: `operator-members-${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}`,
      phase: 'sending', message: '' };
    this.command = command;
    this.searchSequence += 1;
    this.readSequence += 1;
    void this.send(command);
  }
  recover() {
    if (!this.active() || !this.command || this.writing || this.view.loading) return;
    if (this.command.phase === 'replay') void this.send(this.command);
    else void this.readRoster();
  }
  private async send(command: Command) {
    if (!this.active() || this.writing || this.command !== command) return;
    this.writing = true;
    this.patch({ busy: true, blocking: true, recoveryAvailable: false,
      searching: false, removingStudentId: '', message: '', errorMessage: '' });
    const state = command.operation === 'add'
      ? await this.context.service.addLessonMember(command.lessonSessionId, command.studentId, command.version, command.key)
      : await this.context.service.removeLessonMember(command.lessonSessionId, command.studentId, command.version, command.key);
    if (this.disposed || this.command !== command || !this.context.isCurrent()) return;
    this.writing = false;
    if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403)) {
      this.context.invalidate(state.message);
      return;
    }
    if (state.status === 'success') command.phase = 'readback';
    else if (state.status === 'error' && state.statusCode === 409) {
      command.phase = 'conflict';
      command.message = state.message;
    } else if (state.status === 'error' && state.statusCode &&
        state.statusCode >= 400 && state.statusCode < 500) {
      this.command = undefined;
      if (this.active()) {
        this.patch({ message: state.message });
        this.recovery();
      }
      return;
    } else command.phase = 'unknown';
    if (!this.active()) return;
    this.patch({ message: command.phase === 'unknown' ? '名单操作结果待确认，请先核对名单'
      : command.phase === 'conflict' ? command.message : '名单已提交，正在刷新' });
    this.recovery();
    if (command.phase === 'readback' || command.phase === 'conflict') await this.readRoster();
  }
}
