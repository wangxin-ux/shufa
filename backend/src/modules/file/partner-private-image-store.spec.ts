import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { PartnerPrivateLocalAdapter } from './partner-private-local.adapter';
import {
  PartnerPrivateImageStore,
  type MaterialCipherContext,
} from './partner-private-image-store';

function animatedPng() {
  const chunk = (type: string, bytes: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(bytes.length);
    header.write(type, 4, 'ascii');
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), bytes])));
    return Buffer.concat([header, bytes, checksum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(2);
  const frame = (sequence: number) => {
    const bytes = Buffer.alloc(26);
    bytes.writeUInt32BE(sequence);
    bytes.writeUInt32BE(1, 4);
    bytes.writeUInt32BE(1, 8);
    bytes.writeUInt16BE(1, 20);
    bytes.writeUInt16BE(10, 22);
    return bytes;
  };
  const second = Buffer.alloc(4);
  second.writeUInt32BE(2);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('acTL', actl),
    chunk('fcTL', frame(0)),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    chunk('fcTL', frame(1)),
    chunk(
      'fdAT',
      Buffer.concat([second, deflateSync(Buffer.from([0, 0, 255, 0, 255]))]),
    ),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
describe('private image decoding and authenticated immutable context', () => {
  const keys = new Map([['synthetic-current', randomBytes(32)]]);
  const config = new ConfigService({
    NODE_ENV: 'test',
    FILE_STORAGE_DRIVER: 'local',
    FILE_STORAGE_ROOT: 'storage/synthetic',
  });
  const context = (): MaterialCipherContext => ({
    storedFileId: randomUUID(),
    applicationId: randomUUID(),
    ownerUserId: randomUUID(),
    kind: 'BUSINESS_LICENSE',
  });
  const ring = {
    current: () => ({
      id: 'synthetic-current',
      key: keys.get('synthetic-current')!,
    }),
    get: (id: string) => keys.get(id),
  };
  let storage: PartnerPrivateLocalAdapter;
  let files: PartnerPrivateImageStore;
  let png: Buffer;
  const image = (buffer = png) => ({
    buffer,
    size: buffer.length,
    mimetype: 'image/png',
    originalname: 'synthetic.png',
  });
  beforeAll(async () => {
    png = await sharp({
      create: { width: 12, height: 8, channels: 4, background: '#245139' },
    })
      .png()
      .toBuffer();
  });
  beforeEach(() => {
    storage = new PartnerPrivateLocalAdapter(config);
    files = new PartnerPrivateImageStore(
      config,
      storage,
      ring,
      'synthetic-image',
    );
  });
  afterEach(() => jest.restoreAllMocks());
  it('rejects APNG animation even when a PNG decoder reports only the first frame', async () => {
    const bytes = animatedPng();
    const decoded = await sharp(bytes).raw().toBuffer();
    expect(decoded).toHaveLength(4);
    await expect(files.prepare(context(), image(bytes))).rejects.toMatchObject({
      statusCode: 400,
    });
  });
  it('uses independent nonces and resumes exactly the original ciphertext', async () => {
    const owner = context();
    const first = await files.prepare(owner, image());
    const second = await files.prepare(owner, image());
    expect(second.metadata.nonce).not.toBe(first.metadata.nonce);
    expect(first.metadata.nonce).toHaveLength(24);
    expect(first.metadata.authenticationTag).toHaveLength(32);
    expect(first.ciphertext.equals(png)).toBe(false);
    expect(
      files
        .resume(owner, image(), first.metadata)
        .ciphertext.equals(first.ciphertext),
    ).toBe(true);
    jest.spyOn(storage, 'read').mockResolvedValue(first.ciphertext);
    expect(
      (await files.read(owner, 'unused', first.metadata)).equals(png),
    ).toBe(true);
  });
  it.each(['storedFileId', 'applicationId', 'ownerUserId', 'kind'] as const)(
    'rejects a substituted %s context',
    async (field) => {
      const owner = context();
      const encrypted = await files.prepare(owner, image());
      const swapped = {
        ...owner,
        [field]: field === 'kind' ? 'INSTITUTION_LOGO' : randomUUID(),
      };
      jest.spyOn(storage, 'read').mockResolvedValue(encrypted.ciphertext);
      await expect(
        files.read(swapped, 'unused', encrypted.metadata),
      ).rejects.toMatchObject({ statusCode: 503 });
    },
  );
  it.each(['authenticationTag', 'ciphertextDigest', 'inputDigest'])(
    'rejects corrupt %s',
    async (field) => {
      const owner = context();
      const encrypted = await files.prepare(owner, image());
      jest.spyOn(storage, 'read').mockResolvedValue(encrypted.ciphertext);
      await expect(
        files.read(owner, 'unused', {
          ...encrypted.metadata,
          [field]: '00'.repeat(field === 'authenticationTag' ? 16 : 32),
        }),
      ).rejects.toMatchObject({ statusCode: 503 });
    },
  );
  it('does not reuse a nonce for different retry bytes', async () => {
    const owner = context();
    const first = await files.prepare(owner, image());
    const other = Buffer.from(png);
    other[other.length - 1] ^= 1;
    expect(() => files.resume(owner, image(other), first.metadata)).toThrow(
      '请使用原图片恢复这次上传',
    );
  });
  it('keeps old keys usable without changing the immutable file context', async () => {
    const owner = context();
    const first = await files.prepare(owner, image());
    const rotated = {
      current: () => ({ id: 'rotated', key: randomBytes(32) }),
      get: ring.get,
    };
    const reader = new PartnerPrivateImageStore(
      config,
      storage,
      rotated,
      'synthetic-image',
    );
    jest.spyOn(storage, 'read').mockResolvedValue(first.ciphertext);
    expect(
      (await reader.read(owner, 'unused', first.metadata)).equals(png),
    ).toBe(true);
  });
  it('defaults closed without a test run tag', async () => {
    const closed = new PartnerPrivateImageStore(
      config,
      storage,
      ring,
      undefined,
    );
    await expect(closed.prepare(context(), image())).rejects.toMatchObject({
      statusCode: 503,
    });
  });
});
