import { ApiPartnerDataSource, PartnerHttpRequestOptions } from '../data/api-partner-data-source';
import { MockPartnerDataSource } from '../data/mock-partner-data-source';
import { PartnerService } from '../services/partner.service';
import { buildPartnerGrowthItems, mergePartnerGrowthItems } from '../services/partner-student-growth.presenter';

const media = {
  id: 'photo-1', mimeType: 'image/png', sizeBytes: 12,
  accessUrl: '/media/student-photos/photo-1?signature=test',
  accessUrlExpiresAt: '2026-10-08T10:15:00Z',
};
const record = {
  lessonSessionId: 'lesson-1', studentId: 'student-1', courseName: '硬笔书法',
  campusName: '测试校区', teacherName: '测试老师', startsAt: '2026-10-08T02:00:00Z',
  lessonStatus: 'REVERSED' as const, attendanceStatus: 'PRESENT' as const,
  feedback: '课堂表现进步', performanceRating: 9, feedbackUpdatedAt: null,
  feedbackImages: [{ ...media, accessUrl: '/media/student-feedback/image-1?signature=test' }],
  review: {
    id: 'review-1', lessonSessionId: 'lesson-1', studentId: 'student-1',
    teaching: 9, communication: 8, environment: 10, overall: 9,
    note: '谢谢老师', createdAt: '2026-10-08T03:00:00Z', valid: false,
  },
};

describe('partner read-only student growth', () => {
  it('uses scoped encoded paths, pagination and the configured media base URL', async () => {
    const requests: PartnerHttpRequestOptions[] = [];
    const source = new ApiPartnerDataSource({
      baseUrl: 'http://127.0.0.1:3000', accessToken: 'test-only',
      request: (options) => {
        requests.push(options);
        options.success({ statusCode: 200, data: { data: {
          student: { id: 'student-1', displayName: '测试学员', photo: media },
          items: [record], meta: { page: 2, pageSize: 5, total: 6, totalPages: 2 },
        } } });
      },
    });
    const result = await source.getStudentGrowth('student/1', { page: 2, pageSize: 5 });
    expect(requests[0].url).toBe('http://127.0.0.1:3000/partners/me/students/student%2F1/growth?page=2&pageSize=5');
    expect(requests[0].header.Authorization).toBe('Bearer test-only');
    expect(result.student.photo?.accessUrl).toBe(`http://127.0.0.1:3000${media.accessUrl}`);
    expect(result.items[0].feedbackImages[0].accessUrl).toContain('http://127.0.0.1:3000/media/student-feedback/');
    expect(media.accessUrl).toMatch(/^\/media/);
  });

  it('resolves detail photos without changing already absolute media URLs', async () => {
    const source = new ApiPartnerDataSource({
      baseUrl: 'http://127.0.0.1:3000/', accessToken: 'test-only',
      request: (options) => options.success({
        statusCode: 200, data: { data: { photo: { ...media, accessUrl: 'https://media.example.test/photo.png' } } },
      }),
    });
    expect((await source.getStudent('student-1')).photo?.accessUrl).toBe('https://media.example.test/photo.png');
  });

  it('keeps identity for an empty page and does not classify it as a missing student', async () => {
    const source = new MockPartnerDataSource({ scenario: 'empty' });
    const result = await new PartnerService(source).loadStudentGrowth('partner-student-1', { page: 1, pageSize: 5 });
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.data.items).toEqual([]);
      expect(result.data.student.id).toBe('partner-student-1');
    }
    await expect(source.getStudentGrowth('foreign-student', { page: 1, pageSize: 5 })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('formats half-stars, timezones and invalid reviews without offering write actions', () => {
    const [item] = buildPartnerGrowthItems([record], 'Asia/Shanghai');
    expect(item.timeLabel).toBe('10月8日 10:00');
    expect(item.performanceLabel).toBe('4.5 星');
    expect(item.performanceFills).toEqual([100, 100, 100, 100, 50]);
    expect(item.statusLabel).toBe('已撤销');
    expect(item.review?.validLabel).toBe('原评价已失效');
    expect(item).not.toHaveProperty('canReview');
    expect(buildPartnerGrowthItems([{ ...record, feedback: null, performanceRating: null, review: null }])[0]).toMatchObject({
      feedbackLabel: '暂无课堂反馈', performanceLabel: '未评分', review: null,
    });
  });

  it('merges repeated lessons by stable identity without duplicating pagination rows', () => {
    const first = buildPartnerGrowthItems([record]);
    const updated = buildPartnerGrowthItems([{ ...record, feedback: '更新反馈' }]);
    expect(mergePartnerGrowthItems(first, updated, 2)).toHaveLength(1);
    expect(mergePartnerGrowthItems(first, updated, 2)[0].feedbackLabel).toBe('更新反馈');
    expect(mergePartnerGrowthItems(first, [], 1)).toEqual([]);
  });
});
