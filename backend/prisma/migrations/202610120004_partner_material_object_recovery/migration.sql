CREATE TABLE "PartnerApplicationUploadObject" (
  "id" UUID PRIMARY KEY,
  "uploadId" UUID NOT NULL REFERENCES "PartnerApplicationUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "storageKey" VARCHAR(255) NOT NULL UNIQUE,
  "attempt" INTEGER NOT NULL CHECK ("attempt" BETWEEN 1 AND 3),
  "retainedAt" TIMESTAMPTZ(3), "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerApplicationUploadObject_uploadId_attempt_key" UNIQUE ("uploadId", "attempt"),
  CONSTRAINT "PartnerApplicationUploadObject_disposition" CHECK ("retainedAt" IS NULL OR "completedAt" IS NULL)
);
-- Existing isolated test objects already have durable ownership; record that original object without moving it.
INSERT INTO "PartnerApplicationUploadObject" ("id", "uploadId", "storageKey", "attempt", "createdAt", "completedAt")
SELECT "id", "id", "storageKey", 1, "createdAt", "completedAt" FROM "PartnerApplicationUpload";
