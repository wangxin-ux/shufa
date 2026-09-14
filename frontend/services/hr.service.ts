import { createTeacherRuntimeEnv } from '../config/teacher-env';
import { createRuntimeAccessTokenProvider } from '../config/local-runtime';

export interface HrTeacher {
  id: string; name: string; campusId: string; campusName: string; employeeCode: string;
  active: boolean; specialties: string[]; activeClassCount: number;
}
export interface HrTeacherDetail extends HrTeacher {
  createdAt: string; completedLessonCount: number;
}
export interface HrPage<T> { items: T[]; page: number; pageSize: number; total: number; }
export interface HrTeachingRow {
  id: string; teacherId: string; teacherName: string; campusName: string; courseName: string;
  completedAt: string; status: 'COMPLETED' | 'REVERSED'; attendeeCount: number; lessonUnits: number; consumedUnits: number;
}
export interface HrEarningRow {
  id: string; teacherId: string; teacherName: string; campusName: string; completedAt: string; createdAt: string;
  entryType: 'ACCRUAL' | 'REVERSAL'; status: 'PENDING_REVIEW' | 'AVAILABLE' | 'REJECTED' | 'REVERSED';
  amountFen: number; paidFen: number; processingFen: number;
}
export interface HrTeachingReport extends HrPage<HrTeachingRow> {
  summary: { completedCount: number; attendeeCount: number; lessonUnits: number; consumedUnits: number };
}
export interface HrEarningReport extends HrPage<HrEarningRow> {
  summary: { netFen: number; pendingFen: number; approvedFen: number; paidFen: number; processingFen: number };
}
interface RequestOptions {
  url: string; method: 'GET'; header: Record<string, string>; data?: Record<string, string | number>;
  success(result: { statusCode: number; data: unknown }): void;
  fail(error: unknown): void;
}
export class HrApi {
  constructor(private readonly baseUrl: string, private readonly token: () => string,
    private readonly request: (options: RequestOptions) => unknown = (options) => wx.request(options)) {}
  private get<T>(path: string, query?: Record<string, string | number>): Promise<T> {
    return new Promise((resolve, reject) => {
      const token = this.token();
      if (!token || !this.baseUrl) return reject(new Error('请先登录总部人力账号'));
      this.request({
        url: `${this.baseUrl.replace(/\/$/, '')}/hr/${path}`, method: 'GET',
        header: { Authorization: `Bearer ${token}` }, data: query,
        success: (response) => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            const messages: Record<number, string> = { 400: '请核对筛选条件', 401: '登录已失效，请重新登录', 403: '当前账号无权查看人力资料', 404: '教师档案不存在' };
            reject(new Error(messages[response.statusCode] ?? '资料加载失败，请重试'));
          } else if (response.data && typeof response.data === 'object' && 'data' in response.data) {
            resolve((response.data as { data: T }).data);
          } else reject(new Error('人力接口响应无效'));
        },
        fail: () => reject(new Error('网络连接失败，请重试')),
      });
    });
  }
  campuses(query: Record<string, string | number>) { return this.get<HrPage<{ id: string; name: string }>>('campuses', query); }
  teachers(query: Record<string, string | number>) { return this.get<HrPage<HrTeacher>>('teachers', query); }
  teacher(id: string) { return this.get<HrTeacherDetail>(`teachers/${encodeURIComponent(id)}`); }
  teaching(query: Record<string, string | number>) { return this.get<HrTeachingReport>('reports/teaching', query); }
  earnings(query: Record<string, string | number>) { return this.get<HrEarningReport>('reports/earnings', query); }
  exportReport(kind: 'teaching' | 'earnings', query: Record<string, string | number>): Promise<void> {
    if (!this.token() || !this.baseUrl) return Promise.reject(new Error('请先登录总部人力账号'));
    const search = Object.entries(query).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: `${this.baseUrl.replace(/\/$/, '')}/hr/reports/${kind}/export?${search}`,
        header: { Authorization: `Bearer ${this.token()}` },
        success: result => {
          if (result.statusCode !== 200) {
            reject(new Error(result.statusCode === 400 ? '请核对日期或缩小导出范围（最多5000条）' : '报表下载失败，请重试'));
            return;
          }
          wx.openDocument({
            filePath: result.tempFilePath, fileType: 'xlsx', showMenu: true,
            success: () => resolve(), fail: () => reject(new Error('报表已下载，文件打开失败')),
          });
        },
        fail: () => reject(new Error('网络连接失败，请重试')),
      });
    });
  }
}
export function createHrApi() {
  const env = createTeacherRuntimeEnv();
  return new HrApi(env.apiBaseUrl, createRuntimeAccessTokenProvider(env.accessToken));
}
