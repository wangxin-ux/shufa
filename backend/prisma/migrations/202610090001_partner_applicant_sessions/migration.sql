CREATE TABLE "PartnerApplicant" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerApplicant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerApplicantSession" (
    "id" UUID NOT NULL,
    "applicantId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    CONSTRAINT "PartnerApplicantSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerApplicant_userId_key" ON "PartnerApplicant"("userId");
CREATE INDEX "PartnerApplicantSession_applicantId_createdAt_idx"
    ON "PartnerApplicantSession"("applicantId", "createdAt");
ALTER TABLE "PartnerApplicant" ADD CONSTRAINT "PartnerApplicant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerApplicantSession" ADD CONSTRAINT "PartnerApplicantSession_applicantId_fkey"
    FOREIGN KEY ("applicantId") REFERENCES "PartnerApplicant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
