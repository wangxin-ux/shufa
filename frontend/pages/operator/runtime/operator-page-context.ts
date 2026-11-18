import { createOperatorRuntimeEnv } from './config/operator-env';
import { createOperatorService } from './services/operator-runtime';
import type { OperatorService } from './services/operator.service';
import { OperatorStudentMediaReader } from './services/operator-student-media';
import { OperatorAccess } from './operator-access';
import { RosterFileTransferClient } from '../../../services/roster-file-transfer';
import { resolveLocalTestAccountCode } from '../../../services/session.service';

function stored(key: string): unknown {
  try { return typeof wx === 'undefined' ? undefined : wx.getStorageSync(key); }
  catch { return undefined; }
}

function snapshot() {
  const raw = createOperatorRuntimeEnv();
  const env = {
    ...raw, apiBaseUrl: raw.apiBaseUrl.trim().replace(/\/+$/, ''),
    accessToken: raw.accessToken.trim(),
  };
  const account = stored('education.test-account.current');
  const loggedOut = stored('education.session.logged-out') === true;
  const local = stored('education.runtime') as { mockWechatAccount?: string; enableTestAccountSwitcher?: boolean } | undefined;
  const mockAccount = typeof account === 'string' && account ? account : local?.mockWechatAccount;
  const mockAllowed = local?.enableTestAccountSwitcher === true &&
    resolveLocalTestAccountCode(mockAccount) === 'OPERATOR';
  return {
    env, loggedOut, mockAllowed,
    key: JSON.stringify([
      env.dataDriver, env.apiBaseUrl, env.accessToken, env.mockScenario,
      typeof account === 'string' ? account : '', loggedOut, local?.mockWechatAccount, mockAllowed,
    ]),
  };
}

let mockSession: { key: string; service: OperatorService } | undefined;

export class OperatorPageContext {
  readonly service: OperatorService;
  readonly roster: RosterFileTransferClient;
  readonly access: OperatorAccess;
  private readonly owner = snapshot();
  private sequence = 0;
  private hidden = false;
  private disposed = false;
  private invalidated = false;
  private displayCycle = 0;

  constructor(private readonly clear: (message: string) => void) {
    this.access = new OperatorAccess({
      apiBaseUrl: this.owner.env.apiBaseUrl, accessToken: this.owner.env.accessToken,
      isCurrent: () => this.isCurrent(), canSend: () => this.isActive(),
      forbidden: (message) => this.invalidate(message),
    });
    this.roster = new RosterFileTransferClient({
      baseUrl: this.owner.env.dataDriver === 'api' ? this.owner.env.apiBaseUrl : '',
      accessToken: this.owner.env.accessToken,
    }, this.access.rosterNative());
    if (this.owner.env.dataDriver === 'mock') {
      if (mockSession?.key !== this.owner.key) {
        mockSession = { key: this.owner.key, service: createOperatorService(this.owner.env) };
      }
      this.service = mockSession.service;
    } else {
      mockSession = undefined;
      this.service = createOperatorService(this.owner.env, this.access.request);
    }
  }

  ownsRuntime(): boolean {
    return !this.owner.loggedOut && snapshot().key === this.owner.key;
  }

  studentMediaReader(studentId: string): OperatorStudentMediaReader | undefined {
    if (this.owner.env.dataDriver !== 'api') return undefined;
    return new OperatorStudentMediaReader({
      apiBaseUrl: this.owner.env.apiBaseUrl, studentId,
      accessToken: () => this.owner.env.accessToken,
      isCurrent: () => this.isCurrent(),
    });
  }

  isCurrent(): boolean {
    if (this.disposed || this.invalidated) return false;
    if (this.owner.env.dataDriver === 'mock' && !this.owner.mockAllowed) {
      this.invalidate('请先选择本地运营测试账号');
      return false;
    }
    if (this.ownsRuntime()) return true;
    this.invalidate('登录已更新，请重新登录');
    return false;
  }

  isActive(): boolean {
    return !this.hidden && this.isCurrent();
  }

  operationIsCurrent(): () => boolean {
    const cycle = this.displayCycle;
    return () => cycle === this.displayCycle && this.isActive();
  }

  rosterFor(isCurrent: () => boolean): RosterFileTransferClient {
    return new RosterFileTransferClient({
      baseUrl: this.owner.env.dataDriver === 'api' ? this.owner.env.apiBaseUrl : '',
      accessToken: this.owner.env.accessToken,
    }, this.access.rosterNative(isCurrent));
  }

  nextRead(): number { return ++this.sequence; }

  accepts(sequence: number): boolean {
    return this.isActive() && sequence === this.sequence;
  }

  invalidate(message: string): void {
    if (this.disposed || this.invalidated) return;
    this.invalidated = true;
    this.sequence += 1;
    if (mockSession?.key === this.owner.key) mockSession = undefined;
    this.clear(message);
  }

  show(): boolean {
    this.hidden = false;
    return this.isCurrent();
  }

  hide(): void {
    this.displayCycle += 1;
    this.hidden = true;
    this.sequence += 1;
  }

  dispose(): void {
    this.disposed = true;
    this.hide();
  }
}
