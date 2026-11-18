import { LOCAL_RUNTIME_STORAGE_KEY } from '../config/local-runtime';
import { PartnerApplicantSessionService } from '../pages/partner/runtime/partner-applicant-session.service';
import { PartnerApplicationMaterialService } from '../pages/partner/runtime/partner-application-material.service';
import type { SessionHttpRequestOptions } from '../services/session.service';

const applicationId = '55883f08-c9f5-4f26-927c-82ea07cb8a02';
const storedFileId = 'a4b42383-8bd1-4f06-bf3c-a4e9c7426162';
const uploadId = '03f20536-7c49-4eb0-bc68-f66ce27a735a';
const intent = { uploadId, storedFileId, kind: 'BUSINESS_LICENSE' as const, state: 'RESERVED' as const,
  requestKey: uploadId, expectedVersion: 1 };
const file = { storedFileId, kind: 'BUSINESS_LICENSE' as const, mimeType: 'image/png', sizeBytes: 100, width: 10, height: 10 };
const view = () => ({ applicationId, status: 'DRAFT', version: 1, readonly: false, materials: [file], uploads: [] });
const credentials = (token = 'synthetic-applicant') => ({
  token, expiresAt: new Date(Date.now() + 900_000).toISOString(),
  me: { applicantId: applicationId, displayName: '申请人', formalAccountReady: false },
});
describe('material service through actual restricted applicant transport', () => {
  let runtime: Record<string, unknown>;
  let calls: SessionHttpRequestOptions[];
  let uploads: WechatMiniprogram.UploadFileOption[];
  let downloads: WechatMiniprogram.DownloadFileOption[];
  let sessions: PartnerApplicantSessionService;
  let materials: PartnerApplicationMaterialService;
  let runtimeCurrent: boolean;
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const success = (index: number, data: unknown) => calls[index].success({
    statusCode: 200, data: { data, requestId: 'synthetic-image' },
  });
  const uploadSuccess = (index: number, data: string, statusCode = 200) =>
    uploads[index].success!({ statusCode, data, errMsg: '' } as WechatMiniprogram.UploadFileSuccessCallbackResult);
  const downloadSuccess = (index: number, tempFilePath: string, statusCode = 200) =>
    downloads[index].success!({ statusCode, tempFilePath, errMsg: '' } as WechatMiniprogram.DownloadFileSuccessCallbackResult);
  beforeEach(() => {
    runtime = { accessToken: 'formal-token', partnerApplicantSession: credentials() };
    runtimeCurrent = true;
    calls = []; uploads = []; downloads = [];
    sessions = new PartnerApplicantSessionService({
      apiBaseUrl: 'http://127.0.0.1:3000',
      isRuntimeCurrent: () => runtimeCurrent,
      storage: { get: () => runtime, set: (_key, value) => { runtime = value as Record<string, unknown>; } },
      request: (options) => { calls.push(options); },
      upload: (options) => { uploads.push(options); }, download: (options) => { downloads.push(options); },
    });
    materials = new PartnerApplicationMaterialService(sessions);
  });
  it('deduplicates reads, uses applicant auth, and never stores material metadata or bytes in runtime', async () => {
    const pending = materials.load();
    expect(materials.load()).toBe(pending);
    expect(calls[0]).toMatchObject({ method: 'GET',
      url: 'http://127.0.0.1:3000/partner-applicants/me/application/materials',
      header: { Authorization: 'Bearer synthetic-applicant' } });
    success(0, view());
    expect(await pending).toEqual(view());
    expect(runtime[LOCAL_RUNTIME_STORAGE_KEY]).toBeUndefined();
    expect(JSON.stringify(runtime)).not.toContain(storedFileId);
  });
  it('registers first, transfers one file with an auth header, and accepts only the reserved identity and kind', async () => {
    const registered = materials.reserve(1, 'BUSINESS_LICENSE', uploadId);
    await flush();
    success(0, intent);
    expect(await registered).toEqual(intent);
    const pending = materials.upload(intent, 'wxfile://synthetic.png');
    await flush();
    expect(uploads[0]).toMatchObject({ name: 'file', filePath: 'wxfile://synthetic.png',
      url: `http://127.0.0.1:3000/partner-applicants/me/application/material-uploads/${uploadId}`,
      header: { Authorization: 'Bearer synthetic-applicant' } });
    uploadSuccess(0, JSON.stringify({ data: file, requestId: 'synthetic' }));
    expect(await pending).toEqual(file);
  });
  it('snapshots section references, coalesces identical writes and blocks a competing write', async () => {
    const refs = [{ storedFileId, kind: 'BUSINESS_LICENSE' as const }];
    const pending = materials.save(1, refs);
    expect(materials.save(1, refs)).toBe(pending);
    await expect(materials.reserve(1, 'STORE_FRONT', uploadId)).rejects.toMatchObject({ code: 'SAVE_IN_PROGRESS' });
    refs[0].kind = 'STORE_FRONT' as never;
    await flush();
    expect(calls[0].data).toEqual({ expectedVersion: 1, materials: [{ storedFileId, kind: 'BUSINESS_LICENSE' }] });
    const receipt = { applicationId, version: 2, materialRecordId: uploadId };
    success(0, receipt);
    expect(await pending).toEqual(receipt);
  });
  describe.each(['reserve', 'upload', 'save'] as const)('queued %s ownership', (operation) => {
    const start = (service: PartnerApplicationMaterialService) => operation === 'reserve'
      ? service.reserve(1, 'BUSINESS_LICENSE', uploadId)
      : operation === 'upload' ? service.upload(intent, 'wxfile://synthetic.png')
      : service.save(1, [{ storedFileId, kind: 'BUSINESS_LICENSE' }]);
    it.each(['replacement', 'expiry', 'environment'] as const)(
      'rejects before transport after %s without dispatching old content', async (change) => {
        const outcome = start(materials).then(
          () => ({ code: 'UNEXPECTED_SUCCESS' }), (error: { code: string }) => error,
        );
        if (change === 'replacement') runtime.partnerApplicantSession = credentials('new-applicant');
        else if (change === 'expiry') runtime.partnerApplicantSession = {
          ...credentials(), expiresAt: '2026-01-01T00:00:00.000Z',
        };
        else runtimeCurrent = false;
        await flush();
        expect(calls).toHaveLength(0);
        expect(uploads).toHaveLength(0);
        expect(await outcome).toMatchObject({ code: 'SESSION_SUPERSEDED' });
        expect(runtime.accessToken).toBe('formal-token');
        if (change === 'replacement') expect(sessions.getToken()).toBe('new-applicant');
      },
    );
    it('keeps same-owner queued writes valid across read invalidation', async () => {
      const pending = start(materials);
      sessions.invalidateReads();
      await flush();
      const receipt = { applicationId, version: 2, materialRecordId: uploadId };
      if (operation === 'upload') {
        expect(uploads).toHaveLength(1);
        expect(uploads[0].header).toEqual({ Authorization: 'Bearer synthetic-applicant' });
        uploadSuccess(0, JSON.stringify({ data: file, requestId: 'synthetic' }));
      } else {
        expect(calls).toHaveLength(1);
        expect(calls[0].header?.Authorization).toBe('Bearer synthetic-applicant');
        success(0, operation === 'reserve' ? intent : receipt);
      }
      expect(await pending).toEqual(operation === 'reserve' ? intent : operation === 'upload' ? file : receipt);
    });
    it('lets a new owner start independently while the old queued write is rejected', async () => {
      const old = start(materials).then(
        () => ({ code: 'UNEXPECTED_SUCCESS' }), (error: { code: string }) => error,
      );
      runtime.partnerApplicantSession = credentials('new-applicant');
      const current = start(materials);
      expect(start(materials)).toBe(current);
      await flush();
      expect(calls.length + uploads.length).toBe(1);
      expect(await old).toMatchObject({ code: 'SESSION_SUPERSEDED' });
      expect(start(materials)).toBe(current);
      const receipt = { applicationId, version: 2, materialRecordId: uploadId };
      if (operation === 'upload') {
        expect(uploads[0].header).toEqual({ Authorization: 'Bearer new-applicant' });
        uploadSuccess(0, JSON.stringify({ data: file, requestId: 'synthetic' }));
      } else {
        expect(calls[0].header?.Authorization).toBe('Bearer new-applicant');
        success(0, operation === 'reserve' ? intent : receipt);
      }
      expect(await current).toEqual(operation === 'reserve' ? intent : operation === 'upload' ? file : receipt);
    });
    it.each([200, 401, 403])('keeps a new-owner write locked after old dispatched status %s', async (statusCode) => {
      const old = start(materials).then((value) => value, (error: { code: string }) => error);
      await flush();
      runtime.partnerApplicantSession = credentials('new-applicant');
      const current = start(materials);
      await flush();
      const receipt = { applicationId, version: 2, materialRecordId: uploadId };
      const value = operation === 'reserve' ? intent : operation === 'upload' ? file : receipt;
      if (operation === 'upload') {
        uploadSuccess(0, JSON.stringify({ data: value, requestId: 'synthetic' }), statusCode);
      } else {
        calls[0].success({
          statusCode, data: statusCode === 200 ? { data: value, requestId: 'synthetic' }
            : { code: statusCode === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message: '合成旧请求拒绝' },
        });
      }
      expect(await old).toMatchObject({
        code: statusCode === 200 ? 'SESSION_SUPERSEDED' : statusCode === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
      });
      expect(start(materials)).toBe(current);
      expect(calls.length + uploads.length).toBe(2);
      expect(sessions.getToken()).toBe('new-applicant');
      expect(runtime.accessToken).toBe('formal-token');
      if (operation === 'upload') uploadSuccess(1, JSON.stringify({ data: file, requestId: 'synthetic' }));
      else success(1, value);
      expect(await current).toEqual(value);
    });
  });
  it('downloads only with applicant auth and exposes only a transient local preview path', async () => {
    const pending = materials.preview(storedFileId);
    expect(downloads[0].url).toBe(`http://127.0.0.1:3000/partner-applicants/me/application/materials/${storedFileId}/content`);
    expect(downloads[0].url).not.toContain('synthetic-applicant');
    expect(downloads[0].header).toEqual({ Authorization: 'Bearer synthetic-applicant' });
    downloadSuccess(0, 'wxfile://preview.png');
    expect(await pending).toBe('wxfile://preview.png');
    expect(JSON.stringify(runtime)).not.toContain('preview.png');
  });
  it.each([{}, { ...view(), storageKey: 'forbidden' }, { ...view(), applicationId: null },
    { ...view(), status: 'SUBMITTED', readonly: false },
    { ...view(), materials: [{ ...file, accessUrl: 'forbidden' }] },
    { ...view(), materials: [{ ...file, width: 8193 }] }, { ...view(), materials: [file, file] },
    { ...view(), uploads: [intent, intent] },
  ])('rejects invalid or over-disclosing material metadata %#', async (value) => {
    const pending = materials.load(); success(0, value);
    await expect(pending).rejects.toMatchObject({ statusCode: 502 });
  });
  it.each([-1, 0, 1.5, 2_147_483_648])('rejects invalid write version %s before transport', async (version) => {
    await expect(materials.save(version, [])).rejects.toMatchObject({ statusCode: 400 });
    expect(calls).toHaveLength(0);
  });
  it('invalidates late metadata and preview success after hide or logout', async () => {
    const read = materials.load();
    const preview = materials.preview(storedFileId);
    sessions.invalidateReads();
    success(0, view());
    downloadSuccess(0, 'wxfile://old.png');
    await expect(read).rejects.toMatchObject({ code: 'READ_SUPERSEDED' });
    await expect(preview).rejects.toMatchObject({ code: 'READ_SUPERSEDED' });
  });
  it('keeps new credentials on late upload 401 and clears only a current upload 401', async () => {
    const old = materials.upload(intent, 'wxfile://old.png'); await flush();
    runtime.partnerApplicantSession = credentials('new-applicant');
    uploadSuccess(0, '{}', 401);
    await expect(old).rejects.toMatchObject({ statusCode: 401 });
    expect(sessions.getToken()).toBe('new-applicant');
    const current = materials.upload(intent, 'wxfile://current.png'); await flush();
    uploadSuccess(1, '{}', 401);
    await expect(current).rejects.toMatchObject({ statusCode: 401 });
    expect(sessions.getToken()).toBe('');
    expect(runtime.accessToken).toBe('formal-token');
  });
  it('does not clear credentials on a hidden old preview 401', async () => {
    const pending = materials.preview(storedFileId);
    sessions.invalidateReads();
    downloadSuccess(0, '', 401);
    await expect(pending).rejects.toMatchObject({ statusCode: 401 });
    expect(sessions.getToken()).toBe('synthetic-applicant');
  });
  it.each(['bad-json', 'wrong-id', 'wrong-kind', 'extra-field'])('rejects %s in upload completion', async (invalid) => {
    const pending = materials.upload(intent, 'wxfile://synthetic.png'); await flush();
    const response = invalid === 'wrong-id' ? { ...file, storedFileId: uploadId }
      : invalid === 'wrong-kind' ? { ...file, kind: 'ENVIRONMENT' } : { ...file, storageKey: 'forbidden' };
    uploadSuccess(0, invalid === 'bad-json' ? '{' : JSON.stringify({ data: response, requestId: 'synthetic' }));
    await expect(pending).rejects.toMatchObject({ statusCode: 502 });
  });
});
