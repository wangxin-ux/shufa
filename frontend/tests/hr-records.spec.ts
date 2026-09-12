import { HrRecordsApi, HrTeacherRecord } from "../services/hr-records.service";

function response(data: unknown, statusCode = 200) {
  return { statusCode, data: { data } };
}

describe("HR teacher record service", () => {
  const record: HrTeacherRecord = {
    id: "record-1",
    teacherId: "teacher-1",
    kind: "QUALIFICATION",
    title: "家庭教育指导师",
    organization: null,
    occurredOn: "2026-08-01",
    expiresOn: null,
    note: "",
    attachmentFileId: "file-1",
    attachment: {
      id: "file-1",
      originalName: "certificate.png",
      mimeType: "image/png",
      sizeBytes: 12,
    },
    version: 1,
    status: "ACTIVE",
    archivedAt: null,
    createdByName: "总部人力",
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
  };

  it("uses dedicated authenticated endpoints and idempotency headers", async () => {
    const request = jest.fn((options) => {
      options.success(
        response(
          options.method === "GET"
            ? { items: [record], total: 1, page: 1, pageSize: 20 }
            : record,
          options.method === "POST" ? 201 : 200,
        ),
      );
    });
    const api = new HrRecordsApi("https://example.test/", () => "hr-token", {
      request,
    });
    await api.list("teacher/1", {
      page: 1,
      pageSize: 20,
      kind: "TRAINING",
      status: "ALL",
    });
    await api.create(
      "teacher/1",
      { kind: "TRAINING", title: "复训", occurredOn: "2026-09-01" },
      "hr-record-create-1",
    );
    await api.update(
      "record/1",
      {
        kind: "GROWTH",
        title: "晋级",
        organization: null,
        occurredOn: "2026-09-02",
        expiresOn: null,
        note: "",
        attachmentFileId: null,
        expectedVersion: 1,
      },
      "hr-record-update-1",
    );
    await api.archive(
      "record/1",
      { expectedVersion: 2, reason: "历史归档" },
      "hr-record-archive-1",
    );

    expect(request.mock.calls[0][0]).toMatchObject({
      url: "https://example.test/hr/teachers/teacher%2F1/records",
      method: "GET",
      header: { Authorization: "Bearer hr-token" },
      data: { page: 1, pageSize: 20, kind: "TRAINING", status: "ALL" },
    });
    expect(request.mock.calls[1][0]).toMatchObject({
      url: "https://example.test/hr/teachers/teacher%2F1/records",
      method: "POST",
      header: {
        Authorization: "Bearer hr-token",
        "Idempotency-Key": "hr-record-create-1",
        "Content-Type": "application/json",
      },
    });
    expect(request.mock.calls[2][0]).toMatchObject({
      url: "https://example.test/hr/teacher-records/record%2F1",
      method: "PATCH",
      header: { "Idempotency-Key": "hr-record-update-1" },
    });
    expect(request.mock.calls[3][0]).toMatchObject({
      url: "https://example.test/hr/teacher-records/record%2F1/archive",
      method: "POST",
      header: { "Idempotency-Key": "hr-record-archive-1" },
    });
  });

  it("uploads one private attachment and parses the wrapped response", async () => {
    const uploadFile = jest.fn((options) =>
      options.success({
        statusCode: 201,
        data: JSON.stringify({ data: record.attachment }),
      }),
    );
    const api = new HrRecordsApi("https://example.test", () => "hr-token", {
      uploadFile,
    });
    await expect(
      api.uploadAttachment("wxfile://certificate.png"),
    ).resolves.toEqual(record.attachment);
    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.test/hr/teacher-record-attachments",
        filePath: "wxfile://certificate.png",
        name: "file",
        header: { Authorization: "Bearer hr-token" },
      }),
    );
  });

  it("downloads attachments with authorization before native image or PDF preview", async () => {
    const downloadFile = jest.fn((options) =>
      options.success({ statusCode: 200, tempFilePath: "wxfile://downloaded" }),
    );
    const previewImage = jest.fn((options) => options.success());
    const openDocument = jest.fn((options) => options.success());
    const api = new HrRecordsApi("https://example.test", () => "hr-token", {
      downloadFile,
      previewImage,
      openDocument,
    });
    await api.previewAttachment(record);
    await api.previewAttachment({
      ...record,
      id: "record-pdf",
      attachment: {
        ...record.attachment!,
        mimeType: "application/pdf",
        originalName: "certificate.pdf",
      },
    });
    expect(downloadFile.mock.calls[0][0]).toMatchObject({
      url: "https://example.test/hr/teacher-records/record-1/attachment",
      header: { Authorization: "Bearer hr-token" },
    });
    expect(previewImage).toHaveBeenCalledWith(
      expect.objectContaining({
        current: "wxfile://downloaded",
        urls: ["wxfile://downloaded"],
      }),
    );
    expect(openDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "wxfile://downloaded",
        fileType: "pdf",
        showMenu: true,
      }),
    );
  });

  it("fails closed for missing credentials and rejected native requests", async () => {
    const api = new HrRecordsApi("https://example.test", () => "", {});
    await expect(
      api.list("teacher-1", { page: 1, pageSize: 20 }),
    ).rejects.toThrow("请先登录总部人力账号");
    const failing = new HrRecordsApi("https://example.test", () => "hr-token", {
      request: (options) =>
        options.success({
          statusCode: 409,
          data: { error: { code: "CONFLICT" } },
        }),
    });
    await expect(
      failing.archive(
        "record-1",
        { expectedVersion: 1, reason: "历史归档" },
        "archive-conflict-1",
      ),
    ).rejects.toThrow("记录已被更新");
  });
});
