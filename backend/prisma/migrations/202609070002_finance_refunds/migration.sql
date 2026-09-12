ALTER TYPE "LessonLedgerEntryType" ADD VALUE 'REFUND';
ALTER TYPE "StoredFilePurpose" ADD VALUE 'FINANCE_REFUND_PROOF';
CREATE TYPE "FinanceRefundStatus" AS ENUM (
  'SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCEL_REQUESTED',
  'CANCELLED', 'PAYING', 'UNCERTAIN', 'PAID'
);

CREATE TABLE "FinanceRefundRequest" (
  "id" UUID NOT NULL,
  "issuanceId" UUID NOT NULL,
  "mainUnits" INTEGER NOT NULL,
  "giftUnits" INTEGER NOT NULL,
  "referenceAmountFen" INTEGER NOT NULL,
  "amountFen" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "status" "FinanceRefundStatus" NOT NULL DEFAULT 'SUBMITTED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "requestedByUserId" UUID NOT NULL,
  "reviewedByUserId" UUID,
  "reviewedAt" TIMESTAMPTZ(3),
  "paymentStartedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "FinanceRefundRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceRefundRequest_issuanceId_fkey" FOREIGN KEY ("issuanceId") REFERENCES "FinancePackageIssuance"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceRefundRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceRefundRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceRefundRequest_units_bounds" CHECK ("mainUnits" > 0 AND "mainUnits" <= 100000000 AND "giftUnits" >= 0 AND "giftUnits" <= 100000000),
  CONSTRAINT "FinanceRefundRequest_amount_bounds" CHECK ("amountFen" > 0 AND "referenceAmountFen" >= 0),
  CONSTRAINT "FinanceRefundRequest_separate_review" CHECK ("reviewedByUserId" IS NULL OR "reviewedByUserId" <> "requestedByUserId"),
  CONSTRAINT "FinanceRefundRequest_version_positive" CHECK ("version" > 0)
);
CREATE INDEX "FinanceRefundRequest_issuanceId_status_idx" ON "FinanceRefundRequest"("issuanceId", "status");
CREATE INDEX "FinanceRefundRequest_status_createdAt_id_idx" ON "FinanceRefundRequest"("status", "createdAt", "id");

CREATE TABLE "FinanceRefundEvent" (
  "id" UUID NOT NULL,
  "refundId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "fromStatus" "FinanceRefundStatus",
  "toStatus" "FinanceRefundStatus" NOT NULL,
  "version" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceRefundEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceRefundEvent_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "FinanceRefundRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceRefundEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FinanceRefundEvent_refundId_version_key" ON "FinanceRefundEvent"("refundId", "version");

CREATE TABLE "FinanceRefundPayment" (
  "id" UUID NOT NULL,
  "refundId" UUID NOT NULL,
  "amountFen" INTEGER NOT NULL,
  "paidAt" TIMESTAMPTZ(3) NOT NULL,
  "proofFileId" UUID NOT NULL,
  "externalReference" VARCHAR(100) NOT NULL,
  "recordedByUserId" UUID NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceRefundPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceRefundPayment_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "FinanceRefundRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceRefundPayment_proofFileId_fkey" FOREIGN KEY ("proofFileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceRefundPayment_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceRefundPayment_positive" CHECK ("amountFen" > 0)
);
CREATE UNIQUE INDEX "FinanceRefundPayment_refundId_key" ON "FinanceRefundPayment"("refundId");
CREATE UNIQUE INDEX "FinanceRefundPayment_proofFileId_key" ON "FinanceRefundPayment"("proofFileId");
CREATE UNIQUE INDEX "FinanceRefundPayment_externalReference_key" ON "FinanceRefundPayment"("externalReference");
