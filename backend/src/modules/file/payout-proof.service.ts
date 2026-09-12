import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { StoredFileService, type UploadedStoredFile } from './stored-file.service';

const MAX_PROOF_BYTES = 10 * 1024 * 1024;

export type UploadedPayoutProof = UploadedStoredFile;

@Injectable()
export class PayoutProofService {
  constructor(private readonly storedFileService: StoredFileService) {}

  async store(actor: AuthenticatedUser, file?: UploadedPayoutProof) {
    const stored = await this.storedFileService.store(actor, file, {
      purpose: 'PAYOUT_PROOF',
      directory: 'payout-proofs',
      allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
      maxBytes: MAX_PROOF_BYTES,
      invalidCode: 'PAYOUT_PROOF_INVALID',
      label: 'payout proof',
    });
    return {
      id: stored.id,
      originalName: stored.originalName,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      createdAt: stored.createdAt.toISOString(),
    };
  }
}
