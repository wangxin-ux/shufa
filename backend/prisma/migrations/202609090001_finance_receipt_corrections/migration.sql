ALTER TYPE "LessonLedgerEntryType" ADD VALUE 'CORRECTION';

CREATE TYPE "FinanceCorrectionType" AS ENUM ('VOID', 'REPLACE');
CREATE TYPE "FinanceCorrectionStatus" AS ENUM (
  'SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'APPLIED'
);

CREATE TABLE "FinanceReceiptCorrection" (
  "id" UUID NOT NULL,
  "originalIssuanceId" UUID NOT NULL,
  "type" "FinanceCorrectionType" NOT NULL,
  "status" "FinanceCorrectionStatus" NOT NULL DEFAULT 'SUBMITTED',
  "reason" VARCHAR(500) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "originalAmountFen" INTEGER NOT NULL,
  "sourcePackageVersion" INTEGER NOT NULL,
  "replacementSnapshot" JSONB,
  "proposedProofFileId" UUID,
  "replacementReceiptId" UUID,
  "requestedByUserId" UUID NOT NULL,
  "reviewedByUserId" UUID,
  "reviewedAt" TIMESTAMPTZ(3),
  "appliedByUserId" UUID,
  "appliedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "FinanceReceiptCorrection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceReceiptCorrection_positive_values" CHECK (
    "version" > 0 AND "originalAmountFen" > 0 AND "sourcePackageVersion" > 0
  ),
  CONSTRAINT "FinanceReceiptCorrection_separate_review" CHECK (
    "reviewedByUserId" IS NULL OR "reviewedByUserId" <> "requestedByUserId"
  ),
  CONSTRAINT "FinanceReceiptCorrection_proposal_shape" CHECK (
    (
      "type" = 'VOID'
      AND "replacementSnapshot" IS NULL
      AND "proposedProofFileId" IS NULL
    )
    OR (
      "type" = 'REPLACE'
      AND jsonb_typeof("replacementSnapshot") = 'object'
      AND "proposedProofFileId" IS NOT NULL
    )
  ),
  CONSTRAINT "FinanceReceiptCorrection_review_state" CHECK (
    (
      "status" IN ('SUBMITTED', 'WITHDRAWN')
      AND "reviewedByUserId" IS NULL
      AND "reviewedAt" IS NULL
      AND "appliedByUserId" IS NULL
      AND "appliedAt" IS NULL
    )
    OR (
      "status" IN ('APPROVED', 'REJECTED')
      AND "reviewedByUserId" IS NOT NULL
      AND "reviewedAt" IS NOT NULL
      AND "appliedByUserId" IS NULL
      AND "appliedAt" IS NULL
    )
    OR (
      "status" = 'APPLIED'
      AND "reviewedByUserId" IS NOT NULL
      AND "reviewedAt" IS NOT NULL
      AND "appliedByUserId" IS NOT NULL
      AND "appliedAt" IS NOT NULL
    )
  ),
  CONSTRAINT "FinanceReceiptCorrection_replacement_result" CHECK (
    (
      "type" = 'VOID'
      AND "replacementReceiptId" IS NULL
    )
    OR (
      "type" = 'REPLACE'
      AND (
        ("status" <> 'APPLIED' AND "replacementReceiptId" IS NULL)
        OR ("status" = 'APPLIED' AND "replacementReceiptId" IS NOT NULL)
      )
    )
  ),
  CONSTRAINT "FinanceReceiptCorrection_originalIssuanceId_fkey"
    FOREIGN KEY ("originalIssuanceId") REFERENCES "FinancePackageIssuance"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceReceiptCorrection_proposedProofFileId_fkey"
    FOREIGN KEY ("proposedProofFileId") REFERENCES "StoredFile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceReceiptCorrection_replacementReceiptId_fkey"
    FOREIGN KEY ("replacementReceiptId") REFERENCES "FinanceReceipt"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceReceiptCorrection_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceReceiptCorrection_reviewedByUserId_fkey"
    FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceReceiptCorrection_appliedByUserId_fkey"
    FOREIGN KEY ("appliedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FinanceReceiptCorrection_proposedProofFileId_key"
  ON "FinanceReceiptCorrection"("proposedProofFileId");
CREATE UNIQUE INDEX "FinanceReceiptCorrection_replacementReceiptId_key"
  ON "FinanceReceiptCorrection"("replacementReceiptId");
CREATE UNIQUE INDEX "FinanceReceiptCorrection_one_active_or_applied"
  ON "FinanceReceiptCorrection"("originalIssuanceId")
  WHERE "status" IN ('SUBMITTED', 'APPROVED', 'APPLIED');
CREATE INDEX "FinanceReceiptCorrection_originalIssuanceId_status_idx"
  ON "FinanceReceiptCorrection"("originalIssuanceId", "status");
CREATE INDEX "FinanceReceiptCorrection_status_createdAt_id_idx"
  ON "FinanceReceiptCorrection"("status", "createdAt", "id");

CREATE TABLE "FinanceReceiptCorrectionEvent" (
  "id" UUID NOT NULL,
  "correctionId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "action" VARCHAR(20) NOT NULL,
  "fromStatus" "FinanceCorrectionStatus",
  "toStatus" "FinanceCorrectionStatus" NOT NULL,
  "version" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceReceiptCorrectionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceReceiptCorrectionEvent_version_positive" CHECK ("version" > 0),
  CONSTRAINT "FinanceReceiptCorrectionEvent_action_valid" CHECK (
    "action" IN ('SUBMIT', 'APPROVE', 'REJECT', 'WITHDRAW', 'APPLY')
  ),
  CONSTRAINT "FinanceReceiptCorrectionEvent_correctionId_fkey"
    FOREIGN KEY ("correctionId") REFERENCES "FinanceReceiptCorrection"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceReceiptCorrectionEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FinanceReceiptCorrectionEvent_correctionId_version_key"
  ON "FinanceReceiptCorrectionEvent"("correctionId", "version");

ALTER TABLE "LessonLedgerEntry"
  ADD COLUMN "financeCorrectionId" UUID,
  ADD CONSTRAINT "LessonLedgerEntry_financeCorrectionId_fkey"
    FOREIGN KEY ("financeCorrectionId") REFERENCES "FinanceReceiptCorrection"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "LessonLedgerEntry_financeCorrectionId_bucket_key"
  ON "LessonLedgerEntry"("financeCorrectionId", "bucket");

ALTER TABLE "LessonLedgerEntry"
  DROP CONSTRAINT "LessonLedgerEntry_direction_valid",
  ADD CONSTRAINT "LessonLedgerEntry_direction_valid" CHECK (
    ("entryType" = 'GRANT' AND "deltaUnits" > 0 AND "reversalOfId" IS NULL)
    OR ("entryType" = 'CONSUME' AND "deltaUnits" < 0 AND "reversalOfId" IS NULL)
    OR ("entryType" = 'REVERSAL' AND "deltaUnits" > 0 AND "reversalOfId" IS NOT NULL)
    OR ("entryType" = 'ADJUSTMENT' AND "reversalOfId" IS NULL)
    OR ("entryType" = 'REFUND' AND "deltaUnits" < 0 AND "reversalOfId" IS NULL AND "lessonSessionId" IS NULL)
    OR ("entryType" = 'CORRECTION' AND "deltaUnits" < 0 AND "reversalOfId" IS NOT NULL AND "lessonSessionId" IS NULL)
  ),
  ADD CONSTRAINT "LessonLedgerEntry_correction_link_valid" CHECK (
    ("entryType" = 'CORRECTION' AND "financeCorrectionId" IS NOT NULL)
    OR ("entryType" <> 'CORRECTION' AND "financeCorrectionId" IS NULL)
  );
