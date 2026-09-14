ALTER TYPE "StoredFilePurpose" ADD VALUE 'CUSTOMER_SERVICE_QR';

ALTER TYPE "EnrollmentOrderStatus" ADD VALUE 'AWAITING_PAYMENT' AFTER 'AWAITING_PROOF';
ALTER TYPE "EnrollmentOrderStatus" ADD VALUE 'PAID' AFTER 'PENDING_REVIEW';
ALTER TYPE "EnrollmentOrderStatus" ADD VALUE 'REFUNDING' AFTER 'EFFECTIVE';
ALTER TYPE "EnrollmentOrderStatus" ADD VALUE 'REFUNDED' AFTER 'REFUNDING';

CREATE TYPE "GroupCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED');
CREATE TYPE "GroupTeamStatus" AS ENUM ('OPEN', 'SETTLED', 'CANCELLED');
CREATE TYPE "GroupMemberStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'SETTLED', 'REFUNDING', 'REFUNDED', 'CANCELLED');
CREATE TYPE "PaymentTransactionType" AS ENUM ('PAYMENT', 'REFUND');
CREATE TYPE "PaymentProvider" AS ENUM ('MOCK', 'WECHAT');
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

ALTER TABLE "Campus"
  ADD COLUMN "customerServiceName" VARCHAR(100),
  ADD COLUMN "customerServiceQrFileId" UUID;

CREATE TABLE "GroupCampaign" (
  "id" UUID NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "campusId" UUID NOT NULL,
  "courseProductId" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" VARCHAR(1000) NOT NULL,
  "priceFen" INTEGER NOT NULL,
  "maxPaidMembers" INTEGER NOT NULL DEFAULT 3,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3) NOT NULL,
  "status" "GroupCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "GroupCampaign_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GroupCampaign_price_positive" CHECK ("priceFen" > 0),
  CONSTRAINT "GroupCampaign_max_paid_members_three" CHECK ("maxPaidMembers" = 3),
  CONSTRAINT "GroupCampaign_time_range_valid" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "GroupCampaign_version_positive" CHECK ("version" >= 1)
);

CREATE TABLE "GroupTeam" (
  "id" UUID NOT NULL,
  "campaignId" UUID NOT NULL,
  "leaderUserId" UUID NOT NULL,
  "status" "GroupTeamStatus" NOT NULL DEFAULT 'OPEN',
  "paidMemberCount" INTEGER NOT NULL DEFAULT 0,
  "finalTier" INTEGER,
  "settledAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "GroupTeam_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GroupTeam_paid_member_count_valid" CHECK ("paidMemberCount" BETWEEN 0 AND 3),
  CONSTRAINT "GroupTeam_final_tier_valid" CHECK ("finalTier" IS NULL OR "finalTier" BETWEEN 1 AND 3),
  CONSTRAINT "GroupTeam_version_positive" CHECK ("version" >= 1)
);

CREATE TABLE "GroupMember" (
  "id" UUID NOT NULL,
  "campaignId" UUID NOT NULL,
  "teamId" UUID NOT NULL,
  "parentUserId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "enrollmentOrderId" UUID NOT NULL,
  "status" "GroupMemberStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "reservationExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "paidAt" TIMESTAMPTZ(3),
  "settledAt" TIMESTAMPTZ(3),
  "grantedMainUnits" INTEGER,
  "grantedGiftUnits" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GroupMember_granted_units_valid" CHECK (("grantedMainUnits" IS NULL OR "grantedMainUnits" >= 0) AND ("grantedGiftUnits" IS NULL OR "grantedGiftUnits" >= 0)),
  CONSTRAINT "GroupMember_version_positive" CHECK ("version" >= 1)
);

CREATE TABLE "PaymentTransaction" (
  "id" UUID NOT NULL,
  "groupMemberId" UUID NOT NULL,
  "enrollmentOrderId" UUID NOT NULL,
  "type" "PaymentTransactionType" NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "outTradeNo" VARCHAR(64) NOT NULL,
  "providerTradeNo" VARCHAR(128),
  "amountFen" INTEGER NOT NULL,
  "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
  "rawNotification" JSONB,
  "succeededAt" TIMESTAMPTZ(3),
  "failedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentTransaction_amount_positive" CHECK ("amountFen" > 0)
);

CREATE UNIQUE INDEX "GroupCampaign_code_key" ON "GroupCampaign"("code");
CREATE INDEX "GroupCampaign_campusId_status_startsAt_endsAt_idx" ON "GroupCampaign"("campusId", "status", "startsAt", "endsAt");
CREATE INDEX "GroupTeam_campaignId_status_createdAt_idx" ON "GroupTeam"("campaignId", "status", "createdAt");
CREATE UNIQUE INDEX "GroupMember_enrollmentOrderId_key" ON "GroupMember"("enrollmentOrderId");
CREATE UNIQUE INDEX "GroupMember_campaignId_studentId_key" ON "GroupMember"("campaignId", "studentId");
CREATE INDEX "GroupMember_teamId_status_reservationExpiresAt_idx" ON "GroupMember"("teamId", "status", "reservationExpiresAt");
CREATE INDEX "GroupMember_parentUserId_createdAt_idx" ON "GroupMember"("parentUserId", "createdAt");
CREATE UNIQUE INDEX "PaymentTransaction_outTradeNo_key" ON "PaymentTransaction"("outTradeNo");
CREATE UNIQUE INDEX "PaymentTransaction_provider_providerTradeNo_key" ON "PaymentTransaction"("provider", "providerTradeNo");
CREATE INDEX "PaymentTransaction_groupMemberId_type_status_idx" ON "PaymentTransaction"("groupMemberId", "type", "status");
CREATE INDEX "PaymentTransaction_enrollmentOrderId_createdAt_idx" ON "PaymentTransaction"("enrollmentOrderId", "createdAt");
CREATE INDEX "Campus_customerServiceQrFileId_idx" ON "Campus"("customerServiceQrFileId");

ALTER TABLE "Campus" ADD CONSTRAINT "Campus_customerServiceQrFileId_fkey" FOREIGN KEY ("customerServiceQrFileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupCampaign" ADD CONSTRAINT "GroupCampaign_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupCampaign" ADD CONSTRAINT "GroupCampaign_courseProductId_fkey" FOREIGN KEY ("courseProductId") REFERENCES "CourseProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupCampaign" ADD CONSTRAINT "GroupCampaign_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupTeam" ADD CONSTRAINT "GroupTeam_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "GroupCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupTeam" ADD CONSTRAINT "GroupTeam_leaderUserId_fkey" FOREIGN KEY ("leaderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "GroupCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "GroupTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_enrollmentOrderId_fkey" FOREIGN KEY ("enrollmentOrderId") REFERENCES "EnrollmentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_groupMemberId_fkey" FOREIGN KEY ("groupMemberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_enrollmentOrderId_fkey" FOREIGN KEY ("enrollmentOrderId") REFERENCES "EnrollmentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
