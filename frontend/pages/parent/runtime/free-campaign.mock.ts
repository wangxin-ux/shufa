import { SessionServiceError } from '../../../services/session.service';
import type { FreeCampaign, FreeCampaignSummary, FreeConfiguration, FreePage, FreeRegistration, FreeRegistrationReceipt } from './free-campaign.service';

const campaignId = '00000000-0000-4000-8000-000000000101';
const versionId = '00000000-0000-4000-8000-000000000102';
const students = ['00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000104'];
const settings: FreeConfiguration = {
  title: '合成免费体验活动（模拟）', shareDescription: '合成已批准活动，仅登记报名，不发放课时。',
  contactPhone: null, campaignType: 'FREE_REGISTRATION', startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2030-10-01T00:00:00.000Z', timezone: 'Asia/Shanghai', capacityMode: 'UNLIMITED',
  maxRegistrations: null, feeFen: 0, benefitMode: 'NONE', registrationLimit: 'ONCE_PER_STUDENT',
};
// This synthetic adapter is independent of partner drafts and API facts.
export class FreeCampaignMock {
  private readonly rows = new Map<string, FreeRegistration>();
  private readonly receipts = new Map<string, { fingerprint: string; receipt: FreeRegistrationReceipt }>();
  private sequence = 0;
  private notFound(): never { throw new SessionServiceError(404, 'RESOURCE_NOT_FOUND', '合成活动或报名结果不可访问'); }
  private own(owner: string) { return [...this.rows.entries()].filter(([key]) => key.startsWith(`${owner}:`)).map(([, row]) => row); }
  private count(owner: string) { return this.own(owner).filter((row) => row.status === 'REGISTERED').length; }
  private page<T>(rows: T[], page: number): FreePage<T> {
    return { data: rows.slice((page - 1) * 20, page * 20), meta: { page, pageSize: 20, total: rows.length, totalPages: Math.ceil(rows.length / 20) } };
  }
  private receipt(row: FreeRegistration): FreeRegistrationReceipt {
    const { title: _title, timezone: _zone, startsAt: _start, endsAt: _end, canCancel: _cancel, ...receipt } = row;
    return { ...receipt };
  }
  listCampaigns(owner: string, page: number): FreePage<FreeCampaignSummary> {
    const { title, startsAt, endsAt, timezone, maxRegistrations } = settings;
    return this.page([{ campaignId, versionId, title, startsAt, endsAt, timezone, maxRegistrations,
      availability: 'AVAILABLE', remainingRegistrations: null, registeredCount: this.count(owner) }], page);
  }
  getCampaign(owner: string, requestedId: string, requestedVersion?: string): FreeCampaign {
    if (requestedId !== campaignId || (requestedVersion && requestedVersion !== versionId)) this.notFound();
    return { campaignId, versionId, configuration: { ...settings }, availability: 'AVAILABLE',
      registeredCount: this.count(owner), remainingRegistrations: null,
      eligibleStudents: students.map((studentId, index) => {
        const row = this.rows.get(`${owner}:${studentId}`);
        return { studentId, displayName: index === 0 ? '合成小明' : '合成小红',
          eligibility: row ? 'ALREADY_REGISTERED' : 'ELIGIBLE', registration: row ? this.receipt(row) : null };
      }) };
  }
  listRegistrations(owner: string, page: number) { return this.page(this.own(owner).map((row) => ({ ...row })).reverse(), page); }
  getRegistration(owner: string, registrationId: string): FreeRegistration {
    const row = this.own(owner).find((row) => row.registrationId === registrationId);
    if (!row) this.notFound();
    return { ...row };
  }
  private write(owner: string, key: string, input: unknown[], execute: () => FreeRegistrationReceipt) {
    const fingerprint = JSON.stringify(input);
    const receiptKey = `${owner}:${key}`;
    const prior = this.receipts.get(receiptKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new SessionServiceError(409, 'IDEMPOTENCY_CONFLICT', '请求内容已变化');
      return { ...prior.receipt };
    }
    const receipt = execute();
    this.receipts.set(receiptKey, { fingerprint, receipt: { ...receipt } });
    return receipt;
  }
  register(owner: string, requestedId: string, requestedVersion: string, studentId: string, key: string) {
    return this.write(owner, key, ['register', requestedId, requestedVersion, studentId], () => {
      this.getCampaign(owner, requestedId, requestedVersion);
      if (!students.includes(studentId)) this.notFound();
      if (this.rows.has(`${owner}:${studentId}`)) throw new SessionServiceError(409, 'FREE_CAMPAIGN_ALREADY_REGISTERED', '该孩子已使用本活动报名资格');
      const row: FreeRegistration = {
        registrationId: `00000000-0000-4000-8000-${String(++this.sequence + 200).padStart(12, '0')}`,
        campaignId, versionId, studentId, status: 'REGISTERED', version: 1, registeredAt: '2026-10-13T00:00:00.000Z',
        cancelledAt: null, title: settings.title, timezone: settings.timezone, startsAt: settings.startsAt,
        endsAt: settings.endsAt, canCancel: true,
      };
      this.rows.set(`${owner}:${studentId}`, row);
      return this.receipt(row);
    });
  }
  cancel(owner: string, registrationId: string, version: number, key: string) {
    return this.write(owner, key, ['cancel', registrationId, version], () => {
      const row = this.getRegistration(owner, registrationId);
      if (!row.canCancel || row.version !== version) throw new SessionServiceError(409, 'FREE_REGISTRATION_STATUS_CONFLICT', '报名状态已更新');
      const next: FreeRegistration = { ...row, status: 'CANCELLED', version: version + 1,
        cancelledAt: '2026-10-13T01:00:00.000Z', canCancel: false };
      this.rows.set(`${owner}:${row.studentId}`, next);
      return this.receipt(next);
    });
  }
}
