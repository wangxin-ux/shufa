import { createPartnerRuntimeEnv } from '../../../config/partner-env';
import { PartnerApplicantSessionService } from './partner-applicant-session.service';
import { PartnerApplicationService } from './partner-application.service';
import { PartnerFormalArchiveSession } from './partner-formal-archive-session';
import { PartnerApplicationBankService } from './partner-application-bank.service';
import { PartnerApplicationMaterialService } from './partner-application-material.service';
import { PartnerApplicationSubmissionService } from './partner-application-submission.service';
import { PartnerApplicationReviewService } from './partner-application-review.service';

let cached: {
  baseUrl: string;
  dataDriver: 'mock' | 'api';
  formalArchive: boolean;
  sessions: PartnerApplicantSessionService | PartnerFormalArchiveSession;
  applications: PartnerApplicationService;
  banks?: PartnerApplicationBankService;
  materials?: PartnerApplicationMaterialService;
  submissions?: PartnerApplicationSubmissionService;
  reviews?: PartnerApplicationReviewService;
} | undefined;

export function getPartnerApplicationRuntime() {
  const env = createPartnerRuntimeEnv();
  const baseUrl = env.apiBaseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('入驻接口地址未配置');
  const formalArchive = env.dataDriver === 'api' && Boolean(env.accessToken.trim());
  if (!cached || cached.baseUrl !== baseUrl || cached.formalArchive !== formalArchive ||
      cached.dataDriver !== env.dataDriver) {
    cached?.sessions.invalidateReads();
    const sessions = formalArchive
      ? new PartnerFormalArchiveSession({ apiBaseUrl: baseUrl })
      : new PartnerApplicantSessionService({
        apiBaseUrl: baseUrl,
        isRuntimeCurrent: () => {
          const current = createPartnerRuntimeEnv();
          return current.dataDriver === env.dataDriver &&
            current.apiBaseUrl.trim().replace(/\/+$/, '') === baseUrl &&
            !(current.dataDriver === 'api' && current.accessToken.trim());
        },
      });
    cached = {
      baseUrl, dataDriver: env.dataDriver, formalArchive, sessions,
      applications: new PartnerApplicationService(sessions),
      banks: sessions instanceof PartnerApplicantSessionService
        ? new PartnerApplicationBankService(sessions) : undefined,
      materials: sessions instanceof PartnerApplicantSessionService
        ? new PartnerApplicationMaterialService(sessions) : undefined,
      submissions: sessions instanceof PartnerApplicantSessionService
        ? new PartnerApplicationSubmissionService(sessions) : undefined,
      reviews: sessions instanceof PartnerApplicantSessionService
        ? new PartnerApplicationReviewService(sessions) : undefined,
    };
  }
  return cached;
}
