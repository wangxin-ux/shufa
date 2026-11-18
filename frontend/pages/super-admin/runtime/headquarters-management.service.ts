import type { StaffAccountPort } from './staff-account-runtime';
import { headquartersAccount, ManagementError, pageRows, record, responseInvalid, uuid,
  type CampusChoice, type CampusGrant, type GrantInput, type HeadquartersAccount, type HeadquartersCreation,
  type ManagementRequest } from './headquarters-management.types';

export class HeadquartersManagementService {
  constructor(private readonly send: ManagementRequest, private readonly staff: StaffAccountPort) {}
  async create(input: HeadquartersCreation, key: string) {
    const value = await this.send('/management/operator-headquarters', 'POST', input, key);
    const row = record(value) ? value.data : undefined, result = headquartersAccount(row);
    if (!result || !record(row) || Object.keys(row).sort().join(',') !==
      ['id', 'displayName', 'maskedPhone', 'roleCode', 'campusId', 'status', 'version', 'createdAt'].sort().join(',') ||
      result.displayName !== input.displayName || result.maskedPhone !== '+86****' + input.phone.slice(-4) ||
      result.status !== 'ACTIVE' || result.version !== 1) responseInvalid();
    return result;
  }
  async grants(userId: string) {
    if (!uuid(userId)) responseInvalid();
    const rows: CampusGrant[] = [], seen = new Set<string>();
    let total: number | undefined, previous = '';
    for (let page = 1;; page++) {
      const value = await this.send(`/management/operator-headquarters/${userId}/campuses?page=${page}&pageSize=100`, 'GET');
      const current = pageRows(value, page, 100);
      if (total !== undefined && total !== current.total) responseInvalid();
      total = current.total;
      for (const raw of current.rows) {
        const row = this.grant(raw, userId);
        if (row.version < 1 || seen.has(row.campusId) || previous && row.campusId <= previous) responseInvalid();
        previous = row.campusId; seen.add(row.campusId); rows.push(row);
      }
      if (rows.length === total) return rows;
    }
  }
  async campuses(): Promise<CampusChoice[]> {
    const rows: CampusChoice[] = [], seen = new Set<string>(); let total: number | undefined;
    for (let page = 1;; page++) {
      const result = await this.staff.loadCampuses({ page, pageSize: 100 });
      if (result.status === 'error') throw new ManagementError(Number(result.statusCode) || 0, 'CAMPUS_READ_FAILED', result.message);
      if (result.status !== 'success' && result.status !== 'empty') responseInvalid();
      const current = pageRows(result.data, page, 100);
      if (total !== undefined && total !== current.total) responseInvalid();
      total = current.total;
      for (const row of current.rows) {
        if (!record(row) || !uuid(row.id) || typeof row.name !== 'string' || !row.name.trim() ||
          row.name.length > 200 || seen.has(row.id)) responseInvalid();
        seen.add(row.id); rows.push({ id: row.id, name: row.name });
      }
      if (rows.length === total) return rows;
    }
  }
  async accounts(query = '') {
    const rows: unknown[] = [], ids = new Set<string>(); let total: number | undefined;
    for (let page = 1;; page++) {
      const result = await this.staff.loadStaffAccounts({ page, pageSize: 100, query: query || undefined });
      if (result.status === 'error') throw new ManagementError(Number(result.statusCode) || 0, 'STAFF_READ_FAILED', result.message);
      if (result.status !== 'success' && result.status !== 'empty') responseInvalid();
      const current = pageRows(result.data, page, 100);
      if (total !== undefined && total !== current.total) responseInvalid();
      total = current.total;
      for (const row of current.rows) {
        if (!record(row) || typeof row.id !== 'string' || !row.id || row.id.length > 100 || ids.has(row.id)) responseInvalid();
        ids.add(row.id); rows.push(row);
      }
      if (rows.length === total) return rows;
    }
  }
  async target(id: string): Promise<HeadquartersAccount> {
    const account = (await this.accounts()).find(row => record(row) && row.id === id);
    const target = headquartersAccount(account);
    if (!target) throw new ManagementError(404, 'HEADQUARTERS_LIST_DEPENDENCY', '账号列表尚未提供此总部运营账号，请刷新后核对');
    return target;
  }
  async update(userId: string, campusId: string, input: GrantInput, key: string) {
    if (!uuid(userId) || !uuid(campusId) || typeof input.isActive !== 'boolean' ||
      !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 2147483647) responseInvalid();
    const value = await this.send(`/management/operator-headquarters/${userId}/campuses/${campusId}`, 'PUT', input, key);
    const row = this.grant(record(value) ? value.data : undefined, userId);
    if (row.campusId !== campusId || row.isActive !== input.isActive ||
      ![input.expectedVersion, input.expectedVersion + 1].includes(row.version)) responseInvalid();
    return row;
  }
  private grant(value: unknown, userId: string): CampusGrant {
    if (!record(value) || Object.keys(value).sort().join(',') !== 'campusId,isActive,userId,version' ||
      value.userId !== userId || !uuid(value.campusId) || typeof value.isActive !== 'boolean' ||
      !Number.isInteger(value.version) || Number(value.version) < 0 || Number(value.version) > 2147483647) responseInvalid();
    return value as unknown as CampusGrant;
  }
}
