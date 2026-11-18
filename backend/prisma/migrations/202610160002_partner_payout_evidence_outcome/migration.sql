ALTER TABLE "PartnerPayoutProof" ADD COLUMN "outcome" VARCHAR(10);
ALTER TABLE "PartnerPayoutProof" ADD CONSTRAINT "PartnerPayoutProof_outcome_valid"
  CHECK ("outcome" IS NULL OR "outcome" IN ('PAID', 'UNPAID'));
