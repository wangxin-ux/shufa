ALTER TYPE "StoredFilePurpose" ADD VALUE 'PARTNER_CAMPAIGN_IMAGE';
ALTER TABLE "PartnerCampaignDraft"
  ADD COLUMN "coverImageId" UUID REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "shareImageId" UUID REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignVersion"
  ADD COLUMN "coverImageId" UUID REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "shareImageId" UUID REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignVersion" DROP CONSTRAINT "CampaignVersion_snapshotSchemaVersion_check";
ALTER TABLE "CampaignVersion" ADD CONSTRAINT "CampaignVersion_snapshotSchemaVersion_check"
  CHECK (
    ("snapshotSchemaVersion" = 1 AND "activityContent" IS NULL AND "coverImageId" IS NULL AND "shareImageId" IS NULL)
    OR ("snapshotSchemaVersion" = 2 AND "coverImageId" IS NULL AND "shareImageId" IS NULL)
    OR "snapshotSchemaVersion" = 3);
