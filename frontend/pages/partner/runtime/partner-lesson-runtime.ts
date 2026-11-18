import { createPartnerRuntimeEnv, PartnerRuntimeEnv } from '../../../config/partner-env';
import { createRuntimeAccessTokenProvider } from '../../../config/local-runtime';
import { ApiPartnerDataSource, PartnerHttpRequest } from '../../../data/api-partner-data-source';
import { MockPartnerDataSource } from '../../../data/mock-partner-data-source';
import { PARTNER_LESSON_ACCOUNT_FIXTURE } from '../../../mock/fixtures/partner.fixture';
import { PartnerService } from '../../../services/partner.service';
import type { PartnerLessonLedgerEntry, PartnerPageQuery } from '../../../types/partner';
import { loadRequestState } from '../../../utils/request-state';

export interface PartnerLessonQuery extends PartnerPageQuery {
  entryType?: PartnerLessonLedgerEntry['entryType'];
  subjectId?: string;
}

export interface PartnerSubject {
  id: string;
  name: string;
  isActive: boolean;
  version: number;
}
const MOCK_SUBJECT: PartnerSubject = {
  id: '00000000-0000-4000-8000-000000000001', name: '硬笔书法', isActive: true, version: 1,
};
const defaultSubjectRequest: PartnerHttpRequest = (options) => wx.request(options);

export const PARTNER_LESSON_FILTERS: ReadonlyArray<{
  value: PartnerLessonLedgerEntry['entryType'] | '';
  label: string;
}> = [
  { value: '', label: '全部类别' },
  { value: 'GRANT', label: '课时发放' },
  { value: 'CONSUME', label: '完成扣课' },
  { value: 'REVERSAL', label: '撤销返还' },
  { value: 'ADJUSTMENT', label: '课时调整' },
  { value: 'REFUND', label: '退课扣回' },
  { value: 'CORRECTION', label: '收款纠错冲正' },
];

class FilteredMockLessonSource extends MockPartnerDataSource {
  constructor(private readonly scenario: PartnerRuntimeEnv['mockScenario']) {
    super({ scenario });
  }

  override async getLessonAccount(query: PartnerLessonQuery) {
    const account = await super.getLessonAccount(query);
    const items = this.scenario === 'empty' ? [] : PARTNER_LESSON_ACCOUNT_FIXTURE.items
      .filter((item) => (!query.entryType || item.entryType === query.entryType) &&
        (!query.subjectId || (query.subjectId === 'UNCLASSIFIED'
          ? item.id !== 'partner-ledger-1'
          : query.subjectId === MOCK_SUBJECT.id && item.id === 'partner-ledger-1')));
    const filtered = !!(query.entryType || query.subjectId);
    const pageItems = filtered
      ? items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
      : account.items;
    return {
      ...account,
      items: pageItems.map((item) => ({
        ...item,
        subject: item.id === 'partner-ledger-1' ? { id: MOCK_SUBJECT.id, name: MOCK_SUBJECT.name } : null,
        teachingContext: item.id === 'partner-ledger-1' ? {
          courseName: '硬笔书法',
          teacherName: '李老师',
          lessonStartsAt: '2026-08-31T06:00:00Z',
        } : null,
      })),
      meta: filtered ? {
        page: query.page, pageSize: query.pageSize, total: items.length,
        totalPages: Math.ceil(items.length / query.pageSize),
      } : account.meta,
    };
  }
}

export function createPartnerLessonService(
  env: PartnerRuntimeEnv = createPartnerRuntimeEnv(),
  request?: PartnerHttpRequest,
) {
  if (env.dataDriver === 'api' && !env.apiBaseUrl.trim()) {
    throw new Error('合作方端 API 地址不能为空');
  }
  const source = env.dataDriver === 'api'
    ? new ApiPartnerDataSource({
      baseUrl: env.apiBaseUrl,
      accessToken: createRuntimeAccessTokenProvider(env.accessToken),
      request,
    })
    : new FilteredMockLessonSource(env.mockScenario);
  const service = new PartnerService(source);
  const token = createRuntimeAccessTokenProvider(env.accessToken);
  const loadSubjects = (current: () => boolean = () => true) => loadRequestState(async () => {
    if (env.dataDriver !== 'api') {
      if (env.mockScenario === 'error') throw new Error('科目加载失败，请重试');
      return env.mockScenario === 'empty' ? [] : [{ ...MOCK_SUBJECT }];
    }
    const rows: PartnerSubject[] = [], ids = new Set<string>();
    let expectedTotal: number | undefined;
    for (let page = 1; ; page++) {
      if (!current()) throw new Error('读取已取消');
      const result = await new Promise<unknown>((resolve, reject) => {
        (request ?? defaultSubjectRequest)({
          url: `${env.apiBaseUrl.replace(/\/$/, '')}/partners/me/subjects?page=${page}&pageSize=100`,
          method: 'GET', header: { Authorization: `Bearer ${token()}` },
          success: (response) => {
            if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
            else reject(Object.assign(new Error('科目加载失败，请重试'), { statusCode: response.statusCode }));
          },
          fail: () => reject(new Error('科目加载失败，请重试')),
        });
      });
      if (!current()) throw new Error('读取已取消');
      const envelope = result as { data?: PartnerSubject[]; meta?: {
        page: number; pageSize: number; total: number; totalPages: number;
      } } | null;
      const meta = envelope?.meta;
      if (!Array.isArray(envelope?.data) || !meta || meta.page !== page || meta.pageSize !== 100 ||
        !Number.isSafeInteger(meta.total) || meta.total < 0 ||
        meta.totalPages !== Math.ceil(meta.total / 100) ||
        (expectedTotal !== undefined && expectedTotal !== meta.total) ||
        envelope.data.length !== Math.min(100, Math.max(0, meta.total - (page - 1) * 100))) {
        throw new Error('科目目录已更新，请重试');
      }
      expectedTotal = meta.total;
      for (const row of envelope.data) {
        if (!row || typeof row.id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id) ||
          typeof row.name !== 'string' || !row.name.trim() || typeof row.isActive !== 'boolean' ||
          !Number.isSafeInteger(row.version) || row.version < 1 || ids.has(row.id)) {
          throw new Error('科目目录已更新，请重试');
        }
        ids.add(row.id);
        rows.push(row);
      }
      if (page >= meta.totalPages) return rows;
    }
  }, (rows) => rows.length === 0);
  return {
    loadLessonAccount: (query: PartnerLessonQuery) => service.loadLessonAccount(query),
    loadSubjects,
  };
}

export const partnerLessonService = createPartnerLessonService();
