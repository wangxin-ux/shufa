CREATE TYPE "PartnerEarningBasisStatus" AS ENUM ('PRICED', 'UNPRICED', 'REVERSED');
CREATE TYPE "PartnerEarningEntryType" AS ENUM ('ACCRUAL', 'REVERSAL');
CREATE TYPE "PartnerEarningStatus" AS ENUM ('PENDING_REVIEW', 'AVAILABLE', 'REJECTED', 'REVERSED');

CREATE TABLE "PartnerEarningRule" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "scopeKey" VARCHAR(100) NOT NULL,
    "unitPriceFen" INTEGER NOT NULL,
    "shareBasisPoints" INTEGER NOT NULL,
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

    CONSTRAINT "PartnerEarningRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PartnerEarningRule_unitPriceFen_positive" CHECK ("unitPriceFen" > 0),
    CONSTRAINT "PartnerEarningRule_shareBasisPoints_valid" CHECK ("shareBasisPoints" BETWEEN 1 AND 10000),
    CONSTRAINT "PartnerEarningRule_settlementDelayDays_non_negative" CHECK ("settlementDelayDays" >= 0),
    CONSTRAINT "PartnerEarningRule_version_positive" CHECK ("version" > 0),
    CONSTRAINT "PartnerEarningRule_lessonKinds_non_empty" CHECK (cardinality("eligibleLessonKinds") > 0),
    CONSTRAINT "PartnerEarningRule_attendanceStatuses_non_empty" CHECK (cardinality("countedAttendanceStatuses") > 0),
    CONSTRAINT "PartnerEarningRule_effective_range_valid" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
);

CREATE TABLE "PartnerEarningBasis" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "teachingRecordId" UUID NOT NULL,
    "lessonSessionId" UUID NOT NULL,
    "selectedRuleId" UUID,
    "lessonKind" "LessonKind" NOT NULL,
    "lessonUnits" INTEGER NOT NULL,
    "actualAttendeeCount" INTEGER NOT NULL,
    "countedAttendeeCount" INTEGER NOT NULL,
    "attendanceSnapshot" JSONB NOT NULL,
    "completedAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "PartnerEarningBasisStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PartnerEarningBasis_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PartnerEarningBasis_lessonUnits_positive" CHECK ("lessonUnits" > 0),
    CONSTRAINT "PartnerEarningBasis_actualAttendeeCount_non_negative" CHECK ("actualAttendeeCount" >= 0),
    CONSTRAINT "PartnerEarningBasis_countedAttendeeCount_non_negative" CHECK ("countedAttendeeCount" >= 0),
    CONSTRAINT "PartnerEarningBasis_pricing_state_valid" CHECK (
      ("status" = 'PRICED' AND "selectedRuleId" IS NOT NULL)
      OR ("status" = 'UNPRICED' AND "selectedRuleId" IS NULL)
      OR "status" = 'REVERSED'
    )
);

CREATE TABLE "PartnerEarningEntry" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "earningBasisId" UUID NOT NULL,
    "entryType" "PartnerEarningEntryType" NOT NULL,
    "amountFen" INTEGER NOT NULL,
    "status" "PartnerEarningStatus" NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "reviewableAt" TIMESTAMPTZ(3) NOT NULL,
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewReason" VARCHAR(500),
    "reversalOfId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PartnerEarningEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PartnerEarningEntry_amount_direction_valid" CHECK (
      ("entryType" = 'ACCRUAL' AND "amountFen" > 0 AND "reversalOfId" IS NULL)
      OR ("entryType" = 'REVERSAL' AND "amountFen" < 0 AND "reversalOfId" IS NOT NULL)
    ),
    CONSTRAINT "PartnerEarningEntry_version_positive" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "PartnerEarningRule_scopeKey_version_key" ON "PartnerEarningRule"("scopeKey", "version");
CREATE INDEX "PartnerEarningRule_campusId_status_effectiveFrom_idx" ON "PartnerEarningRule"("campusId", "status", "effectiveFrom");

CREATE UNIQUE INDEX "PartnerEarningBasis_teachingRecordId_key" ON "PartnerEarningBasis"("teachingRecordId");
CREATE INDEX "PartnerEarningBasis_campusId_status_createdAt_idx" ON "PartnerEarningBasis"("campusId", "status", "createdAt");
CREATE INDEX "PartnerEarningBasis_lessonSessionId_idx" ON "PartnerEarningBasis"("lessonSessionId");

CREATE UNIQUE INDEX "PartnerEarningEntry_reversalOfId_key" ON "PartnerEarningEntry"("reversalOfId");
CREATE INDEX "PartnerEarningEntry_campusId_status_createdAt_idx" ON "PartnerEarningEntry"("campusId", "status", "createdAt");
CREATE INDEX "PartnerEarningEntry_earningBasisId_entryType_idx" ON "PartnerEarningEntry"("earningBasisId", "entryType");

ALTER TABLE "PartnerEarningRule" ADD CONSTRAINT "PartnerEarningRule_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerEarningRule" ADD CONSTRAINT "PartnerEarningRule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PartnerEarningBasis" ADD CONSTRAINT "PartnerEarningBasis_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerEarningBasis" ADD CONSTRAINT "PartnerEarningBasis_teachingRecordId_fkey" FOREIGN KEY ("teachingRecordId") REFERENCES "TeachingRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerEarningBasis" ADD CONSTRAINT "PartnerEarningBasis_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerEarningBasis" ADD CONSTRAINT "PartnerEarningBasis_selectedRuleId_fkey" FOREIGN KEY ("selectedRuleId") REFERENCES "PartnerEarningRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PartnerEarningEntry" ADD CONSTRAINT "PartnerEarningEntry_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerEarningEntry" ADD CONSTRAINT "PartnerEarningEntry_earningBasisId_fkey" FOREIGN KEY ("earningBasisId") REFERENCES "PartnerEarningBasis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerEarningEntry" ADD CONSTRAINT "PartnerEarningEntry_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerEarningEntry" ADD CONSTRAINT "PartnerEarningEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "PartnerEarningEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
