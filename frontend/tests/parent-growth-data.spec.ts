import { ApiParentDataSource } from '../data/api-parent-data-source';

describe('P6 API transport', () => {
  it('maps signed profile photos without losing the bound student identity', async () => {
    const source = new ApiParentDataSource({ baseUrl: 'https://example.test', accessToken: 'token',
      request: (options) => options.success({ statusCode: 200, data: { data: {
        student: { id: 'student', name: '陈晨', age: 9, profileVersion: 2,
          photo: { id: 'file', accessUrl: '/media/student-photos/file', mimeType: 'image/png', sizeBytes: 100 } },
        records: [],
      } } }),
    });
    expect(await source.getUpdates()).toMatchObject({ student: {
      id: 'student', photo: { accessUrl: 'https://example.test/media/student-photos/file' },
    } });
  });
  it('posts four scores once with identity in the route and idempotency in the header', async () => {
    const request = jest.fn((options: any) => options.success({ statusCode: 200, data: { data: { id: 'review' } } }));
    const source = new ApiParentDataSource({ baseUrl: 'https://example.test', accessToken: 'token', request });
    await (source as any).submitLessonReview('lesson', 'student',
      { teaching: 9, communication: 8, environment: 10, overall: 9, note: '很好' }, 'review-key');
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'POST', url: 'https://example.test/parents/me/lesson-sessions/lesson/students/student/review',
      header: { Authorization: 'Bearer token', 'Idempotency-Key': 'review-key' },
      data: { teaching: 9, communication: 8, environment: 10, overall: 9, note: '很好' },
    });
  });
  it('uploads via multipart and attaches with a versioned separate request', async () => {
    const uploadFile = jest.fn((options: any) => options.success({
      statusCode: 200, data: JSON.stringify({ data: { id: 'file', mimeType: 'image/png', sizeBytes: 100 } }),
    }));
    const request = jest.fn((options: any) => options.success({ statusCode: 200,
      data: { data: { id: 'student', name: '陈晨', age: 9, profileVersion: 2, photo: null } },
    }));
    const source = new ApiParentDataSource({ baseUrl: 'https://example.test', accessToken: 'token', request, uploadFile } as any);
    expect(await (source as any).uploadStudentPhoto('student', 'temporary-photo')).toMatchObject({ id: 'file' });
    await (source as any).replaceStudentPhoto('student', { fileId: 'file', expectedVersion: 1 }, 'photo-key');
    expect(uploadFile.mock.calls[0][0]).toMatchObject({ name: 'file', filePath: 'temporary-photo',
      url: 'https://example.test/parents/me/students/student/photo-files', header: { Authorization: 'Bearer token' } });
    expect(request.mock.calls[0][0]).toMatchObject({ method: 'PUT',
      data: { fileId: 'file', expectedVersion: 1 }, header: { 'Idempotency-Key': 'photo-key' } });
  });
});
