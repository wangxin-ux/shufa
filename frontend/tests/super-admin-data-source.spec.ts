import {
  ApiSuperAdminDataSource,
  SuperAdminHttpRequest,
} from "../data/api-super-admin-data-source";
import { MockSuperAdminDataSource } from "../data/mock-super-admin-data-source";
import { SuperAdminDataSource } from "../data/super-admin-data-source";
import { SuperAdminService } from "../services/super-admin.service";

describe("super admin data sources", () => {
  it("uploads a campus customer-service QR with version and idempotency", async () => {
    const uploads: Array<Record<string, unknown>> = [];
    const source = new ApiSuperAdminDataSource({
      baseUrl: "https://example.test/api/",
      accessToken: "super-token",
      uploadFile: (options) => {
        uploads.push(options as unknown as Record<string, unknown>);
        options.success({
          statusCode: 200,
          data: JSON.stringify({
            data: {
              id: "campus-east",
              customerServiceQrCodeUrl:
                "/media/customer-service-qr/file-1?expires=1&signature=abc",
              version: 2,
            },
            requestId: "campus-qr-1",
          }),
        });
      },
    });

    await expect(
      source.uploadCampusCustomerServiceQr(
        "campus-east",
        "/tmp/customer-service.png",
        1,
        "campus-qr-key-0001",
      ),
    ).resolves.toMatchObject({
      version: 2,
      customerServiceQrCodeUrl:
        "https://example.test/api/media/customer-service-qr/file-1?expires=1&signature=abc",
    });
    expect(uploads[0]).toMatchObject({
      url: "https://example.test/api/management/campuses/campus-east/customer-service-qr",
      filePath: "/tmp/customer-service.png",
      name: "file",
      header: {
        Authorization: "Bearer super-token",
        "Idempotency-Key": "campus-qr-key-0001",
      },
      formData: { expectedVersion: "1" },
    });
  });

  it("updates campus map configuration with version and idempotency", async () => {
    const requests: Parameters<SuperAdminHttpRequest>[0][] = [];
    const source = new ApiSuperAdminDataSource({
      baseUrl: "https://example.test",
      accessToken: "super-token",
      request: (options) => {
        requests.push(options);
        options.success({
          statusCode: 200,
          data: {
            data: {
              id: "campus-east",
              address: "长沙市岳麓区启明路 18 号",
              latitude: 28.2282,
              longitude: 112.9388,
              mapVisible: true,
              version: 2,
            },
            requestId: "campus-map-update-1",
          },
        });
      },
    });

    await expect(
      source.updateCampusMapLocation(
        "campus-east",
        {
          address: "长沙市岳麓区启明路 18 号",
          latitude: 28.2282,
          longitude: 112.9388,
          mapVisible: true,
          expectedVersion: 1,
        },
        "campus-map-key-0001",
      ),
    ).resolves.toMatchObject({ version: 2, mapVisible: true });
    expect(requests[0]).toMatchObject({
      method: "PATCH",
      url: "https://example.test/management/campuses/campus-east/map-location",
      header: {
        Authorization: "Bearer super-token",
        "Idempotency-Key": "campus-map-key-0001",
      },
      data: expect.objectContaining({ expectedVersion: 1 }),
    });
  });
  it("loads the global dashboard with bearer authentication", async () => {
    const requests: Parameters<SuperAdminHttpRequest>[0][] = [];
    const source = new ApiSuperAdminDataSource({
      baseUrl: "https://example.test/api/",
      accessToken: () => "super-token",
      request: (options) => {
        requests.push(options);
        options.success({
          statusCode: 200,
          data: {
            data: {
              administrator: { displayName: "系统管理员" },
              campusCount: 2,
              activeStudentCount: 106,
              monthCompletedLessonCount: 72,
              warningStudentCount: 18,
              featuredCampus: null,
              reportingTimeZone: "Asia/Shanghai",
              serverTime: "2026-08-31T08:00:00+08:00",
            },
            requestId: "super-dashboard-1",
          },
        });
      },
    });

    await expect(source.getDashboard("CURRENT_MONTH")).resolves.toMatchObject({
      administrator: { displayName: "系统管理员" },
    });
    expect(requests[0]).toMatchObject({
      method: "GET",
      url: "https://example.test/api/management/dashboard?revenuePeriod=CURRENT_MONTH",
      header: { Authorization: "Bearer super-token" },
    });
  });

  it("returns honest empty and Chinese failure states", async () => {
    await expect(
      new SuperAdminService(
        new MockSuperAdminDataSource({ scenario: "empty" }),
      ).loadDashboard(),
    ).resolves.toMatchObject({ status: "empty" });
    await expect(
      new SuperAdminService(
        new MockSuperAdminDataSource({ scenario: "error" }),
      ).loadDashboard(),
    ).resolves.toEqual({
      status: "error",
      message: "总端数据加载失败，请稍后重试",
    });
  });

  it("keeps created earning rules and their transitions after reloading", async () => {
    const source: SuperAdminDataSource = new MockSuperAdminDataSource();
    const created = await source.createEarningRule(
      {
        campusId: "10000000-0000-4000-8000-000000000001",
        teacherId: null,
        basisType: "PER_COMPLETED_SESSION",
        unitAmountFen: 12000,
        eligibleLessonKinds: ["REGULAR"],
        countedAttendanceStatuses: ["PRESENT"],
        settlementDelayDays: 1,
        effectiveFrom: "2026-09-01T00:00:00+08:00",
      },
      "earning-rule-create-1",
    );

    await expect(
      source.listEarningRules({ page: 1, pageSize: 20 }),
    ).resolves.toEqual(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ id: created.id, status: "DRAFT" }),
        ]),
      }),
    );

    const activated = await source.transitionEarningRule(
      created.id,
      "activate",
      created.version,
      "earning-rule-activate-1",
    );
    await expect(
      source.listEarningRules({ page: 1, pageSize: 20 }),
    ).resolves.toEqual(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            id: created.id,
            status: "ACTIVE",
            version: activated.version,
          }),
        ]),
      }),
    );
  });

  it("keeps created withdrawal policies and their transitions after reloading", async () => {
    const source: SuperAdminDataSource = new MockSuperAdminDataSource();
    const created = await source.createWithdrawalPolicy(
      {
        minimumAmountFen: 20000,
        dailyRequestLimit: 2,
        effectiveFrom: "2026-09-01T00:00:00+08:00",
      },
      "withdrawal-policy-create-1",
    );

    await expect(
      source.listWithdrawalPolicies({ page: 1, pageSize: 20 }),
    ).resolves.toEqual(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ id: created.id, status: "DRAFT" }),
        ]),
      }),
    );

    const activated = await source.transitionWithdrawalPolicy(
      created.id,
      "activate",
      created.version,
      "withdrawal-policy-activate-1",
    );
    await expect(
      source.listWithdrawalPolicies({ page: 1, pageSize: 20 }),
    ).resolves.toEqual(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            id: created.id,
            status: "ACTIVE",
            version: activated.version,
          }),
        ]),
      }),
    );
  });
});
