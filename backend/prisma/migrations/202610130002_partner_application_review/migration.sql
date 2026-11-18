CREATE TABLE "PartnerApplicationReview" (
  "id" UUID PRIMARY KEY,
  "submissionId" UUID NOT NULL UNIQUE REFERENCES "PartnerApplicationSubmission"("id") ON DELETE RESTRICT,
  "reviewerUserId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "decision" "PartnerApplicationStatus" NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "resultingVersion" INTEGER NOT NULL,
  "reviewedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerApplicationReview_decision_check" CHECK ("decision" IN ('REJECTED', 'APPROVED')),
  CONSTRAINT "PartnerApplicationReview_reason_check" CHECK ("decision" <> 'REJECTED' OR length(btrim("reason")) > 0),
  CONSTRAINT "PartnerApplicationReview_version_check" CHECK ("sourceVersion" >= 1 AND "sourceVersion" < 2147483647 AND "resultingVersion" = "sourceVersion" + 1)
);
CREATE INDEX "PartnerApplicationReview_reviewerUserId_reviewedAt_idx" ON "PartnerApplicationReview"("reviewerUserId", "reviewedAt");
CREATE TRIGGER "PartnerApplicationReview_immutable"
BEFORE UPDATE OR DELETE ON "PartnerApplicationReview"
FOR EACH ROW EXECUTE FUNCTION partner_application_submission_immutable();

ALTER TABLE "PartnerApplication" ADD COLUMN "editSourceSubmissionId" UUID REFERENCES "PartnerApplicationSubmission"("id") ON DELETE RESTRICT;
CREATE INDEX "PartnerApplication_status_updatedAt_idx" ON "PartnerApplication"("status", "updatedAt");
