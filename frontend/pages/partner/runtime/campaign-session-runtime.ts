import { createPartnerRuntimeEnv } from '../../../config/partner-env';
import { SessionService, sessionService } from '../../../services/session.service';

export function logoutPartnerCampaignSession(): void {
  new SessionService({ dataDriver: createPartnerRuntimeEnv().dataDriver }, sessionService).logout();
}
