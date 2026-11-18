CREATE TABLE "PartnerApplicationBankRecord" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "applicationVersion" INTEGER NOT NULL,
    "keyId" VARCHAR(100) NOT NULL,
    "nonce" VARCHAR(24) NOT NULL,
    "authenticationTag" VARCHAR(32) NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerApplicationBankRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PartnerApplicationBankRecord_positive_version" CHECK ("applicationVersion" > 0)
);

CREATE UNIQUE INDEX "PartnerApplicationBankRecord_applicationId_applicationVersion_key"
    ON "PartnerApplicationBankRecord"("applicationId", "applicationVersion");
CREATE INDEX "PartnerApplicationBankRecord_ownerUserId_idx" ON "PartnerApplicationBankRecord"("ownerUserId");
ALTER TABLE "PartnerApplicationBankRecord" ADD CONSTRAINT "PartnerApplicationBankRecord_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "PartnerApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerApplicationBankRecord" ADD CONSTRAINT "PartnerApplicationBankRecord_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PartnerApplication" ADD COLUMN "currentBankRecordId" UUID;
CREATE UNIQUE INDEX "PartnerApplication_currentBankRecordId_key" ON "PartnerApplication"("currentBankRecordId");
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_currentBankRecordId_fkey"
    FOREIGN KEY ("currentBankRecordId") REFERENCES "PartnerApplicationBankRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
