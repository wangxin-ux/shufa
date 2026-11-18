ALTER TABLE "CampaignVersion"
  DROP CONSTRAINT "CampaignVersion_snapshotSchemaVersion_check";
ALTER TABLE "CampaignVersion"
  ADD CONSTRAINT "CampaignVersion_snapshotSchemaVersion_check"
  CHECK (("snapshotSchemaVersion" = 1 AND "activityContent" IS NULL)
    OR "snapshotSchemaVersion" = 2);
