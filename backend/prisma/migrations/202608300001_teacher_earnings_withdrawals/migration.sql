-- CreateEnum
CREATE TYPE "LessonKind" AS ENUM ('REGULAR', 'MAKEUP', 'TRIAL');

CREATE TYPE "TeacherEarningBasisType" AS ENUM ('PER_COMPLETED_SESSION', 'PER_LESSON_UNIT', 'PER_PRESENT_ATTENDEE');

CREATE TYPE "TeacherEarningBasisStatus" AS ENUM ('PRICED', 'UNPRICED', 'REVERSED');

CREATE TYPE "TeacherEarningEntryType" AS ENUM ('ACCRUAL', 'REVERSAL');

CREATE TYPE "TeacherEarningStatus" AS ENUM ('PENDING_REVIEW', 'AVAILABLE', 'REJECTED', 'REVERSED');

CREATE TYPE "ConfigurationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

CREATE TYPE "WithdrawalStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'PAYING', 'PAID', 'CANCELLED', 'REJECTED', 'FAILED');

CREATE TYPE "StoredFilePurpose" AS ENUM ('PAYOUT_PROOF');

-- AlterTable
ALTER TABLE "LessonSession" ADD COLUMN "kind" "LessonKind";
UPDATE "LessonSession" SET "kind" = 'REGULAR' WHERE "kind" IS NULL;
ALTER TABLE "LessonSession" ALTER COLUMN "kind" SET DEFAULT 'REGULAR';
ALTER TABLE "LessonSession" ALTER COLUMN "kind" SET NOT NULL;

-- CreateTable
CREATE TABLE "TeacherEarningRule" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "teacherProfileId" UUID,
    "scopeKey" VARCHAR(100) NOT NULL,
    "basisType" "TeacherEarningBasisType" NOT NULL,
    "unitAmountFen" INTEGER NOT NULL,
    "eligibleLessonKinds" "LessonKind"[] NOT NULL,
    "countedAttendanceStatuses" "AttendanceStatus"[] NOT NULL,
    "settlementDelayDays" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL,
    "status" "ConfigurationStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeacherEarningRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeacherEarningRule_unitAmountFen_positive" CHECK ("unitAmountFen" > 0),
    CONSTRAINT "TeacherEarningRule_settlementDelayDays_non_negative" CHECK ("settlementDelayDays" >= 0),
    CONSTRAINT "TeacherEarningRule_version_positive" CHECK ("version" > 0),
    CONSTRAINT "TeacherEarningRule_lessonKinds_non_empty" CHECK (cardinality("eligibleLessonKinds") > 0),
    CONSTRAINT "TeacherEarningRule_effective_range_valid" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
);

CREATE TABLE "TeacherWithdrawalPolicy" (
    "id" UUID NOT NULL,
    "minimumAmountFen" INTEGER NOT NULL,
    "dailyRequestLimit" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ConfigurationStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeacherWithdrawalPolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeacherWithdrawalPolicy_minimumAmountFen_positive" CHECK ("minimumAmountFen" > 0),
    CONSTRAINT "TeacherWithdrawalPolicy_dailyRequestLimit_positive" CHECK ("dailyRequestLimit" > 0),
    CONSTRAINT "TeacherWithdrawalPolicy_version_positive" CHECK ("version" > 0),
    CONSTRAINT "TeacherWithdrawalPolicy_effective_range_valid" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
);

CREATE TABLE "TeacherEarningBasis" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "teacherProfileId" UUID NOT NULL,
    "teachingRecordId" UUID NOT NULL,
    "lessonSessionId" UUID NOT NULL,
    "selectedRuleId" UUID,
    "lessonKind" "LessonKind" NOT NULL,
    "lessonUnits" INTEGER NOT NULL,
    "attendeeCount" INTEGER NOT NULL,
    "attendanceSnapshot" JSONB NOT NULL,
    "completedAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "TeacherEarningBasisStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeacherEarningBasis_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeacherEarningBasis_lessonUnits_positive" CHECK ("lessonUnits" > 0),
    CONSTRAINT "TeacherEarningBasis_attendeeCount_non_negative" CHECK ("attendeeCount" >= 0),
    CONSTRAINT "TeacherEarningBasis_pricing_state_valid" CHECK (
      ("status" = 'PRICED' AND "selectedRuleId" IS NOT NULL)
      OR ("status" = 'UNPRICED' AND "selectedRuleId" IS NULL)
      OR "status" = 'REVERSED'
    )
);

CREATE TABLE "TeacherEarningEntry" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "teacherProfileId" UUID NOT NULL,
    "earningBasisId" UUID NOT NULL,
    "entryType" "TeacherEarningEntryType" NOT NULL,
    "amountFen" INTEGER NOT NULL,
    "status" "TeacherEarningStatus" NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "reviewableAt" TIMESTAMPTZ(3) NOT NULL,
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewReason" VARCHAR(500),
    "reversalOfId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeacherEarningEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeacherEarningEntry_amount_direction_valid" CHECK (
      ("entryType" = 'ACCRUAL' AND "amountFen" > 0 AND "reversalOfId" IS NULL)
      OR ("entryType" = 'REVERSAL' AND "amountFen" < 0 AND "reversalOfId" IS NOT NULL)
    ),
    CONSTRAINT "TeacherEarningEntry_version_positive" CHECK ("version" > 0)
);

CREATE TABLE "StoredFile" (
    "id" UUID NOT NULL,
    "purpose" "StoredFilePurpose" NOT NULL,
    "storageKey" VARCHAR(255) NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StoredFile_size_valid" CHECK ("sizeBytes" BETWEEN 1 AND 10485760),
    CONSTRAINT "StoredFile_sha256_valid" CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "StoredFile_mimeType_valid" CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'application/pdf'))
);

CREATE TABLE "Withdrawal" (
    "id" UUID NOT NULL,
    "requestNo" VARCHAR(64) NOT NULL,
    "campusId" UUID NOT NULL,
    "teacherProfileId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "amountFen" INTEGER NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'SUBMITTED',
    "policySnapshot" JSONB NOT NULL,
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "rejectionReason" VARCHAR(500),
    "payingAt" TIMESTAMPTZ(3),
    "paidByUserId" UUID,
    "paidAt" TIMESTAMPTZ(3),
    "payoutReference" VARCHAR(128),
    "payoutProofFileId" UUID,
    "failedAt" TIMESTAMPTZ(3),
    "failureReason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Withdrawal_amountFen_positive" CHECK ("amountFen" > 0),
    CONSTRAINT "Withdrawal_version_positive" CHECK ("version" > 0),
    CONSTRAINT "Withdrawal_paid_evidence_valid" CHECK (
      "status" <> 'PAID'
      OR (
        "paidAt" IS NOT NULL
        AND "paidByUserId" IS NOT NULL
        AND "payoutReference" IS NOT NULL
        AND char_length(btrim("payoutReference")) > 0
        AND "payoutProofFileId" IS NOT NULL
      )
    )
);

CREATE TABLE "WithdrawalAllocation" (
    "id" UUID NOT NULL,
    "withdrawalId" UUID NOT NULL,
    "earningEntryId" UUID NOT NULL,
    "amountFen" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WithdrawalAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WithdrawalAllocation_amountFen_positive" CHECK ("amountFen" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "TeacherEarningRule_scopeKey_version_key" ON "TeacherEarningRule"("scopeKey", "version");
CREATE INDEX "TeacherEarningRule_campusId_teacherProfileId_status_effectiveFrom_idx" ON "TeacherEarningRule"("campusId", "teacherProfileId", "status", "effectiveFrom");

CREATE UNIQUE INDEX "TeacherWithdrawalPolicy_version_key" ON "TeacherWithdrawalPolicy"("version");
CREATE INDEX "TeacherWithdrawalPolicy_status_effectiveFrom_idx" ON "TeacherWithdrawalPolicy"("status", "effectiveFrom");

CREATE UNIQUE INDEX "TeacherEarningBasis_teachingRecordId_key" ON "TeacherEarningBasis"("teachingRecordId");
CREATE INDEX "TeacherEarningBasis_teacherProfileId_status_createdAt_idx" ON "TeacherEarningBasis"("teacherProfileId", "status", "createdAt");
CREATE INDEX "TeacherEarningBasis_campusId_status_createdAt_idx" ON "TeacherEarningBasis"("campusId", "status", "createdAt");
CREATE INDEX "TeacherEarningBasis_lessonSessionId_idx" ON "TeacherEarningBasis"("lessonSessionId");

CREATE UNIQUE INDEX "TeacherEarningEntry_reversalOfId_key" ON "TeacherEarningEntry"("reversalOfId");
CREATE INDEX "TeacherEarningEntry_teacherProfileId_status_createdAt_idx" ON "TeacherEarningEntry"("teacherProfileId", "status", "createdAt");
CREATE INDEX "TeacherEarningEntry_campusId_status_createdAt_idx" ON "TeacherEarningEntry"("campusId", "status", "createdAt");
CREATE INDEX "TeacherEarningEntry_earningBasisId_entryType_idx" ON "TeacherEarningEntry"("earningBasisId", "entryType");

CREATE UNIQUE INDEX "StoredFile_storageKey_key" ON "StoredFile"("storageKey");
CREATE INDEX "StoredFile_createdByUserId_createdAt_idx" ON "StoredFile"("createdByUserId", "createdAt");

CREATE UNIQUE INDEX "Withdrawal_requestNo_key" ON "Withdrawal"("requestNo");
CREATE INDEX "Withdrawal_teacherProfileId_status_createdAt_idx" ON "Withdrawal"("teacherProfileId", "status", "createdAt");
CREATE INDEX "Withdrawal_campusId_status_createdAt_idx" ON "Withdrawal"("campusId", "status", "createdAt");
CREATE INDEX "Withdrawal_requestedByUserId_createdAt_idx" ON "Withdrawal"("requestedByUserId", "createdAt");

CREATE INDEX "WithdrawalAllocation_earningEntryId_idx" ON "WithdrawalAllocation"("earningEntryId");
CREATE UNIQUE INDEX "WithdrawalAllocation_withdrawalId_earningEntryId_key" ON "WithdrawalAllocation"("withdrawalId", "earningEntryId");

-- AddForeignKey
ALTER TABLE "TeacherEarningRule" ADD CONSTRAINT "TeacherEarningRule_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherEarningRule" ADD CONSTRAINT "TeacherEarningRule_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherEarningRule" ADD CONSTRAINT "TeacherEarningRule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherWithdrawalPolicy" ADD CONSTRAINT "TeacherWithdrawalPolicy_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherEarningBasis" ADD CONSTRAINT "TeacherEarningBasis_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherEarningBasis" ADD CONSTRAINT "TeacherEarningBasis_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherEarningBasis" ADD CONSTRAINT "TeacherEarningBasis_teachingRecordId_fkey" FOREIGN KEY ("teachingRecordId") REFERENCES "TeachingRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherEarningBasis" ADD CONSTRAINT "TeacherEarningBasis_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherEarningBasis" ADD CONSTRAINT "TeacherEarningBasis_selectedRuleId_fkey" FOREIGN KEY ("selectedRuleId") REFERENCES "TeacherEarningRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherEarningEntry" ADD CONSTRAINT "TeacherEarningEntry_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherEarningEntry" ADD CONSTRAINT "TeacherEarningEntry_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherEarningEntry" ADD CONSTRAINT "TeacherEarningEntry_earningBasisId_fkey" FOREIGN KEY ("earningBasisId") REFERENCES "TeacherEarningBasis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherEarningEntry" ADD CONSTRAINT "TeacherEarningEntry_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherEarningEntry" ADD CONSTRAINT "TeacherEarningEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "TeacherEarningEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "TeacherWithdrawalPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_payoutProofFileId_fkey" FOREIGN KEY ("payoutProofFileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WithdrawalAllocation" ADD CONSTRAINT "WithdrawalAllocation_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "Withdrawal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WithdrawalAllocation" ADD CONSTRAINT "WithdrawalAllocation_earningEntryId_fkey" FOREIGN KEY ("earningEntryId") REFERENCES "TeacherEarningEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
