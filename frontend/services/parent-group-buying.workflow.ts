import { ParentDataSource } from '../data/parent-data-source';
import { GroupJoinInput, GroupPrepayView } from '../types/group-buying';

type WorkflowSource = Pick<
  ParentDataSource,
  'createGroupTeam' | 'joinGroupTeam' | 'retryGroupPrepay' | 'confirmMockGroupPayment'
>;

export type GroupPaymentInvocation =
  | { kind: 'mock'; memberId: string }
  | {
      kind: 'wechat';
      memberId: string;
      payment: {
        timeStamp: string;
        nonceStr: string;
        package: string;
        signType: 'RSA';
        paySign: string;
      };
    };

export interface ParentGroupBuyingWorkflowState {
  status: 'idle' | 'submitting' | 'awaiting-payment' | 'payment-confirming' | 'error';
  draft: GroupJoinInput | null;
  memberId?: string;
  message?: string;
}

export class ParentGroupBuyingWorkflow {
  private state: ParentGroupBuyingWorkflowState = { status: 'idle', draft: null };

  constructor(private readonly source: WorkflowSource) {}

  getState(): ParentGroupBuyingWorkflowState {
    return { ...this.state, draft: this.state.draft ? { ...this.state.draft } : null };
  }

  async start(input: GroupJoinInput, idempotencyKey: string): Promise<GroupPaymentInvocation> {
    return this.run(input, () => this.source.createGroupTeam(input, idempotencyKey));
  }

  async join(teamId: string, input: GroupJoinInput, idempotencyKey: string): Promise<GroupPaymentInvocation> {
    return this.run(input, () => this.source.joinGroupTeam(teamId, input.studentId, idempotencyKey));
  }

  async retry(memberId: string, expectedVersion: number, input: GroupJoinInput, idempotencyKey: string): Promise<GroupPaymentInvocation> {
    this.state = { status: 'submitting', draft: { ...input }, memberId };
    try {
      return await this.handlePrepay(
        await this.source.retryGroupPrepay(memberId, expectedVersion, idempotencyKey),
      );
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  markWechatPaymentAccepted(): void {
    if (this.state.status === 'awaiting-payment') {
      this.state = { ...this.state, status: 'payment-confirming' };
    }
  }

  private async run(
    input: GroupJoinInput,
    request: () => ReturnType<WorkflowSource['createGroupTeam']>,
  ): Promise<GroupPaymentInvocation> {
    this.state = { status: 'submitting', draft: { ...input } };
    try {
      const joined = await request();
      return await this.handlePrepay(joined.prepay);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  private async handlePrepay(prepay: GroupPrepayView): Promise<GroupPaymentInvocation> {
    if (prepay.mode === 'MOCK') {
      await this.source.confirmMockGroupPayment(
        prepay.memberId,
        prepay.outTradeNo,
        `group-confirm-${prepay.outTradeNo}`,
      );
      this.state = { ...this.state, status: 'payment-confirming', memberId: prepay.memberId };
      return { kind: 'mock', memberId: prepay.memberId };
    }
    if (!prepay.timeStamp || !prepay.nonceStr || !prepay.package || !prepay.paySign) {
      throw new Error('微信支付参数不完整，请稍后重试');
    }
    this.state = { ...this.state, status: 'awaiting-payment', memberId: prepay.memberId };
    return {
      kind: 'wechat',
      memberId: prepay.memberId,
      payment: {
        timeStamp: prepay.timeStamp,
        nonceStr: prepay.nonceStr,
        package: prepay.package,
        signType: 'RSA',
        paySign: prepay.paySign,
      },
    };
  }

  private fail(error: unknown): void {
    this.state = {
      ...this.state,
      status: 'error',
      message: error instanceof Error ? error.message : '拼团请求失败，请稍后重试',
    };
  }
}
