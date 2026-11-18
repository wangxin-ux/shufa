import { buildParentUpdatesPageModel } from '../services/parent-updates.presenter';

describe('parent classroom updates', () => {
  it('uses a compact Shanghai date and scales long course names by content', () => {
    const records = buildParentUpdatesPageModel({ records: ['专业美术B', '专业美术与创意思维综合提升课程'].map((courseName) => ({
      lessonSessionId: courseName, courseName, teacherName: '欧阳老师',
      startsAt: '2026-10-05T17:00:00Z', lessonStatus: 'COMPLETED' as const,
      attendanceStatus: 'PRESENT' as const, feedback: null, feedbackImages: [],
    })) }).records;
    expect(records[0]).toMatchObject({ lessonDateLabel: '10月6日', courseFontSize: 73 });
    expect(records[1].courseFontSize).toBeLessThanOrEqual(36);
    expect(records[1].courseFontSize).toBeGreaterThanOrEqual(30);
  });
  it('uses the rounded source 73rpx for a short course and retains the long-title calculation', () => {
    const names = ['专业美术B', '专业美术与创意思维综合提升课程'];
    const records = buildParentUpdatesPageModel({
      records: names.map((courseName) => ({
        lessonSessionId: courseName, courseName, teacherName: '赵老师',
        startsAt: '2026-10-06T01:00:00Z', lessonStatus: 'COMPLETED' as const,
        attendanceStatus: 'PRESENT' as const, feedback: null, feedbackImages: [],
      })),
    }).records;
    expect(records[0].courseFontSize).toBe(73);
    expect(records[1].courseFontSize).toBe(30);
    expect(records[1].courseName).toBe(names[1]);
  });
  it('shows teacher-authored scores without inventing a rating for old feedback', () => {
    const view = {
      records: [1, 9, 10, null].map((performanceRating) => ({
        lessonSessionId: `lesson-${performanceRating}`,
        courseName: '专业美术',
        teacherName: '赵老师',
        startsAt: '2026-10-06T06:00:00.000Z',
        lessonStatus: 'COMPLETED' as const,
        attendanceStatus: 'PRESENT' as const,
        feedback: '课堂认真',
        feedbackImages: [],
        performanceRating,
      })),
    };
    expect(buildParentUpdatesPageModel(view).records.map(
      (record) => record.performanceRatingLabel,
    )).toEqual(['0.5 星', '4.5 星', '5 星', '未评分']);
    expect(buildParentUpdatesPageModel(view).records.map((record) => record.performanceStars))
      .toEqual([
        [50, 0, 0, 0, 0],
        [100, 100, 100, 100, 50],
        [100, 100, 100, 100, 100],
        [0, 0, 0, 0, 0],
      ]);
  });
  it('maps attendance, feedback, and reversed lessons without inventing content', () => {
    const model = buildParentUpdatesPageModel({
      records: [
        {
          lessonSessionId: 'lesson-completed',
          courseName: '创意书写',
          teacherName: '林老师',
          startsAt: '2026-08-28T01:00:00.000Z',
          lessonStatus: 'COMPLETED',
          attendanceStatus: 'PRESENT',
          feedback: '课堂参与认真。',
          feedbackImages: [
            {
              id: 'image-1',
              mimeType: 'image/jpeg',
              sizeBytes: 256,
              accessUrl: 'https://example.test/image-1',
              accessUrlExpiresAt: '2026-08-31T10:00:00.000Z',
            },
          ],
        },
        {
          lessonSessionId: 'lesson-reversed',
          courseName: '专业美术',
          teacherName: '赵老师',
          startsAt: '2026-08-27T06:00:00.000Z',
          lessonStatus: 'REVERSED',
          attendanceStatus: 'PRESENT',
          feedback: null,
          feedbackImages: [],
        },
      ],
    });

    expect(model.records[0]).toMatchObject({
      courseName: '创意书写',
      teacherName: '林老师',
      attendanceLabel: '正常出勤',
      feedback: '课堂参与认真。',
      feedbackImages: [expect.objectContaining({ id: 'image-1' })],
      statusLabel: '已完成',
    });
    expect(model.records[1]).toMatchObject({
      statusLabel: '已撤销',
      feedback: '',
    });
    expect(model.isEmpty).toBe(false);
  });

  it('represents an empty update list', () => {
    expect(buildParentUpdatesPageModel({ records: [] })).toEqual({
      records: [],
      isEmpty: true,
    });
  });
});
