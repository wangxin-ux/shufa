import { ApiParentDataSource } from '../data/api-parent-data-source';
import { MockParentDataSource } from '../data/mock-parent-data-source';
import { ParentService } from '../services/parent.service';
import { readLocalRuntimeOverrides } from '../config/local-runtime';

describe('bound child first-time profile data', () => {
  it('transports setup fields, version and mutation key and maps the signed photo', async () => {
    const request = jest.fn((options: any) => options.success({ statusCode: 200, data: { data: {
      required: false, student: { id: 'child', name: '陈晨', birthDate: '2017-10-08', age: 9,
        profileVersion: 2, photo: { id: 'file', accessUrl: '/media/student-photos/file' } },
    } } }));
    const source: any = new ApiParentDataSource({ baseUrl: 'https://example.test', accessToken: 'token', request });
    expect(await source.getProfileSetup()).toMatchObject({ student: {
      birthDate: '2017-10-08', photo: { accessUrl: 'https://example.test/media/student-photos/file' },
    } });
    const input = { name: '陈晨', birthDate: '2017-10-08', fileId: 'file', expectedVersion: 1 };
    await source.completeProfileSetup('child', input, 'setup-key');
    expect(request.mock.calls[1][0]).toMatchObject({ method: 'PUT',
      url: 'https://example.test/parents/me/students/child/profile-setup', data: input,
      header: { Authorization: 'Bearer token', 'Idempotency-Key': 'setup-key' } });
  });

  it('keeps normal visual fixtures unchanged and provides a separate incomplete scenario', async () => {
    for (const scenario of ['normal', 'visual']) {
      const source: any = new MockParentDataSource({ scenario } as any);
      expect((await source.getHomeSummary()).profileSetupRequired).toBe(false);
      expect((await source.getProfileSetup()).required).toBe(false);
    }
    const source: any = new MockParentDataSource({ scenario: 'profile-setup' } as any);
    expect((await source.getHomeSummary()).profileSetupRequired).toBe(true);
    expect(await (new ParentService(source) as any).loadProfileSetup()).toMatchObject({
      status: 'success', data: { required: true, student: { name: '林小禾' } },
    });
    expect(readLocalRuntimeOverrides(() => ({ parentMockScenario: 'profile-setup' }))).toEqual({ parentMockScenario: 'profile-setup' });
  });

  it('shares completed name, birthday age and photo and disallows subsequent manual age override', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-07T15:59:59Z'));
    try {
      const source: any = new MockParentDataSource({ scenario: 'profile-setup' } as any);
      const initial = (await source.getProfileSetup()).student;
      const photo = await source.uploadStudentPhoto(initial.id, 'local-photo');
      const input = { name: '陈晨', birthDate: '2017-10-08', fileId: photo.id, expectedVersion: initial.profileVersion };
      const first = await source.completeProfileSetup(initial.id, input, 'once');
      expect(first).toMatchObject({ required: false, student: { name: '陈晨', age: 8, photo: { id: photo.id } } });
      expect(await source.completeProfileSetup(initial.id, input, 'once')).toEqual(first);
      await expect(source.completeProfileSetup(initial.id, { ...input, name: '安然' }, 'once'))
        .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      await expect(source.completeProfileSetup(initial.id, { ...input, expectedVersion: 2 }, 'again'))
        .rejects.toMatchObject({ code: 'PARENT_PROFILE_ALREADY_COMPLETED' });
      jest.setSystemTime(new Date('2026-10-07T16:00:00Z'));
      expect((await source.getHomeSummary()).student).toMatchObject({ name: '陈晨', age: 9 });
      expect((await source.getProfile()).student).toMatchObject({ name: '陈晨', age: 9, profileSetupCompleted: true });
      expect((await source.getUpdates()).student).toMatchObject({ name: '陈晨', age: 9, photo: { id: photo.id } });
      await expect(source.updateProfile({ age: 99, homeAddress: '', expectedVersion: 2 }, 'age'))
        .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await source.updateProfile({ homeAddress: '测试住址', expectedVersion: 2 }, 'address');
      expect((await source.getProfile()).student.age).toBe(9);
    } finally { jest.useRealTimers(); }
  });

  it('returns an empty setup state for no binding', async () => {
    const source: any = new MockParentDataSource({ scenario: 'empty' });
    expect(await (new ParentService(source) as any).loadProfileSetup()).toEqual({ status: 'empty', data: { required: false, student: null } });
  });
});
