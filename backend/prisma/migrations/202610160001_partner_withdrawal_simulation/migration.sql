CREATE TYPE "PartnerWithdrawalStatus" AS ENUM ('SUBMITTED','APPROVED','PAYING','RECONCILING','PAID','CANCELLED','REJECTED','FAILED','INVALIDATED');
CREATE TABLE "PartnerSettlementProfile" (
  "id" UUID PRIMARY KEY, "campusId" UUID NOT NULL UNIQUE REFERENCES "Campus"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version">0),
  "payerName" VARCHAR(100) NOT NULL, "beneficiaryName" VARCHAR(100) NOT NULL,
  "accountLastFour" CHAR(4) NOT NULL CHECK ("accountLastFour" ~ '^[0-9]{4}$'),
  "minimumAmountFen" INTEGER NOT NULL CHECK ("minimumAmountFen">0),
  "dailyRequestLimit" INTEGER NOT NULL CHECK ("dailyRequestLimit" BETWEEN 1 AND 100),
  "configuredByUserId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "PartnerSettlementSource" (
  "id" UUID PRIMARY KEY, "campusId" UUID NOT NULL REFERENCES "Campus"("id") ON DELETE RESTRICT,
  "earningEntryId" UUID NOT NULL UNIQUE REFERENCES "PartnerEarningEntry"("id") ON DELETE RESTRICT,
  "amountFen" INTEGER NOT NULL CHECK ("amountFen">0), "profileSnapshot" JSONB NOT NULL,
  "confirmedByUserId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "reason" VARCHAR(500) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PartnerSettlementSource_campusId_createdAt_idx" ON "PartnerSettlementSource"("campusId","createdAt");
CREATE TABLE "PartnerSettlementReversal" (
  "id" UUID PRIMARY KEY, "sourceId" UUID NOT NULL UNIQUE REFERENCES "PartnerSettlementSource"("id") ON DELETE RESTRICT,
  "earningReversalId" UUID NOT NULL UNIQUE REFERENCES "PartnerEarningEntry"("id") ON DELETE RESTRICT,
  "amountFen" INTEGER NOT NULL CHECK ("amountFen"<0), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "PartnerWithdrawal" (
  "id" UUID PRIMARY KEY, "campusId" UUID NOT NULL REFERENCES "Campus"("id") ON DELETE RESTRICT,
  "requestNo" VARCHAR(64) NOT NULL UNIQUE, "requestedByUserId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "amountFen" INTEGER NOT NULL CHECK ("amountFen">0), "status" "PartnerWithdrawalStatus" NOT NULL DEFAULT 'SUBMITTED',
  "profileSnapshot" JSONB NOT NULL, "reason" VARCHAR(500),
  "reviewedByUserId" UUID REFERENCES "User"("id") ON DELETE RESTRICT, "reviewedAt" TIMESTAMPTZ(3),
  "payingAt" TIMESTAMPTZ(3), "paidByUserId" UUID REFERENCES "User"("id") ON DELETE RESTRICT, "paidAt" TIMESTAMPTZ(3),
  "payoutReference" VARCHAR(128) UNIQUE, "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version">0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "PartnerWithdrawal_campusId_status_createdAt_idx" ON "PartnerWithdrawal"("campusId","status","createdAt");
CREATE TABLE "PartnerWithdrawalAllocation" (
  "id" UUID PRIMARY KEY, "withdrawalId" UUID NOT NULL REFERENCES "PartnerWithdrawal"("id") ON DELETE RESTRICT,
  "sourceId" UUID NOT NULL REFERENCES "PartnerSettlementSource"("id") ON DELETE RESTRICT,
  "amountFen" INTEGER NOT NULL CHECK ("amountFen">0), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("withdrawalId","sourceId")
);
CREATE INDEX "PartnerWithdrawalAllocation_sourceId_idx" ON "PartnerWithdrawalAllocation"("sourceId");
CREATE TABLE "PartnerSettlementIssue" (
  "id" UUID PRIMARY KEY, "allocationId" UUID NOT NULL UNIQUE REFERENCES "PartnerWithdrawalAllocation"("id") ON DELETE RESTRICT,
  "amountFen" INTEGER NOT NULL CHECK ("amountFen">0), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "PartnerPayoutProof" (
  "id" UUID PRIMARY KEY, "withdrawalId" UUID NOT NULL UNIQUE REFERENCES "PartnerWithdrawal"("id") ON DELETE RESTRICT,
  "fileId" UUID NOT NULL UNIQUE REFERENCES "StoredFile"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
