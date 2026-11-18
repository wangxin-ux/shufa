CREATE TYPE "FreeCampaignCapacityMode" AS ENUM ('UNLIMITED', 'LIMITED');
CREATE TYPE "CampaignLifecycle" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "CampaignReviewStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');
CREATE TYPE "CampaignRegistrationStatus" AS ENUM ('REGISTERED', 'CANCELLED');

ALTER TABLE "PartnerCampaignDraft"
  ADD COLUMN "freeStartsAt" TIMESTAMPTZ(3),
  ADD COLUMN "freeEndsAt" TIMESTAMPTZ(3),
  ADD COLUMN "freeCapacityMode" "FreeCampaignCapacityMode",
  ADD COLUMN "freeMaxRegistrations" INTEGER,
  ADD CONSTRAINT "PartnerCampaignDraft_free_range" CHECK (
    "freeStartsAt" IS NULL OR "freeEndsAt" IS NULL OR "freeEndsAt" > "freeStartsAt"),
  ADD CONSTRAINT "PartnerCampaignDraft_free_capacity" CHECK (
    ("freeMaxRegistrations" IS NULL OR "freeMaxRegistrations" > 0) AND
    ("freeCapacityMode" IS DISTINCT FROM 'UNLIMITED' OR "freeMaxRegistrations" IS NULL));
CREATE UNIQUE INDEX "PartnerCampaignDraft_id_campusId_key" ON "PartnerCampaignDraft"("id", "campusId");

CREATE TABLE "Campaign" (
  "id" UUID NOT NULL PRIMARY KEY,
  "draftId" UUID NOT NULL,
  "campusId" UUID NOT NULL REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "publishedVersionId" UUID,
  "lifecycle" "CampaignLifecycle" NOT NULL DEFAULT 'OPEN',
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMPTZ(3),
  "closedByUserId" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "closeReason" VARCHAR(1000),
  CONSTRAINT "Campaign_draftId_campusId_fkey" FOREIGN KEY ("draftId", "campusId")
    REFERENCES "PartnerCampaignDraft"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Campaign_closure" CHECK (
    ("lifecycle" = 'OPEN' AND "closedAt" IS NULL AND "closedByUserId" IS NULL AND "closeReason" IS NULL) OR
    ("lifecycle" = 'CLOSED' AND "closedAt" IS NOT NULL AND "closedByUserId" IS NOT NULL AND length(btrim("closeReason")) > 0))
);
CREATE UNIQUE INDEX "Campaign_draftId_key" ON "Campaign"("draftId");
CREATE UNIQUE INDEX "Campaign_id_campusId_key" ON "Campaign"("id", "campusId");
CREATE UNIQUE INDEX "Campaign_draftId_campusId_key" ON "Campaign"("draftId", "campusId");
CREATE INDEX "Campaign_campusId_createdAt_id_idx" ON "Campaign"("campusId", "createdAt" DESC, "id" DESC);

CREATE TABLE "CampaignVersion" (
  "id" UUID NOT NULL PRIMARY KEY,
  "campaignId" UUID NOT NULL,
  "campusId" UUID NOT NULL REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "sourceDraftVersion" INTEGER NOT NULL CHECK ("sourceDraftVersion" > 0),
  "snapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("snapshotSchemaVersion" = 1),
  "title" VARCHAR(40) NOT NULL CHECK (length(btrim("title")) > 0),
  "campaignType" "PartnerCampaignType" NOT NULL DEFAULT 'FREE_REGISTRATION' CHECK ("campaignType" = 'FREE_REGISTRATION'),
  "shareDescription" VARCHAR(1000) NOT NULL CHECK (length(btrim("shareDescription")) > 0),
  "contactPhone" VARCHAR(30),
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3) NOT NULL,
  "timezone" VARCHAR(50) NOT NULL,
  "capacityMode" "FreeCampaignCapacityMode" NOT NULL,
  "maxRegistrations" INTEGER,
  "feeFen" INTEGER NOT NULL DEFAULT 0 CHECK ("feeFen" = 0),
  "benefitMode" VARCHAR(20) NOT NULL DEFAULT 'NONE' CHECK ("benefitMode" = 'NONE'),
  "registrationLimit" VARCHAR(30) NOT NULL DEFAULT 'ONCE_PER_STUDENT' CHECK ("registrationLimit" = 'ONCE_PER_STUDENT'),
  "status" "CampaignReviewStatus" NOT NULL DEFAULT 'SUBMITTED',
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedByUserId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reviewedAt" TIMESTAMPTZ(3),
  "reviewedByUserId" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reviewReason" VARCHAR(1000),
  CONSTRAINT "CampaignVersion_campaignId_campusId_fkey" FOREIGN KEY ("campaignId", "campusId")
    REFERENCES "Campaign"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CampaignVersion_range" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "CampaignVersion_capacity" CHECK (
    ("capacityMode" = 'UNLIMITED' AND "maxRegistrations" IS NULL) OR
    ("capacityMode" = 'LIMITED' AND "maxRegistrations" IS NOT NULL AND "maxRegistrations" > 0)),
  CONSTRAINT "CampaignVersion_review" CHECK (
    ("status" = 'SUBMITTED' AND "reviewedAt" IS NULL AND "reviewedByUserId" IS NULL AND "reviewReason" IS NULL) OR
    ("status" IN ('APPROVED', 'REJECTED') AND "reviewedAt" IS NOT NULL AND "reviewedByUserId" IS NOT NULL
      AND "reviewedByUserId" <> "submittedByUserId" AND
      ("status" = 'APPROVED' AND "reviewReason" IS NULL OR
       "status" = 'REJECTED' AND "reviewReason" IS NOT NULL AND length(btrim("reviewReason")) > 0)))
);
CREATE UNIQUE INDEX "CampaignVersion_campaignId_sequence_key" ON "CampaignVersion"("campaignId", "sequence");
CREATE UNIQUE INDEX "CampaignVersion_id_campaignId_campusId_key" ON "CampaignVersion"("id", "campaignId", "campusId");
CREATE UNIQUE INDEX "CampaignVersion_one_submitted" ON "CampaignVersion"("campaignId") WHERE "status" = 'SUBMITTED';
CREATE INDEX "CampaignVersion_status_submittedAt_id_idx" ON "CampaignVersion"("status", "submittedAt" DESC, "id" DESC);
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_publishedVersionId_id_campusId_fkey"
  FOREIGN KEY ("publishedVersionId", "id", "campusId")
  REFERENCES "CampaignVersion"("id", "campaignId", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CampaignRegistration" (
  "id" UUID NOT NULL PRIMARY KEY,
  "campaignId" UUID NOT NULL,
  "campusId" UUID NOT NULL REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "versionId" UUID NOT NULL,
  "parentUserId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "studentId" UUID NOT NULL REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" "CampaignRegistrationStatus" NOT NULL DEFAULT 'REGISTERED',
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "registeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMPTZ(3),
  "cancelledByUserId" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CampaignRegistration_campaignId_campusId_fkey" FOREIGN KEY ("campaignId", "campusId")
    REFERENCES "Campaign"("id", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CampaignRegistration_versionId_campaignId_campusId_fkey" FOREIGN KEY ("versionId", "campaignId", "campusId")
    REFERENCES "CampaignVersion"("id", "campaignId", "campusId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CampaignRegistration_cancel" CHECK (
    ("status" = 'REGISTERED' AND "cancelledAt" IS NULL AND "cancelledByUserId" IS NULL) OR
    ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledByUserId" = "parentUserId" AND "cancelledAt" >= "registeredAt"))
);
CREATE UNIQUE INDEX "CampaignRegistration_campaignId_studentId_key" ON "CampaignRegistration"("campaignId", "studentId");
CREATE INDEX "CampaignRegistration_campaignId_status_registeredAt_id_idx"
  ON "CampaignRegistration"("campaignId", "status", "registeredAt" DESC, "id" DESC);
CREATE INDEX "CampaignRegistration_parentUserId_campusId_registeredAt_id_idx"
  ON "CampaignRegistration"("parentUserId", "campusId", "registeredAt" DESC, "id" DESC);

CREATE FUNCTION "protect_free_campaign_snapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','version','reviewedAt','reviewedByUserId','reviewReason']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','version','reviewedAt','reviewedByUserId','reviewReason']) OR
     OLD."status" <> 'SUBMITTED' OR NEW."status" NOT IN ('APPROVED','REJECTED') OR NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'Frozen campaign content and terminal reviews are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CampaignVersion_immutable" BEFORE UPDATE ON "CampaignVersion"
  FOR EACH ROW EXECUTE FUNCTION "protect_free_campaign_snapshot"();
