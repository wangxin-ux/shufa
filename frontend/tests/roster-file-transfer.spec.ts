import {
  RosterFileTransferClient,
  RosterNativeApi,
} from '../services/roster-file-transfer';

function createNativeApi(
  overrides: Partial<RosterNativeApi> = {},
): RosterNativeApi {
  return {
    request: jest.fn(),
    uploadFile: jest.fn(),
    downloadFile: jest.fn(),
    chooseMessageFile: jest.fn(),
    openDocument: jest.fn(),
    getFileSystemManager: () => ({ writeFile: jest.fn() }),
    userDataPath: '/tmp',
    ...overrides,
  };
}

describe('roster file transfer', () => {
  it('chooses one xlsx and previews it with bearer authentication', async () => {
    const chooseMessageFile = jest.fn((options) =>
      options.success({ tempFiles: [{ path: '/tmp/teachers.xlsx', size: 128 }] }),
    );
    const uploadFile = jest.fn((options) =>
      options.success({
        statusCode: 200,
        data: JSON.stringify({
          data: {
            templateVersion: 'TEACHER_V1',
            fileHash: 'hash',
            totalRows: 1,
            validCount: 1,
            duplicateCount: 0,
            errorCount: 0,
            rows: [],
          },
        }),
      }),
    );
    const client = new RosterFileTransferClient(
      { baseUrl: 'https://example.test/api/', accessToken: 'teacher-token' },
      createNativeApi({ chooseMessageFile, uploadFile }),
    );

    const filePath = await client.chooseWorkbook();
    await client.preview('/management/rosters', 'teachers', filePath!);

    expect(chooseMessageFile).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1, type: 'file', extension: ['xlsx'] }),
    );
    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.test/api/management/rosters/teachers/preview',
        filePath: '/tmp/teachers.xlsx',
        name: 'file',
        header: { Authorization: 'Bearer teacher-token' },
      }),
    );
  });

  it('writes a base64 error receipt and opens it with the native menu', async () => {
    const writeFile = jest.fn((options) => options.success());
    const openDocument = jest.fn((options) => options.success());
    const client = new RosterFileTransferClient(
      { baseUrl: 'https://example.test/api', accessToken: 'token' },
      createNativeApi({
        getFileSystemManager: () => ({ writeFile }),
        openDocument,
        userDataPath: '/data',
      }),
    );

    await client.openReceipt({
      templateVersion: 'CUSTOMER_V1',
      fileHash: 'hash',
      totalRows: 1,
      importedCount: 0,
      duplicateCount: 0,
      errorCount: 1,
      rows: [],
      errorReceiptFileName: '顾客/错误回执.xlsx',
      errorReceiptBase64: 'ZmFrZQ==',
    });

    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/data/顾客-错误回执.xlsx',
        data: 'ZmFrZQ==',
        encoding: 'base64',
      }),
    );
    expect(openDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/data/顾客-错误回执.xlsx',
        fileType: 'xlsx',
        showMenu: true,
      }),
    );
  });

  it('exports with filters and rejects unconfigured API mode in Chinese', async () => {
    const downloadFile = jest.fn((options) =>
      options.success({ statusCode: 200, tempFilePath: '/tmp/export.xlsx' }),
    );
    const openDocument = jest.fn((options) => options.success());
    const client = new RosterFileTransferClient(
      { baseUrl: 'https://example.test/api', accessToken: 'token' },
      createNativeApi({ downloadFile, openDocument }),
    );

    await client.openExport('/management/rosters', 'customers', {
      campusId: 'campus/east',
      query: '陈 晨',
    });

    expect(downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        url:
          'https://example.test/api/management/rosters/customers/export?campusId=campus%2Feast&query=%E9%99%88%20%E6%99%A8&confirmed=true',
      }),
    );

    const unconfigured = new RosterFileTransferClient(
      { baseUrl: '', accessToken: '' },
      createNativeApi(),
    );
    expect(() =>
      unconfigured.quickEntry('/management/rosters', 'customers', {}, 'key'),
    ).toThrow('Excel 名册功能需要连接本地接口');
  });
});
