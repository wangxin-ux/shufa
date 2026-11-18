CREATE TABLE "PartnerApplicationApproval" (
  "id" UUID PRIMARY KEY,
  "submissionId" UUID NOT NULL UNIQUE REFERENCES "PartnerApplicationSubmission"("id") ON DELETE RESTRICT,
  "userId" UUID NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE RESTRICT,
  "campusId" UUID NOT NULL UNIQUE REFERENCES "Campus"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER "PartnerApplicationApproval_immutable"
BEFORE UPDATE OR DELETE ON "PartnerApplicationApproval"
FOR EACH ROW EXECUTE FUNCTION partner_application_submission_immutable();
