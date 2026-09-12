import {
  ApiTeacherDataSource,
  TeacherHttpRequest,
  TeacherUploadFile,
} from '../data/api-teacher-data-source';

describe('teacher API data source', () => {
  it('uploads a feedback image with teacher authentication and resolves its media URL', async () => {
    const uploads: Parameters<TeacherUploadFile>[0][] = [];
    const uploadFile: TeacherUploadFile = (options) => {
      uploads.push(options);
      options.success({
        statusCode: 200,
        data: JSON.stringify({
          data: {
            id: 'image-1',
            mimeType: 'image/png',
            sizeBytes: 128,
            accessUrl: '/media/student-feedback/image-1?signature=test',
            accessUrlExpiresAt: '2026-08-31T10:00:00.000Z',
          },
          requestId: 'upload-1',
        }),
      });
    };
    const source = new ApiTeacherDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'teacher-token',
      uploadFile,
    });

    const image = await source.uploadFeedbackImage({
      lessonSessionId: 'lesson-1',
      studentId: 'student-1',
      filePath: 'wxfile://photo.png',
    });

    expect(uploads[0]).toMatchObject({
      url: 'https://example.test/teachers/me/lesson-sessions/lesson-1/students/student-1/feedback-images',
      filePath: 'wxfile://photo.png',
      name: 'file',
      header: { Authorization: 'Bearer teacher-token' },
    });
    expect(image.accessUrl).toBe(
      'https://example.test/media/student-feedback/image-1?signature=test',
    );
  });

  it('encodes list queries and sends bearer authentication', async () => {
    const requests: Parameters<TeacherHttpRequest>[0][] = [];
    const request: TeacherHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data: {
          data: [],
          meta: { page: 2, pageSize: 10, total: 0, totalPages: 0 },
          requestId: 'request-1',
        },
      });
    };
    const source = new ApiTeacherDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: () => 'teacher-token',
      request,
    });

    await source.listLessonSessions({
      page: 2,
      pageSize: 10,
      from: '2026-09-01T00:00:00+08:00',
      status: 'SCHEDULED',
    });

    expect(requests[0]).toMatchObject({
      method: 'GET',
      url:
        'https://example.test/api/teachers/me/lesson-sessions?page=2&pageSize=10&from=2026-09-01T00%3A00%3A00%2B08%3A00&status=SCHEDULED',
      header: { Authorization: 'Bearer teacher-token' },
    });
  });

  it('sends idempotency keys and decodes mutation envelopes', async () => {
    const requests: Parameters<TeacherHttpRequest>[0][] = [];
    const request: TeacherHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data: {
          data: {
            lessonSessionId: 'lesson-1',
            lessonVersion: 2,
            status: 'COMPLETED',
            teachingRecordId: 'record-1',
            consumed: [],
          },
          requestId: 'request-2',
        },
      });
    };
    const source = new ApiTeacherDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'teacher-token',
      request,
    });

    const result = await source.completeLesson(
      {
        lessonSessionId: 'lesson-1',
        lessonVersion: 1,
        attendance: [],
      },
      'complete-api-key-0001',
    );

    expect(result.status).toBe('COMPLETED');
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/teachers/me/lesson-sessions/lesson-1/complete',
      header: {
        Authorization: 'Bearer teacher-token',
        'Idempotency-Key': 'complete-api-key-0001',
      },
      data: { lessonVersion: 1, attendance: [] },
    });
  });

  it.each([
    [403, 'FORBIDDEN'],
    [409, 'LESSON_VERSION_CONFLICT'],
  ])('preserves HTTP %i and error code %s', async (statusCode, code) => {
    const request: TeacherHttpRequest = (options) => {
      options.success({
        statusCode,
        data: {
          code,
          message: 'Rejected by server',
          details: { currentVersion: 2 },
          requestId: 'request-error',
        },
      });
    };
    const source = new ApiTeacherDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'teacher-token',
      request,
    });

    await expect(source.getLessonSession('lesson-1')).rejects.toMatchObject({
      statusCode,
      code,
      message: 'Rejected by server',
      details: { currentVersion: 2 },
    });
  });

  it('uses a Chinese message for unexpected server failures', async () => {
    const request: TeacherHttpRequest = (options) => {
      options.success({
        statusCode: 500,
        data: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal server error',
          details: {},
        },
      });
    };
    const source = new ApiTeacherDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'teacher-token',
      request,
    });

    await expect(source.getLessonSession('lesson-1')).rejects.toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: '服务器处理失败，请稍后重试',
    });
  });

  it('uses contract paths for earning reads and preserves paging filters', async () => {
    const requests: Parameters<TeacherHttpRequest>[0][] = [];
    const request: TeacherHttpRequest = (options) => {
      requests.push(options);
      if (options.url.endsWith('/teachers/me/earnings/summary')) {
        options.success({
          statusCode: 200,
          data: {
            data: {
              estimatedTotalFen: 10000,
              pendingReviewFen: 0,
              availableFen: 10000,
              withdrawingFen: 0,
              currency: 'CNY',
            },
            requestId: 'earning-summary',
          },
        });
        return;
      }
      options.success({
        statusCode: 200,
        data: {
          data: [],
          meta: { page: 2, pageSize: 10, total: 0, totalPages: 0 },
          requestId: 'earning-page',
        },
      });
    };
    const source = new ApiTeacherDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'teacher-token',
      request,
    });

    expect((await source.getEarningSummary()).availableFen).toBe(10000);
    await source.getEarnings({
      page: 2,
      pageSize: 10,
      from: '2026-08-01T00:00:00+08:00',
      status: 'AVAILABLE',
    });
    await source.getWithdrawals({
      page: 2,
      pageSize: 10,
      status: 'SUBMITTED',
    });

    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      {
        method: 'GET',
        url: 'https://example.test/teachers/me/earnings/summary',
      },
      {
        method: 'GET',
        url:
          'https://example.test/teachers/me/earnings?page=2&pageSize=10&from=2026-08-01T00%3A00%3A00%2B08%3A00&status=AVAILABLE',
      },
      {
        method: 'GET',
        url:
          'https://example.test/teachers/me/withdrawals?page=2&pageSize=10&status=SUBMITTED',
      },
    ]);
  });

  it('sends idempotent create and versioned cancel withdrawal commands', async () => {
    const requests: Parameters<TeacherHttpRequest>[0][] = [];
    const request: TeacherHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data: {
          data: {
            id: 'withdrawal-1',
            requestNo: 'TX202608300001',
            campusId: 'campus-1',
            teacherId: 'teacher-1',
            teacherName: '王老师',
            amountFen: 10000,
            status: requests.length === 1 ? 'SUBMITTED' : 'CANCELLED',
            requestedAt: '2026-08-30T08:00:00+08:00',
            reviewedAt: null,
            paidAt: null,
            rejectionReason: null,
            failureReason: null,
            payoutReference: null,
            payoutProofFileId: null,
            version: requests.length,
          },
          requestId: `withdrawal-${requests.length}`,
        },
      });
    };
    const source = new ApiTeacherDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'teacher-token',
      request,
    });

    await source.createWithdrawal(10000, 'create-withdrawal-0001');
    await source.cancelWithdrawal(
      'withdrawal-1',
      1,
      'cancel-withdrawal-0001',
    );

    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/teachers/me/withdrawals',
      header: { 'Idempotency-Key': 'create-withdrawal-0001' },
      data: { amountFen: 10000 },
    });
    expect(requests[1]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/teachers/me/withdrawals/withdrawal-1/cancel',
      header: { 'Idempotency-Key': 'cancel-withdrawal-0001' },
      data: { expectedVersion: 1 },
    });
  });
});
