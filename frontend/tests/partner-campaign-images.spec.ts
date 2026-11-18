import { PartnerCampaignDraftService } from '../pages/partner/runtime/partner-campaign-draft.service';

const id = '00000000-0000-4000-8000-000000000001';
const fileId = '00000000-0000-4000-8000-000000000002';
const stamp = '2026-10-17T00:00:00.000Z';
const receipt = { draftId: id, status: 'DRAFT', version: 2, createdAt: stamp, updatedAt: stamp };
const picture = { id: fileId, mimeType: 'image/png', sizeBytes: 1024,
  accessUrl: `/media/partner-campaign-images/${fileId}?expires=2000000000&signature=${'a'.repeat(64)}`,
  accessUrlExpiresAt: stamp };
describe('private campaign image transport', () => {
  let token: string, upload: any, request: any, service: any;
  beforeEach(() => {
    token = 'synthetic-token';
    service = new PartnerCampaignDraftService({ dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3001/api',
      accessToken: () => token, request: (v: any) => { request = v; }, upload: (v: any) => { upload = v; } } as any);
  });
  it('uploads only a chosen file with exact original version and idempotency key', async () => {
    expect(typeof service.uploadImage).toBe('function');
    const pending = service.uploadImage(id, 1, 'cover', 'wxfile://chosen.png', 'synthetic-image-key');
    expect(upload).toMatchObject({ url: `http://127.0.0.1:3001/api/partners/me/campaign-drafts/${id}/images/cover`,
      name: 'file', filePath: 'wxfile://chosen.png', formData: { expectedVersion: '1' },
      header: { Authorization: 'Bearer synthetic-token', 'Idempotency-Key': 'synthetic-image-key' } });
    upload.success({ statusCode: 200, data: JSON.stringify({ data: receipt }) });
    expect(await pending).toEqual(receipt);
  });
  it('reads two bounded signed images and resolves only their known media paths', async () => {
    expect(typeof service.getImages).toBe('function');
    const pending = service.getImages(id);
    request.success({ statusCode: 200, data: { data: { draftId: id, version: 2, images: { cover: picture, share: null } } } });
    expect(await pending).toMatchObject({ images: { cover: {
      accessUrl: `http://127.0.0.1:3001/api${picture.accessUrl}`,
    }, share: null } });
  });
  it('clears a slot with a version without deleting or supplying a file identifier', async () => {
    expect(typeof service.clearImage).toBe('function');
    const pending = service.clearImage(id, 2, 'cover');
    expect(request).toMatchObject({ method: 'PUT', data: { expectedVersion: 2 } });
    request.success({ statusCode: 200, data: { data: { ...receipt, version: 3 } } });
    expect(await pending).toMatchObject({ version: 3 });
  });
  it('rejects a stale identity or malformed upload response and releases pending callbacks', async () => {
    expect(typeof service.uploadImage).toBe('function');
    const pending = service.uploadImage(id, 1, 'cover', 'wxfile://chosen.png', 'synthetic-image-key');
    token = 'different-owner';
    upload.success({ statusCode: 200, data: JSON.stringify({ data: receipt }) });
    await expect(pending).rejects.toMatchObject({ statusCode: 401 });
  });
  it.each(['https://example.invalid/file.png', '/media/student-photos/secret', picture.accessUrl + '&extra=x'])(
    'rejects an arbitrary image URL (%s)', async (accessUrl) => {
      expect(typeof service.getImages).toBe('function');
      const pending = service.getImages(id);
      request.success({ statusCode: 200, data: { data: { draftId: id, version: 2,
        images: { cover: { ...picture, accessUrl }, share: null } } } });
      await expect(pending).rejects.toMatchObject({ statusCode: 502 });
    });
});
