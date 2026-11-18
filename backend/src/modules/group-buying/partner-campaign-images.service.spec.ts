import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { StoredFileService } from '../file/stored-file.service';
import type { FreeCampaignScopeService } from './free-campaign-scope.service';
import { PartnerCampaignImagesService } from './partner-campaign-images.service';

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
  ihdr.writeUInt32BE(4);
  ihdr.writeUInt32BE(3, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(2);
  const frame = (sequence: number) => {
    const bytes = Buffer.alloc(26);
    bytes.writeUInt32BE(sequence);
    bytes.writeUInt32BE(4, 4);
    bytes.writeUInt32BE(3, 8);
    bytes.writeUInt16BE(1, 20);
    bytes.writeUInt16BE(10, 22);
    return bytes;
  };
  const second = Buffer.alloc(4);
  second.writeUInt32BE(2);
  const pixels = deflateSync(Buffer.alloc(3 * (1 + 4 * 4)));
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('acTL', actl),
    chunk('fcTL', frame(0)),
    chunk('IDAT', pixels),
    chunk('fcTL', frame(1)),
    chunk('fdAT', Buffer.concat([second, pixels])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

it('rejects a two-frame APNG before a transaction even when Sharp sees only its first frame', async () => {
  const buffer = animatedPng();
  expect((await sharp(buffer).metadata()).pages).toBeUndefined();
  expect(await sharp(buffer).raw().toBuffer()).toHaveLength(4 * 3 * 4);
  const withActor = jest.fn().mockResolvedValue({});
  const service = new PartnerCampaignImagesService(
    { require: jest.fn(), withActor } as unknown as FreeCampaignScopeService,
    {} as StoredFileService,
    {} as IdempotencyService,
  );
  await expect(
    service.upload(
      { userId: 'synthetic', roles: [] },
      'synthetic',
      'share',
      1,
      {
        buffer,
        size: buffer.length,
        mimetype: 'image/png',
        originalname: 'synthetic.png',
      },
      'synthetic-apng-key',
    ),
  ).rejects.toMatchObject({ statusCode: 400 });
  expect(withActor).not.toHaveBeenCalled();
});
