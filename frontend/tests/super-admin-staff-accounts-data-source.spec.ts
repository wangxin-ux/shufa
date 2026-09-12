import {
  ApiSuperAdminDataSource,
  SuperAdminHttpRequest,
} from '../data/api-super-admin-data-source';
import { MockSuperAdminDataSource } from '../data/mock-super-admin-data-source';
import { SuperAdminDataSource } from '../data/super-admin-data-source';
import { SuperAdminService } from '../services/super-admin.service';

describe('super admin staff account data source', () => {
  it.each(['HR', 'FINANCE'] as const)('creates and lists headquarters %s with no campus', async (roleCode) => {
    const source = new MockSuperAdminDataSource();
    const created = await source.createStaffAccount({
      displayName: '总部工作人员', phone: '13600136000', roleCode, campusId: null,
    } as never, `hq-${roleCode}`);
    expect(created).toMatchObject({ roleCode, campusId: null, campusName: '总部' });
    const result = await source.listStaffAccounts({ page: 1, pageSize: 20, query: '总部工作人员' });
    expect(result.data).toEqual([created]);
    await expect(source.createStaffAccount({
      displayName: '错误范围', phone: '13500135000', roleCode,
      campusId: '10000000-0000-4000-8000-000000000001',
    } as never, `bad-hq-${roleCode}`)).rejects.toThrow('总部账号不能关联校区');
  });
  it('serializes list filters and sends idempotency headers for every mutation', async () => {
    const requests: Parameters<SuperAdminHttpRequest>[0][] = [];
    const source = new ApiSuperAdminDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: 'super-token',
      request: (options) => {
        requests.push(options);
        if (options.method === 'GET') {
          options.success({
            statusCode: 200,
            data: {
              data: [accountFixture()],
              meta: { page: 2, pageSize: 10, total: 1, totalPages: 1 },
            },
          });
          return;
        }
        options.success({ statusCode: options.method === 'POST' ? 201 : 200, data: { data: accountFixture() } });
      },
    });

    await source.listStaffAccounts({
      page: 2,
      pageSize: 10,
      query: '林 老师',
      roleCode: 'TEACHER',
      campusId: 'campus/one',
      status: 'ACTIVE',
    });
    await source.createStaffAccount(
      {
        displayName: '林校长',
        phone: '13800138000',
        roleCode: 'CAMPUS_MANAGER',
        campusId: 'campus-1',
      },
      'staff-create-key',
    );
    await source.updateStaffAccountStatus(
      'staff/one',
      { status: 'DISABLED', expectedVersion: 1 },
      'staff-status-key',
    );
    await source.unbindStaffWechat(
      'staff/one',
      { expectedVersion: 2 },
      'staff-unbind-key',
    );

    expect(requests.map(({ url }) => url)).toEqual([
      'https://example.test/api/management/staff-accounts?page=2&pageSize=10&query=%E6%9E%97%20%E8%80%81%E5%B8%88&roleCode=TEACHER&campusId=campus%2Fone&status=ACTIVE',
      'https://example.test/api/management/staff-accounts',
      'https://example.test/api/management/staff-accounts/staff%2Fone/status',
      'https://example.test/api/management/staff-accounts/staff%2Fone/unbind-wechat',
    ]);
    expect(requests.slice(1).map(({ header }) => header)).toEqual([
      { Authorization: 'Bearer super-token', 'Idempotency-Key': 'staff-create-key' },
      { Authorization: 'Bearer super-token', 'Idempotency-Key': 'staff-status-key' },
      { Authorization: 'Bearer super-token', 'Idempotency-Key': 'staff-unbind-key' },
    ]);
    expect(requests[1].data).toEqual(
      expect.objectContaining({ roleCode: 'CAMPUS_MANAGER', phone: '13800138000' }),
    );
  });

  it('maps stable staff errors to concise Chinese messages', async () => {
    const source = new ApiSuperAdminDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'super-token',
      request: (options) =>
        options.success({
          statusCode: 409,
          data: {
            code: 'STAFF_PHONE_ALREADY_EXISTS',
            message: 'A staff account already uses this phone number',
          },
        }),
    });

    await expect(
      source.createStaffAccount(
        {
          displayName: '林校长',
          phone: '13800138000',
          roleCode: 'CAMPUS_MANAGER',
          campusId: 'campus-1',
        },
        'staff-create-key',
      ),
    ).rejects.toMatchObject({
      code: 'STAFF_PHONE_ALREADY_EXISTS',
      message: '该手机号已创建工作人员账号',
    });
  });

  it('keeps mock create, status, and unbind state consistent', async () => {
    const source: SuperAdminDataSource = new MockSuperAdminDataSource();
    const created = await source.createStaffAccount(
      {
        displayName: '周校长',
        phone: '13900139000',
        roleCode: 'CAMPUS_MANAGER',
        campusId: '10000000-0000-4000-8000-000000000001',
      },
      'mock-staff-create',
    );
    expect(created).toMatchObject({
      displayName: '周校长',
      maskedPhone: '+86****9000',
      bindingStatus: 'UNBOUND',
      status: 'ACTIVE',
      version: 1,
    });

    const disabled = await source.updateStaffAccountStatus(
      created.id,
      { status: 'DISABLED', expectedVersion: 1 },
      'mock-staff-disable',
    );
    expect(disabled).toMatchObject({ status: 'DISABLED', version: 2 });
    await expect(
      source.listStaffAccounts({ page: 1, pageSize: 20, query: '周校长' }),
    ).resolves.toEqual(
      expect.objectContaining({
        data: [expect.objectContaining({ id: created.id, status: 'DISABLED' })],
      }),
    );
    await expect(
      source.createStaffAccount(
        {
          displayName: '应从教师名册录入',
          phone: '13700137000',
          roleCode: 'TEACHER',
          campusId: '10000000-0000-4000-8000-000000000001',
        } as never,
        'mock-staff-invalid',
      ),
    ).rejects.toThrow('教师请从教师名册录入');
  });

  it('exposes empty and error states through the existing service wrapper', async () => {
    await expect(
      new SuperAdminService(
        new MockSuperAdminDataSource({ scenario: 'empty' }),
      ).loadStaffAccounts({ page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({ status: 'empty' });
    await expect(
      new SuperAdminService(
        new MockSuperAdminDataSource({ scenario: 'error' }),
      ).loadStaffAccounts({ page: 1, pageSize: 20 }),
    ).resolves.toEqual({
      status: 'error',
      message: '总端数据加载失败，请稍后重试',
    });
  });
});

function accountFixture() {
  return {
    id: 'staff-1',
    displayName: '林老师',
    maskedPhone: '+86****8000',
    roleCode: 'TEACHER' as const,
    campusId: 'campus-1',
    campusName: '启明东校区',
    bindingStatus: 'UNBOUND' as const,
    status: 'ACTIVE' as const,
    version: 1,
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
  };
}
