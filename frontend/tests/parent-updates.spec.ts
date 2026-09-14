import { buildParentUpdatesPageModel } from '../services/parent-updates.presenter';

describe('parent classroom updates', () => {
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
