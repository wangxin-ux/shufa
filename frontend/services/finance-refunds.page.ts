import { createSessionService } from "./session.service";
import {
  createFinanceService,
  financeMoney,
  financeToday,
  parseDecimalUnits,
} from "./finance.service";
import { createMutationKey } from "../utils/super-admin-format";
import {
  createRefundApi,
  refundActionGroups,
  REFUND_ACTION_LABELS,
  REFUND_STATUS_LABELS,
  RefundRole,
  RefundView,
  RefundQuote,
  RefundActionInput,
} from "./finance-refunds.service";
import {
  CORRECTION_ACTION_LABELS,
  CORRECTION_STATUS_LABELS,
  CORRECTION_TYPE_LABELS,
  CorrectionAction,
  CorrectionView,
  correctionActionGroups,
  correctionActions,
  createCorrectionApi,
} from "./finance-corrections.service";

function localTime(value: string) {
  return new Date(new Date(value).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function refundView(row: RefundView) {
  return {
    ...row,
    amountLabel: financeMoney(row.amountFen),
    referenceLabel: financeMoney(row.referenceAmountFen),
    mainLabel: String(row.mainUnits / 100),
    giftLabel: String(row.giftUnits / 100),
    statusLabel: REFUND_STATUS_LABELS[row.status],
    createdLabel: localTime(row.createdAt),
    paymentLabel: row.payment
      ? `${financeMoney(row.payment.amountFen)} 元 · ${localTime(row.payment.paidAt)}`
      : "",
    events: row.events.map((event) => ({
      ...event,
      actionLabel: REFUND_ACTION_LABELS[event.action] ?? event.action,
      timeLabel: localTime(event.createdAt),
    })),
  };
}

function correctionSnapshot(snapshot: CorrectionView["original"]) {
  return {
    ...snapshot,
    amountLabel: financeMoney(snapshot.amountFen),
    mainLabel: String(snapshot.package.mainUnits / 100),
    giftLabel: String(snapshot.package.giftUnits / 100),
  };
}

function correctionView(row: CorrectionView) {
  return {
    ...row,
    studentName: row.original.studentName,
    campusName: row.original.campusName,
    amountLabel: financeMoney(row.original.amountFen),
    effectLabel: financeMoney(row.correctionEffectFen ?? 0),
    typeLabel: CORRECTION_TYPE_LABELS[row.type],
    statusLabel: CORRECTION_STATUS_LABELS[row.status],
    createdLabel: localTime(row.createdAt),
    original: correctionSnapshot(row.original),
    proposedReplacement: row.proposedReplacement
      ? correctionSnapshot(row.proposedReplacement)
      : null,
    events: row.events.map((event) => ({
      ...event,
      actionLabel:
        CORRECTION_ACTION_LABELS[
          event.action as keyof typeof CORRECTION_ACTION_LABELS
        ] ?? event.action,
      timeLabel: localTime(event.createdAt),
    })),
  };
}

type RefundDisplay = ReturnType<typeof refundView>;
type CorrectionDisplay = ReturnType<typeof correctionView>;
type ReviewKind = "REFUND" | "CORRECTION";

function statusOptions(kind: ReviewKind) {
  const labels =
    kind === "CORRECTION"
      ? CORRECTION_STATUS_LABELS
      : REFUND_STATUS_LABELS;
  return [
    { code: "", name: "全部状态" },
    ...Object.entries(labels).map(([code, name]) => ({ code, name })),
  ];
}

export function registerRefundPage(role: RefundRole) {
  Page({
    revision: 0,
    quoteRevision: 0,
    mutation: { fingerprint: "", key: "" },
    data: {
      role,
      authorized: false,
      title: role === "FINANCE" ? "退课退费" : "财务审批",
      reviewKind: "REFUND" as ReviewKind,
      reviewKinds: [
        { code: "REFUND", name: "退费审批" },
        { code: "CORRECTION", name: "收款纠错" },
      ],
      detailKind: "" as "" | ReviewKind,
      headerTop: 28,
      headerRight: 100,
      viewState: "loading",
      errorMessage: "",
      receiptId: "",
      receiptLabel: "",
      page: 1,
      hasMore: false,
      rows: [] as Array<RefundDisplay | CorrectionDisplay>,
      statusIndex: 0,
      statuses: statusOptions("REFUND"),
      detail: null as RefundDisplay | CorrectionDisplay | null,
      actions: [] as Array<{ code: string; name: string }>,
      primaryActions: [] as Array<{ code: string; name: string }>,
      secondaryActions: [] as Array<{ code: string; name: string }>,
      showHistory: false,
      formMode: "",
      actionCode: "",
      actionLabel: "",
      formError: "",
      submitting: false,
      quoting: false,
      mainLessons: "",
      giftLessons: "0",
      amount: "",
      reason: "",
      quote: null as RefundQuote | null,
      referenceLabel: "",
      maximumLabel: "",
      proofPath: "",
      proofFileId: "",
      paidDate: "",
      paidTime: "",
      externalReference: "",
    },
    async onLoad(query: Record<string, string | undefined>) {
      const info = wx.getWindowInfo();
      let headerTop = (info.statusBarHeight || 20) + 8;
      let headerRight = 100;
      try {
        const capsule = wx.getMenuButtonBoundingClientRect();
        headerTop = capsule.top;
        headerRight = info.windowWidth - capsule.left + 8;
      } catch {
        // Native capsule fallback.
      }
      this.setData({
        headerTop,
        headerRight,
        receiptId: role === "FINANCE" ? query.receiptId ?? "" : "",
      });
      try {
        const session = await createSessionService().load();
        if (
          !session ||
          session.roles.length !== 1 ||
          session.roles[0].code !== role ||
          session.roles[0].campusId !== null
        )
          throw new Error("请使用对应的总部账号");
        if (this.data.receiptId) {
          const receipt = await createFinanceService().detail(
            this.data.receiptId,
          );
          if (!receipt.issuance) throw new Error("这笔收款尚未发包");
          this.setData({
            receiptLabel: `${receipt.studentName} · ${receipt.campusName} · ${financeMoney(receipt.amountFen)} 元`,
          });
        }
        this.setData({ authorized: true });
        await this.load(false);
      } catch (error) {
        this.setData({ viewState: "error", errorMessage: message(error) });
      }
    },
    async load(append = false) {
      if (!this.data.authorized) return;
      const revision = ++this.revision;
      this.setData({ viewState: "loading", errorMessage: "" });
      try {
        const page = append ? this.data.page + 1 : 1;
        const query: Record<string, string | number> = { page, pageSize: 20 };
        if (this.data.receiptId) query.receiptId = this.data.receiptId;
        const status = this.data.statuses[this.data.statusIndex].code;
        if (status) query.status = status;
        const correctionMode =
          role === "SUPER_ADMIN" && this.data.reviewKind === "CORRECTION";
        const result = correctionMode
          ? await createCorrectionApi("SUPER_ADMIN").list(query)
          : await createRefundApi(role).list(query);
        if (revision !== this.revision) return;
        const items = correctionMode
          ? (result.items as CorrectionView[]).map(correctionView)
          : (result.items as RefundView[]).map(refundView);
        this.setData({
          rows: append ? [...this.data.rows, ...items] : items,
          page,
          hasMore: page * result.pageSize < result.total,
          viewState: result.total ? "ready" : "empty",
        });
      } catch (error) {
        if (revision === this.revision)
          this.setData({
            viewState: "error",
            errorMessage: message(error),
          });
      }
    },
    async onReviewKind(event: WechatMiniprogram.TouchEvent) {
      if (role !== "SUPER_ADMIN" || this.data.submitting) return;
      const kind = String(event.currentTarget.dataset.kind) as ReviewKind;
      if (kind !== "REFUND" && kind !== "CORRECTION") return;
      this.revision += 1;
      this.mutation = { fingerprint: "", key: "" };
      this.setData({
        reviewKind: kind,
        statuses: statusOptions(kind),
        statusIndex: 0,
        page: 1,
        rows: [],
        detail: null,
        detailKind: "",
        formMode: "",
        showHistory: false,
      });
      await this.load(false);
    },
    onRetry() {
      if (this.data.authorized) void this.load(false);
      else void this.onLoad({ receiptId: this.data.receiptId });
    },
    onMore() {
      void this.load(true);
    },
    onStatus(event: WechatMiniprogram.PickerChange) {
      this.setData({ statusIndex: Number(event.detail.value) });
      void this.load(false);
    },
    async onDetail(event: WechatMiniprogram.TouchEvent) {
      if (!this.data.authorized) return;
      try {
        const id = String(event.currentTarget.dataset.id);
        const correctionMode =
          role === "SUPER_ADMIN" && this.data.reviewKind === "CORRECTION";
        if (correctionMode) {
          const detail = await createCorrectionApi("SUPER_ADMIN").detail(id);
          this.setData({
            detail: correctionView(detail),
            detailKind: "CORRECTION",
            ...correctionActionGroups("SUPER_ADMIN", detail.status),
            showHistory: false,
          });
        } else {
          const detail = await createRefundApi(role).detail(id);
          this.setData({
            detail: refundView(detail),
            detailKind: "REFUND",
            ...refundActionGroups(role, detail.status),
            showHistory: false,
          });
        }
      } catch (error) {
        wx.showToast({ title: message(error), icon: "none" });
      }
    },
    onClose() {
      if (!this.data.submitting)
        this.setData({ detail: null, detailKind: "", formMode: "" });
    },
    onCreate() {
      if (
        !this.data.authorized ||
        this.data.submitting ||
        role !== "FINANCE" ||
        !this.data.receiptId
      )
        return;
      this.quoteRevision += 1;
      this.setData({
        formMode: "create",
        quoting: false,
        mainLessons: "",
        giftLessons: "0",
        amount: "",
        reason: "",
        quote: null,
        referenceLabel: "",
        maximumLabel: "",
        formError: "",
      });
    },
    onInput(event: WechatMiniprogram.Input) {
      const field = String(event.currentTarget.dataset.field);
      if (
        ![
          "mainLessons",
          "giftLessons",
          "amount",
          "reason",
          "paidDate",
          "paidTime",
          "externalReference",
        ].includes(field)
      )
        return;
      this.setData({ [field]: event.detail.value });
      if (field === "mainLessons" || field === "giftLessons") {
        this.quoteRevision += 1;
        this.setData({
          quote: null,
          quoting: false,
          referenceLabel: "",
          maximumLabel: "",
        });
      }
    },
    async onQuote() {
      if (
        !this.data.authorized ||
        this.data.submitting ||
        this.data.formMode !== "create"
      )
        return;
      const revision = ++this.quoteRevision;
      this.setData({ quoting: true, formError: "" });
      try {
        const quote = await createRefundApi(role).quote(
          this.data.receiptId,
          parseDecimalUnits(this.data.mainLessons),
          parseDecimalUnits(this.data.giftLessons),
        );
        if (revision !== this.quoteRevision) return;
        this.setData({
          quote,
          referenceLabel: financeMoney(quote.referenceAmountFen),
          maximumLabel: financeMoney(quote.maxAmountFen),
          amount: financeMoney(quote.suggestedAmountFen),
        });
      } catch (error) {
        if (revision === this.quoteRevision)
          this.setData({ formError: message(error) });
      } finally {
        if (revision === this.quoteRevision)
          this.setData({ quoting: false });
      }
    },
    onAction(event: WechatMiniprogram.TouchEvent) {
      this.openAction(String(event.currentTarget.dataset.action));
    },
    onMoreActions() {
      if (
        !this.data.detail ||
        this.data.submitting ||
        !this.data.secondaryActions.length
      )
        return;
      const id = this.data.detail.id;
      const version = this.data.detail.version;
      const actions = this.data.secondaryActions;
      wx.showActionSheet({
        itemList: actions.map((action) => action.name),
        success: ({ tapIndex }) => {
          if (
            this.data.detail?.id !== id ||
            this.data.detail.version !== version
          )
            return;
          const action = actions[tapIndex];
          if (action) this.openAction(action.code);
        },
      });
    },
    onHistory() {
      this.setData({ showHistory: !this.data.showHistory });
    },
    openAction(action: string) {
      if (!this.data.authorized || this.data.submitting || !this.data.detail)
        return;
      if (!this.data.actions.some((item) => item.code === action)) return;
      const now = localTime(new Date().toISOString());
      const actionLabel =
        this.data.detailKind === "CORRECTION"
          ? CORRECTION_ACTION_LABELS[
              action as keyof typeof CORRECTION_ACTION_LABELS
            ]
          : REFUND_ACTION_LABELS[action];
      this.mutation = { fingerprint: "", key: "" };
      this.setData({
        formMode: "action",
        actionCode: action,
        actionLabel,
        reason: "",
        formError: "",
        proofPath: "",
        proofFileId: "",
        paidDate: financeToday(),
        paidTime: now.slice(11),
        externalReference: "",
      });
    },
    onChooseProof() {
      wx.chooseImage({
        count: 1,
        sizeType: ["original"],
        sourceType: ["album", "camera"],
        success: (result) =>
          this.setData({
            proofPath: result.tempFilePaths[0],
            proofFileId: "",
          }),
      });
    },
    async onProof() {
      if (!this.data.detail || this.data.detailKind !== "REFUND") return;
      try {
        const path = await createRefundApi(role).proof(this.data.detail.id);
        wx.previewImage({ urls: [path], current: path });
      } catch (error) {
        wx.showToast({ title: message(error), icon: "none" });
      }
    },
    async onCorrectionProof(event: WechatMiniprogram.TouchEvent) {
      if (!this.data.detail || this.data.detailKind !== "CORRECTION") return;
      try {
        const api = createCorrectionApi("SUPER_ADMIN");
        const path =
          String(event.currentTarget.dataset.kind) === "replacement"
            ? await api.replacementProof(this.data.detail.id)
            : await api.originalProof(this.data.detail.id);
        wx.previewImage({ urls: [path], current: path });
      } catch (error) {
        wx.showToast({ title: message(error), icon: "none" });
      }
    },
    async onSubmit() {
      if (
        !this.data.authorized ||
        this.data.submitting ||
        !this.data.formMode
      )
        return;
      this.setData({ submitting: true, formError: "" });
      try {
        const reason = this.data.reason.trim();
        if (!reason) throw new Error("请填写原因或处理说明");
        if (this.data.detailKind === "CORRECTION") {
          const detail = this.data.detail as CorrectionDisplay | null;
          if (!detail) throw new Error("请重新打开纠错详情");
          const action = this.data.actionCode as CorrectionAction;
          if (
            !correctionActions("SUPER_ADMIN", detail.status).some(
              (item) => item.code === action,
            )
          )
            throw new Error("纠错状态已变化，请刷新详情");
          const body = {
            action,
            expectedVersion: detail.version,
            reason,
          };
          const fingerprint = JSON.stringify({ id: detail.id, body });
          if (fingerprint !== this.mutation.fingerprint)
            this.mutation = {
              fingerprint,
              key: createMutationKey("correction-action"),
            };
          const changed = await createCorrectionApi("SUPER_ADMIN").act(
            detail.id,
            body,
            this.mutation.key,
          );
          this.setData({
            formMode: "",
            detail: correctionView(changed),
            ...correctionActionGroups("SUPER_ADMIN", changed.status),
            showHistory: false,
          });
        } else {
          const api = createRefundApi(role);
          let detail: RefundView;
          if (this.data.formMode === "create") {
            if (!this.data.quote) throw new Error("请先核算参考金额");
            const body = {
              mainUnits: parseDecimalUnits(this.data.mainLessons),
              giftUnits: parseDecimalUnits(this.data.giftLessons),
              amountFen: parseDecimalUnits(this.data.amount),
              reason,
            };
            const fingerprint = JSON.stringify({
              receiptId: this.data.receiptId,
              body,
            });
            if (fingerprint !== this.mutation.fingerprint)
              this.mutation = {
                fingerprint,
                key: createMutationKey("refund-submit"),
              };
            detail = await api.submit(
              this.data.receiptId,
              body,
              this.mutation.key,
            );
          } else {
            const current = this.data.detail as RefundDisplay | null;
            if (!current) throw new Error("请重新打开退费详情");
            const body: RefundActionInput = {
              action: this.data.actionCode,
              expectedVersion: current.version,
              reason,
            };
            if (body.action === "RECORD_PAYMENT") {
              if (!this.data.proofPath)
                throw new Error("请选择实际退款凭证");
              if (!this.data.externalReference.trim())
                throw new Error("请填写退款流水标识");
              if (!this.data.proofFileId) {
                const proof = await api.upload(this.data.proofPath);
                this.setData({ proofFileId: proof.id });
              }
              body.payment = {
                amountFen: current.amountFen,
                paidAt: `${this.data.paidDate}T${this.data.paidTime}+08:00`,
                proofFileId: this.data.proofFileId,
                externalReference: this.data.externalReference.trim(),
              };
            }
            const fingerprint = JSON.stringify({ id: current.id, body });
            if (fingerprint !== this.mutation.fingerprint)
              this.mutation = {
                fingerprint,
                key: createMutationKey("refund-action"),
              };
            detail = await api.act(current.id, body, this.mutation.key);
          }
          this.setData({
            formMode: "",
            detail: refundView(detail),
            detailKind: "REFUND",
            ...refundActionGroups(role, detail.status),
            showHistory: false,
          });
        }
        await this.load(false);
      } catch (error) {
        this.setData({ formError: message(error) });
      } finally {
        this.setData({ submitting: false });
      }
    },
    onFormBack() {
      if (this.data.submitting) return;
      this.quoteRevision += 1;
      this.setData({ formMode: "", quoting: false });
    },
    onBack() {
      if (getCurrentPages().length > 1) wx.navigateBack();
      else
        wx.reLaunch({
          url:
            role === "FINANCE"
              ? "/pages/finance/home/index"
              : "/pages/super-admin/home/index",
        });
    },
    stopTap() {},
  });
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试";
}
