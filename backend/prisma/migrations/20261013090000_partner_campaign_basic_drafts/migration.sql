CREATE TYPE "PartnerCampaignType" AS ENUM (
  'REGULAR_GROUP', 'MULTI_SPEC_GROUP', 'FLASH_SALE',
  'MULTI_SPEC_REGISTRATION_FEE', 'FREE_REGISTRATION'
);

CREATE TABLE "PartnerCampaignDraft" (
  "id" UUID NOT NULL,
  "campusId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "title" VARCHAR(40),
  "campaignType" "PartnerCampaignType",
  "shareDescription" VARCHAR(1000),
  "contactPhone" VARCHAR(30),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PartnerCampaignDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartnerCampaignDraft_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "PartnerCampaignDraft_campusId_fkey" FOREIGN KEY ("campusId")
    REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PartnerCampaignDraft_createdByUserId_fkey" FOREIGN KEY ("createdByUserId")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PartnerCampaignDraft_campusId_updatedAt_id_idx"
  ON "PartnerCampaignDraft"("campusId", "updatedAt" DESC, "id" DESC);
