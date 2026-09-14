import {
  Controller,
  HttpCode,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../../common/auth/permissions.guard';
import { AccessTokenGuard } from '../auth/access-token.guard';
import {
  PayoutProofService,
  type UploadedPayoutProof,
} from './payout-proof.service';

@Controller('management/payout-proofs')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PayoutProofController {
  constructor(private readonly payoutProofService: PayoutProofService) {}

  @Post()
  @HttpCode(200)
  @RequirePermissions('WITHDRAWAL_MARK_PAID')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: UploadedPayoutProof,
  ) {
    return this.payoutProofService.store(user, file);
  }
}
