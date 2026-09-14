import * as fs from "fs";
import * as path from "path";
import {
  ApiCampusManagerDataSource,
  CampusManagerHttpRequest,
} from "../data/api-campus-manager-data-source";
import { MockCampusManagerDataSource } from "../data/mock-campus-manager-data-source";
import {
  buildCampusManagerLeaveItems,
  mergeCampusManagerLeaveHistory,
} from "../services/campus-manager-leave.presenter";
import {
  CampusManagerLeaveWorkflow,
  validateCampusManagerRejectReason,
} from "../services/campus-manager-leave.workflow";
import {
  CampusManagerLeaveRequest,
  CampusManagerPage,
} from "../types/campus-manager";
import { RequestState } from "../utils/request-state";

const pendingLeave: CampusManagerLeaveRequest = {
  id: "51000000-0000-4000-8000-000000000001",
  studentId: "40000000-0000-4000-8000-000000000001",
  studentName: "陈晨",
  lessonSessionId: "70000000-0000-4000-8000-000000000002",
  courseName: "创意基础",
  startsAt: "2026-09-01T06:00:00.000Z",
  reason: "参加学校集体活动",
  status: "PENDING",
  reviewerName: null,
  reviewedAt: null,
  reviewReason: null,
  version: 1,
  createdAt: "2026-08-30T00:00:00.000Z",
};

const approvedLeave: CampusManagerLeaveRequest = {
  ...pendingLeave,
  id: "51000000-0000-4000-8000-000000000002",
  status: "APPROVED",
  reviewerName: "周园长",
  reviewedAt: "2026-08-30T01:00:00.000Z",
  reviewReason: "已核对课程安排",
  version: 2,
};

interface WorkflowService {
  approveLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string | undefined,
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerLeaveRequest>>;
  rejectLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string,
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerLeaveRequest>>;
}

describe("campus manager leave approval", () => {
  it("builds Chinese pending/history rows and keeps terminal rows read-only", () => {
    expect(buildCampusManagerLeaveItems([pendingLeave, approvedLeave])).toEqual([
      expect.objectContaining({
        id: pendingLeave.id,
        studentName: "陈晨",
        lessonLabel: "2026年9月1日 14:00 · 创意基础",
        statusLabel: "待审批",
        canReview: true,
      }),
      expect.objectContaining({
        id: approvedLeave.id,
        statusLabel: "已批准",
        reviewerLabel: "周园长 · 2026年8月30日 09:00",
        reviewReasonLabel: "审批说明：已核对课程安排",
        canReview: false,
      }),
    ]);
    expect(
      mergeCampusManagerLeaveHistory(
        [approvedLeave],
        [{ ...approvedLeave, id: "later", createdAt: "2026-08-31T00:00:00.000Z" }],
      ).map(({ id }) => id),
    ).toEqual(["later", approvedLeave.id]);
    expect(
      buildCampusManagerLeaveItems([
        {
          ...approvedLeave,
          status: "REJECTED",
          reviewReason: "超过可审批时段",
        },
      ])[0].reviewReasonLabel,
    ).toBe("驳回原因：超过可审批时段");
  });

  it("validates rejection reasons, locks duplicate taps, and reuses retry keys", async () => {
    expect(validateCampusManagerRejectReason("  ")).toBe("请填写驳回原因");
    expect(validateCampusManagerRejectReason("原".repeat(501))).toBe(
      "驳回原因不能超过 500 字",
    );
    expect(validateCampusManagerRejectReason("  资料不完整  ")).toBeNull();

    let release: (
      state: RequestState<CampusManagerLeaveRequest>,
    ) => void = () => undefined;
    const approveLeaveRequest = jest.fn<
      ReturnType<WorkflowService["approveLeaveRequest"]>,
      Parameters<WorkflowService["approveLeaveRequest"]>
    >();
    const rejectLeaveRequest = jest
      .fn<
        ReturnType<WorkflowService["rejectLeaveRequest"]>,
        Parameters<WorkflowService["rejectLeaveRequest"]>
      >()
      .mockImplementationOnce(
        () =>
          new Promise<RequestState<CampusManagerLeaveRequest>>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce({ status: "error", message: "网络不可用" })
      .mockResolvedValueOnce({
        status: "error",
        statusCode: 409,
        code: "CONFLICT",
        message: "数据已更新，请刷新后重试",
        details: { currentVersion: 2 },
      });
    const workflow = new CampusManagerLeaveWorkflow(
      { approveLeaveRequest, rejectLeaveRequest },
      { createIdempotencyKey: () => "leave-review-key-1" },
    );

    const first = workflow.reject(pendingLeave.id, 1, "  资料不完整  ");
    expect(workflow.reject(pendingLeave.id, 1, "资料不完整")).toBe(first);
    release({ status: "error", message: "网络不可用" });
    await expect(first).resolves.toMatchObject({ status: "error" });
    await expect(
      workflow.reject(pendingLeave.id, 1, "资料不完整"),
    ).resolves.toMatchObject({ status: "error" });
    await expect(
      workflow.reject(pendingLeave.id, 1, "资料不完整"),
    ).resolves.toEqual(
      expect.objectContaining({ status: "conflict", currentVersion: 2 }),
    );
    expect(rejectLeaveRequest.mock.calls.map((call) => call[3])).toEqual([
      "leave-review-key-1",
      "leave-review-key-1",
      "leave-review-key-1",
    ]);
    expect(rejectLeaveRequest.mock.calls[0][2]).toBe("资料不完整");
  });

  it("sends paged list and versioned approve/reject contracts", async () => {
    const requests: Parameters<CampusManagerHttpRequest>[0][] = [];
    const request: CampusManagerHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data: options.url.includes("?")
          ? {
              data: [pendingLeave],
              meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
              requestId: "leave-list",
            }
          : { data: approvedLeave, requestId: "leave-review" },
      });
    };
    const source = new ApiCampusManagerDataSource({
      baseUrl: "https://example.test",
      accessToken: "manager-token",
      request,
    });

    await source.listLeaveRequests({
      page: 1,
      pageSize: 20,
      status: "PENDING",
    });
    await source.approveLeaveRequest(
      pendingLeave.id,
      1,
      "同意请假",
      "leave-approve-1",
    );
    await source.rejectLeaveRequest(
      pendingLeave.id,
      1,
      "资料不完整",
      "leave-reject-1",
    );

    expect(requests[0].url).toBe(
      "https://example.test/campus-managers/me/leave-requests?page=1&pageSize=20&status=PENDING",
    );
    expect(requests[1]).toMatchObject({
      method: "POST",
      url: `https://example.test/campus-managers/me/leave-requests/${pendingLeave.id}/approve`,
      data: { version: 1, reviewReason: "同意请假" },
      header: { "Idempotency-Key": "leave-approve-1" },
    });
    expect(requests[2]).toMatchObject({
      method: "POST",
      url: `https://example.test/campus-managers/me/leave-requests/${pendingLeave.id}/reject`,
      data: { version: 1, reviewReason: "资料不完整" },
      header: { "Idempotency-Key": "leave-reject-1" },
    });
  });

  it("mock review refreshes list counts, replays safely, and blocks terminal review", async () => {
    const source = new MockCampusManagerDataSource();
    const before = await source.listLeaveRequests({
      page: 1,
      pageSize: 20,
      status: "PENDING",
    });
    const first = await source.approveLeaveRequest(
      pendingLeave.id,
      1,
      "同意请假",
      "mock-leave-approve-1",
    );
    const replay = await source.approveLeaveRequest(
      pendingLeave.id,
      1,
      "同意请假",
      "mock-leave-approve-1",
    );
    const after = await source.listLeaveRequests({
      page: 1,
      pageSize: 20,
      status: "PENDING",
    });

    expect(before.meta.total).toBe(2);
    expect(after.meta.total).toBe(1);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      status: "APPROVED",
      reviewerName: "周园长",
      reviewReason: "同意请假",
      version: 2,
    });
    await expect(
      source.rejectLeaveRequest(
        pendingLeave.id,
        2,
        "改为驳回",
        "mock-leave-reject-1",
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("restores the dedicated PSD approval composition without dropping workflow controls", () => {
    const root = path.resolve(__dirname, "..");
    const pageDir = path.join(root, "pages/campus-manager/leave-requests");
    const assetDir = path.join(root, "pages/campus-manager/assets");
    const markup = fs.readFileSync(path.join(pageDir, "index.wxml"), "utf8");
    const logic = fs.readFileSync(path.join(pageDir, "index.ts"), "utf8");
    const styles = fs.readFileSync(path.join(pageDir, "index.wxss"), "utf8");
    const app = JSON.parse(
      fs.readFileSync(path.join(root, "app.json"), "utf8"),
    ) as { subPackages: Array<{ root: string; pages: string[] }> };
    const pages =
      app.subPackages.find((item) => item.root === "pages/campus-manager")
        ?.pages ?? [];
    const source = `${markup}\n${logic}`;

    expect(markup).toContain("请假审批");
    expect(markup).toContain("待审批");
    expect(markup).toContain("审批记录");
    expect(markup).toContain("批准");
    expect(markup).toContain("驳回");
    expect(markup).toContain("驳回原因");
    expect(markup).toContain('surfacePage="{{true}}"');
    expect(markup).toContain('markTitle="教务"');
    expect(markup).toContain('markIconSize="40"');
    expect(markup).toContain(
      "/pages/campus-manager/assets/leave-mark-glyph.png",
    );
    expect(markup).toContain(
      "/pages/campus-manager/assets/leave-character.png",
    );
    expect(markup).toContain('class="approval-card"');
    expect(markup).toContain('class="approval-card__fields"');
    expect(markup).toContain('class="leave-records__title"');
    expect(markup).toContain('id="leave-record-{{item.id}}"');
    expect(markup).not.toContain('leave-records__sync');
    expect(source).toContain("onRequestSelectTap");
    expect(source).toMatch(/loading|empty|error|forbidden|submitting/);
    expect(source).toMatch(
      /onRetry|onTabTap|onApproveTap|onRejectTap|onRejectSubmit/,
    );
    expect(source).not.toMatch(/撤销审批|重新审批|删除申请/);
    expect(styles).toMatch(
      /\.leave-control[\s\S]*align-items:\s*center[\s\S]*justify-content:\s*center/,
    );
    expect(styles).toMatch(
      /\.approval-card\s*\{[^}]*width:\s*calc\(100% - 34rpx\)[^}]*min-height:\s*757rpx[^}]*overflow:\s*hidden[^}]*border-radius:\s*32rpx[^}]*background:\s*#ffd75e/s,
    );
    expect(styles).toMatch(
      /\.approval-card__character\s*\{[^}]*top:\s*135rpx[^}]*left:\s*259rpx[^}]*width:\s*557rpx/s,
    );
    expect(styles).toMatch(
      /\.approval-card__approve\s*\{[^}]*min-height:\s*88rpx[^}]*background:\s*#fe8419/s,
    );
    expect(styles).toMatch(
      /\.approval-card__reject\s*\{[^}]*font-family:\s*var\(--campus-manager-font-display\)[^}]*font-size:\s*31rpx/s,
    );
    expect(styles).toMatch(
      /\.leave-record\s*\{[^}]*min-height:\s*160rpx[^}]*border-radius:\s*24rpx[^}]*background:\s*#f6d469/s,
    );
    expect(fs.existsSync(path.join(assetDir, "leave-character.png"))).toBe(true);
    expect(fs.existsSync(path.join(assetDir, "leave-mark-glyph.png"))).toBe(true);
    expect(pages).toContain("leave-requests/index");
  });
});
