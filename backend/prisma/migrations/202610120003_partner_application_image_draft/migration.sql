ALTER TYPE "StoredFilePurpose" ADD VALUE 'PARTNER_APPLICATION_MATERIAL';
CREATE TYPE "PartnerApplicationMaterialKind" AS ENUM ('BUSINESS_LICENSE', 'INSTITUTION_LOGO', 'LEGAL_ID_FRONT', 'LEGAL_ID_BACK', 'STORE_FRONT', 'ENVIRONMENT');
CREATE TYPE "PartnerApplicationUploadState" AS ENUM ('RESERVED', 'WRITING', 'COMPLETED');

CREATE TABLE "PartnerApplicationUpload" (
  "id" UUID PRIMARY KEY, "storedFileId" UUID NOT NULL UNIQUE,
  "applicationId" UUID NOT NULL REFERENCES "PartnerApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "ownerUserId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestKey" UUID NOT NULL, "expectedVersion" INTEGER NOT NULL CHECK ("expectedVersion" > 0),
  "kind" "PartnerApplicationMaterialKind" NOT NULL,
  "state" "PartnerApplicationUploadState" NOT NULL DEFAULT 'RESERVED',
  "runTag" VARCHAR(100) NOT NULL, "storageKey" VARCHAR(255) NOT NULL UNIQUE,
  "keyId" VARCHAR(100), "nonce" VARCHAR(24), "authenticationTag" VARCHAR(32),
  "inputDigest" VARCHAR(64), "ciphertextDigest" VARCHAR(64),
  "mimeType" VARCHAR(100), "sizeBytes" INTEGER, "width" INTEGER, "height" INTEGER,
  "adoptedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "PartnerApplicationUpload_applicationId_requestKey_key" UNIQUE ("applicationId", "requestKey"),
  CONSTRAINT "PartnerApplicationUpload_image_limits" CHECK (
    "sizeBytes" IS NULL OR ("sizeBytes" BETWEEN 1 AND 3145728 AND "width" BETWEEN 1 AND 8192
    AND "height" BETWEEN 1 AND 8192 AND "width"::BIGINT * "height" <= 16777216)),
  CONSTRAINT "PartnerApplicationUpload_prepared" CHECK (
    "state" = 'RESERVED' OR ("keyId" IS NOT NULL AND "nonce" IS NOT NULL AND "authenticationTag" IS NOT NULL
    AND "inputDigest" IS NOT NULL AND "ciphertextDigest" IS NOT NULL
    AND "mimeType" IN ('image/jpeg', 'image/png') AND "sizeBytes" IS NOT NULL
    AND "width" IS NOT NULL AND "height" IS NOT NULL)),
  CONSTRAINT "PartnerApplicationUpload_completed" CHECK (
    ("state" = 'COMPLETED') = ("completedAt" IS NOT NULL) AND ("adoptedAt" IS NULL OR "state" = 'COMPLETED'))
);
CREATE INDEX "PartnerApplicationUpload_ownerUserId_adoptedAt_idx" ON "PartnerApplicationUpload"("ownerUserId", "adoptedAt");

CREATE TABLE "PartnerApplicationMaterialRecord" (
  "id" UUID PRIMARY KEY,
  "applicationId" UUID NOT NULL REFERENCES "PartnerApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "applicationVersion" INTEGER NOT NULL CHECK ("applicationVersion" > 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerApplicationMaterialRecord_applicationId_applicationVersion_key" UNIQUE ("applicationId", "applicationVersion")
);
ALTER TABLE "PartnerApplication" ADD COLUMN "currentMaterialRecordId" UUID UNIQUE;
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_currentMaterialRecordId_fkey"
  FOREIGN KEY ("currentMaterialRecordId") REFERENCES "PartnerApplicationMaterialRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PartnerApplicationMaterialItem" (
  "id" UUID PRIMARY KEY,
  "recordId" UUID NOT NULL REFERENCES "PartnerApplicationMaterialRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "storedFileId" UUID NOT NULL REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind" "PartnerApplicationMaterialKind" NOT NULL,
  "sortOrder" INTEGER NOT NULL CHECK ("sortOrder" BETWEEN 0 AND 13),
  CONSTRAINT "PartnerApplicationMaterialItem_recordId_sortOrder_key" UNIQUE ("recordId", "sortOrder"),
  CONSTRAINT "PartnerApplicationMaterialItem_recordId_storedFileId_key" UNIQUE ("recordId", "storedFileId")
);
CREATE TABLE "PartnerApplicationFileCipher" (
  "storedFileId" UUID PRIMARY KEY REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "uploadId" UUID NOT NULL UNIQUE REFERENCES "PartnerApplicationUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "keyId" VARCHAR(100) NOT NULL, "nonce" VARCHAR(24) NOT NULL, "authenticationTag" VARCHAR(32) NOT NULL
);
