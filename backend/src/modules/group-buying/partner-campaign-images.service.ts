import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import {
  StoredFileService,
  PARTNER_CAMPAIGN_IMAGE_OPTIONS,
  type UploadedStoredFile,
} from '../file/stored-file.service';
import { FreeCampaignScopeService } from './free-campaign-scope.service';
import {
  draftReceipt,
  invalid,
  MAX_VERSION,
  versionConflict,
} from './free-campaign-policy';

export function campaignImageField(slot: string) {
  if (slot !== 'cover' && slot !== 'share') invalid();
  return slot === 'cover' ? 'coverImageId' : 'shareImageId';
}

@Injectable()
export class PartnerCampaignImagesService {
  constructor(
    private readonly scope: FreeCampaignScopeService,
    private readonly files: StoredFileService,
    private readonly idempotency: IdempotencyService,
  ) {}

  get(user: AuthenticatedUser, id: string) {
    return this.scope.withActor(user, 'PARTNER', async (tx, actor) => {
      const draft = await this.scope.draft(tx, id, this.scope.campus(actor));
      const rows = await tx.storedFile.findMany({
        where: {
          id: {
            in: [draft.coverImageId, draft.shareImageId].filter(
              (v): v is string => Boolean(v),
            ),
          },
          purpose: 'PARTNER_CAMPAIGN_IMAGE',
        },
      });
      const find = (fileId: string | null) =>
        this.files.toPartnerCampaignImageView(
          rows.find((r) => r.id === fileId),
        );
      return {
        draftId: id,
        version: draft.version,
        images: {
          cover: find(draft.coverImageId),
          share: find(draft.shareImageId),
        },
      };
    });
  }

  async upload(
    user: AuthenticatedUser,
    id: string,
    slot: string,
    expectedVersion: number,
    file: UploadedStoredFile | undefined,
    key: string,
  ) {
    const field = campaignImageField(slot);
    this.scope.require(user, 'PARTNER');
    if (
      !file ||
      !file.buffer.length ||
      file.size !== file.buffer.length ||
      file.size > PARTNER_CAMPAIGN_IMAGE_OPTIONS.maxBytes
    )
      invalid();
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    let normalized: UploadedStoredFile;
    try {
      this.requireStaticPng(file.buffer);
      const decoder = sharp(file.buffer, {
        limitInputPixels: 16000000,
        failOn: 'warning',
      });
      const meta = await decoder.metadata();
      if (
        !['png', 'jpeg'].includes(meta.format ?? '') ||
        (meta.pages ?? 1) !== 1 ||
        file.mimetype !== `image/${meta.format}`
      )
        invalid();
      const output = await decoder
        .rotate()
        .toBuffer({ resolveWithObject: true });
      if (
        slot === 'cover'
          ? output.info.width !== 750 || output.info.height !== 1125
          : output.info.width * 3 !== output.info.height * 4
      )
        invalid();
      normalized = { ...file, buffer: output.data, size: output.data.length };
      if (normalized.size > PARTNER_CAMPAIGN_IMAGE_OPTIONS.maxBytes) invalid();
    } catch {
      invalid();
    }
    const route = `/partners/me/campaign-drafts/${id}/images/${slot}`;
    return this.scope.withActor(user, 'PARTNER', async (tx, actor) => {
      const campusId = this.scope.campus(actor);
      const draft = await this.scope.draft(tx, id, campusId, true);
      const claim = await this.idempotency.claim(tx, {
        key,
        route,
        request: { expectedVersion, sha256: hash },
        actorUserId: actor.userId,
        campusId,
      });
      if (claim.replayed) return claim.responseBody;
      if (expectedVersion !== draft.version || draft.version === MAX_VERSION)
        versionConflict();
      const stored = await this.files.store(
        user,
        normalized,
        PARTNER_CAMPAIGN_IMAGE_OPTIONS,
        tx,
      );
      const next = await tx.partnerCampaignDraft.update({
        where: { id },
        data: {
          [field]: stored.id,
          version: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          campusId,
          action: 'PARTNER_CAMPAIGN_IMAGE_SAVE',
          resourceType: 'PartnerCampaignDraft',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {
            slot,
            previousVersion: draft.version,
            version: next.version,
            storedFileId: stored.id,
          },
        },
      });
      const receipt = draftReceipt(next);
      await this.idempotency.complete(tx, {
        key,
        route,
        responseBody: receipt,
      });
      return receipt;
    });
  }

  private requireStaticPng(bytes: Buffer) {
    if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
      return;
    // libvips can report only APNG's first frame; inspect animation chunks too.
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      if (length > bytes.length - offset - 12) invalid();
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (['acTL', 'fcTL', 'fdAT'].includes(type)) invalid();
      offset += length + 12;
      if (type === 'IEND') return;
    }
    invalid();
  }

  clear(
    user: AuthenticatedUser,
    id: string,
    slot: string,
    expectedVersion: number,
  ) {
    const field = campaignImageField(slot);
    return this.scope.withActor(user, 'PARTNER', async (tx, actor) => {
      const campusId = this.scope.campus(actor);
      const draft = await this.scope.draft(tx, id, campusId, true);
      if (
        draft[field] === null &&
        [draft.version, draft.version - 1].includes(expectedVersion)
      )
        return draftReceipt(draft);
      if (expectedVersion !== draft.version || draft.version === MAX_VERSION)
        versionConflict();
      const next = await tx.partnerCampaignDraft.update({
        where: { id },
        data: { [field]: null, version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          campusId,
          action: 'PARTNER_CAMPAIGN_IMAGE_CLEAR',
          resourceType: 'PartnerCampaignDraft',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {
            slot,
            previousVersion: draft.version,
            version: next.version,
          },
        },
      });
      return draftReceipt(next);
    });
  }
}
