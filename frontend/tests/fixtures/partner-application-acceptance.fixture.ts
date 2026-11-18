import type { PartnerApplicantIdentity } from '../../pages/partner/runtime/partner-applicant-session.service';
import type { BankView } from '../../pages/partner/runtime/partner-application-bank.service';
import type { MaterialFile, MaterialKind, MaterialView } from '../../pages/partner/runtime/partner-application-material.service';
import type { ApplicationHistory } from '../../pages/partner/runtime/partner-application-review.service';
import type { PartnerApplication, PartnerApplicationStatus } from '../../pages/partner/runtime/partner-application.service';
import type { ReviewDetail, ReviewSummary } from '../../pages/super-admin/runtime/partner-application-review.service';
import type { SuperAdminStaffAccount } from '../../types/super-admin';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const long = (text: string, length: number) => text.repeat(Math.ceil(length / text.length)).slice(0, length);
const submittedAt = '2026-10-12T18:00:00.000Z';
const reviewedAt = '2026-10-12T19:00:00.000Z';

// These contract-sized read fixtures are synthetic, not a valid formal region directory or bank account.
export function partnerApplicationAcceptanceFixture(status: PartnerApplicationStatus = 'DRAFT') {
  const applicationId = id(1);
  const version = 63;
  const readonly = status !== 'DRAFT';
  const identity: PartnerApplicantIdentity = {
    applicantId: id(2), displayName: long('合成申请人', 100), formalAccountReady: status === 'APPROVED',
  };
  const application: PartnerApplication = {
    applicationId, status, version,
    basicInformation: {
      institutionName: long('合成机构长名称', 200),
      province: long('合成省份', 100), city: long('合成城市', 100), district: long('合成地区', 100),
      detailedAddress: long('合成详细地址楼层房间', 300),
      contactPhone: `+${Array<string>(10).fill('00').join('-')}`,
    },
    createdAt: submittedAt, updatedAt: reviewedAt,
  };
  const bank: BankView = {
    applicationId, status, version, readonly,
    bankInformation: {
      bankName: long('合成银行长支行名称', 200),
      accountHolder: long('合成对公账户长名称', 200), accountNumber: '0'.repeat(80),
    },
  };
  const kinds: MaterialKind[] = [
    'BUSINESS_LICENSE', 'INSTITUTION_LOGO', 'LEGAL_ID_FRONT', 'LEGAL_ID_BACK', 'STORE_FRONT',
    ...Array<MaterialKind>(9).fill('ENVIRONMENT'),
  ];
  const files: MaterialFile[] = kinds.map((kind, index) => ({
    storedFileId: id(100 + index), kind, mimeType: index % 2 ? 'image/jpeg' : 'image/png',
    sizeBytes: 3 * 1024 * 1024, width: 4096, height: 4096,
  }));
  const materials: MaterialView = { applicationId, status, version, readonly, materials: files, uploads: [] };
  const reason = long('合成驳回意见请补充清晰完整的资料。', 1000);
  const historyRows: ApplicationHistory['data'] = Array.from({ length: 21 }, (_, index) => ({
    submissionId: id(200 + index),
    submissionVersion: version - index * 3 - (status === 'SUBMITTED' ? 0 : status === 'DRAFT' ? 2 : 1),
    submittedAt, institutionName: application.basicInformation.institutionName!,
    review: index === 0 && status === 'SUBMITTED' ? null : {
      reviewId: id(300 + index), decision: index === 0 && status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      reason: index === 0 && status === 'APPROVED' ? '' : reason, reviewedAt,
    },
  }));
  const history = (page = 1): ApplicationHistory => ({
    applicationId, status, version, editSourceSubmissionId: status === 'DRAFT' ? historyRows[0].submissionId : null,
    data: historyRows.slice((page - 1) * 20, page * 20),
    meta: { page, pageSize: 20, total: historyRows.length, totalPages: 2 },
  });
  const summary: ReviewSummary = {
    applicationId, submissionId: historyRows[0].submissionId, version, status,
    institutionName: application.basicInformation.institutionName!,
    submissionVersion: historyRows[0].submissionVersion, submittedAt,
  };
  const detail: ReviewDetail = {
    applicationId, submissionId: summary.submissionId, version, status,
    submissionVersion: summary.submissionVersion, submittedAt, latest: true,
    basicInformation: { ...application.basicInformation, contactPhone: application.basicInformation.contactPhone ?? null },
    materials: files, review: historyRows[0].review,
  };
  const account: SuperAdminStaffAccount = {
    id: identity.applicantId, displayName: identity.displayName, maskedPhone: '未绑定个人手机号',
    roleCode: 'PARTNER', campusId: id(3), campusName: summary.institutionName,
    bindingStatus: 'BOUND', status: 'ACTIVE', version: 2, createdAt: reviewedAt, updatedAt: reviewedAt,
  };
  return { identity, application, bank, materials, history, summary, detail, account, reason };
}
