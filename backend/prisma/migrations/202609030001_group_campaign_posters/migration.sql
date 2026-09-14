ALTER TYPE "StoredFilePurpose" ADD VALUE 'GROUP_CAMPAIGN_POSTER';

CREATE TABLE "GroupCampaignPoster" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "storedFileId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupCampaignPoster_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GroupCampaignPoster_storedFileId_key"
ON "GroupCampaignPoster"("storedFileId");

CREATE UNIQUE INDEX "GroupCampaignPoster_campaignId_sortOrder_key"
ON "GroupCampaignPoster"("campaignId", "sortOrder");

CREATE INDEX "GroupCampaignPoster_campaignId_idx"
ON "GroupCampaignPoster"("campaignId");

ALTER TABLE "GroupCampaignPoster"
ADD CONSTRAINT "GroupCampaignPoster_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "GroupCampaign"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GroupCampaignPoster"
ADD CONSTRAINT "GroupCampaignPoster_storedFileId_fkey"
FOREIGN KEY ("storedFileId") REFERENCES "StoredFile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
